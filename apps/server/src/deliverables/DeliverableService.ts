import {
  AUTO_DETECTED_DELIVERABLE_KINDS,
  type Deliverable,
  type DeliverableAnchor,
  type DeliverableComparison,
  DeliverableError,
  type DeliverableFailureReason,
  DeliverableId,
  type DeliverableKind,
  type DeliverablePurgeHistoryInput,
  type DeliverablePurgeHistoryResult,
  type DeliverableRegisterVersionInput,
  type DeliverableRegisterVersionResult,
  type DeliverableRendition,
  type DeliverableResolveStrayInput,
  type DeliverableResolveStrayResult,
  type DeliverableRestoreResult,
  type DeliverableRetainedHistory,
  type DeliverableVersion,
  type DeliverableVersionGraph,
  DeliverableVersionId,
  type DeliverableVersionSource,
  deliverableKindForPath,
  type OrchestrationV2Checkpoint,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  buildVersionGraph,
  nextVersionOrdinal,
  redoTarget,
  undoTarget,
} from "@t3tools/shared/deliverableVersionGraph";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as AssetAccess from "../assets/AssetAccess.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import {
  comparisonHeadline,
  comparisonUnavailable,
  comparisonUnavailableHeadline,
} from "./comparisonWords.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableComparer from "./DeliverableComparer.ts";
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";
import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as DeliverableRenditions from "./DeliverableRenditions.ts";
import * as DeliverableSelfCheck from "./DeliverableSelfCheck.ts";
import * as DeliverableStoreCleanup from "./DeliverableStoreCleanup.ts";
import { strayVersionTarget } from "./strayVersions.ts";
import { versionSummary, versionSummarySource } from "./versionSummary.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";
const fail = (reason: DeliverableFailureReason) => (cause?: unknown) =>
  new DeliverableError({ reason, ...(cause === undefined ? {} : { cause }) });

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const mimeFor = (name: string) =>
  MIME_BY_EXTENSION[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ??
  "application/octet-stream";

export class DeliverableService extends Context.Service<
  DeliverableService,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<Deliverable>, DeliverableError>;
    readonly versions: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<
      { readonly deliverable: Deliverable; readonly versions: ReadonlyArray<DeliverableVersion> },
      DeliverableError
    >;
    readonly registerVersion: (
      input: DeliverableRegisterVersionInput,
    ) => Effect.Effect<DeliverableRegisterVersionResult, DeliverableError>;
    /** Records versions for the deliverables a turn's checkpoint shows changed. */
    readonly detectFromCheckpoint: (input: {
      readonly threadId: ThreadId;
      readonly checkpoint: OrchestrationV2Checkpoint;
    }) => Effect.Effect<ReadonlyArray<DeliverableVersion>, DeliverableError>;
    readonly rendition: (
      versionId: DeliverableVersionId,
    ) => Effect.Effect<DeliverableRendition, DeliverableError>;
    readonly compare: (input: {
      readonly baseVersionId?: DeliverableVersionId | undefined;
      readonly targetVersionId: DeliverableVersionId;
    }) => Effect.Effect<DeliverableComparison, DeliverableError>;
    readonly versionGraph: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<DeliverableVersionGraph, DeliverableError>;
    readonly undo: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<DeliverableRestoreResult, DeliverableError>;
    readonly redo: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<DeliverableRestoreResult, DeliverableError>;
    readonly restore: (input: {
      readonly deliverableId: DeliverableId;
      readonly versionId: DeliverableVersionId;
    }) => Effect.Effect<DeliverableRestoreResult, DeliverableError>;
    /** Adopts a stray file as the next version of the deliverable it revises, or keeps it. */
    readonly resolveStray: (
      input: DeliverableResolveStrayInput,
    ) => Effect.Effect<DeliverableResolveStrayResult, DeliverableError>;
    /** Renders a version again after its rendition failed or had no renderer. */
    readonly retryRendition: (
      versionId: DeliverableVersionId,
    ) => Effect.Effect<DeliverableRendition, DeliverableError>;
    /** The Work history that removed projects still hold, and the store space only it needs. */
    readonly retainedHistory: Effect.Effect<DeliverableRetainedHistory, DeliverableError>;
    /**
     * Deletes removed projects' versions, notes and stored media for good, on a person's say-so.
     * Each decision is recorded before anything is deleted, so one a crash interrupts is finished
     * at the next start. Removing a project never does this, and a project in use is refused.
     */
    readonly purgeHistory: (
      input: DeliverablePurgeHistoryInput,
    ) => Effect.Effect<DeliverablePurgeHistoryResult, DeliverableError>;
    /** Finishes the recorded decisions that are still owed. */
    readonly resumeHistoryPurges: Effect.Effect<void, DeliverableError>;
    /** Resolves once queued renditions and self-checks have finished. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableService") {}

const make = Effect.gen(function* () {
  const repository = yield* DeliverableRepository.DeliverableRepository;
  const git = yield* DeliverableGit.DeliverableGit;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const renditions = yield* DeliverableRenditions.DeliverableRenditions;
  const comparer = yield* DeliverableComparer.DeliverableComparer;
  const cleanup = yield* DeliverableStoreCleanup.DeliverableStoreCleanup;
  const selfCheck = yield* DeliverableSelfCheck.DeliverableSelfCheck;
  const context = yield* DeliverableContext.DeliverableContext;
  const notes = yield* DeliverableNotes.DeliverableNotes;
  const events = yield* WorkProjectEvents.WorkProjectEvents;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const assetContext =
    yield* Effect.context<
      Effect.Services<ReturnType<typeof AssetAccess.issueDeliverableFileUrl>>
    >();
  // Versions of one project take turns: ordinals, current pointers and the working tree are shared.
  const projectLock = yield* KeyedLock.make<ProjectId>();

  const persistence = Effect.mapError(fail("persistence_failed"));

  const loadDeliverable = (id: DeliverableId) =>
    repository.getDeliverable(id).pipe(
      persistence,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail("deliverable_not_found")()),
          onSome: Effect.succeed,
        }),
      ),
    );
  const loadVersion = (id: DeliverableVersionId) =>
    repository.getVersion(id).pipe(
      persistence,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail("version_not_found")()),
          onSome: Effect.succeed,
        }),
      ),
    );
  const projectRoot = (projectId: ProjectId) =>
    context.projectRoot(projectId).pipe(
      Effect.filterOrFail(
        (root): root is string => root !== null,
        () => fail("project_not_found")(),
      ),
    );

  /** The stored summary column keeps the agent's text; clients get one plain line beside it. */
  const publicVersion = ({
    sourceBlobOid: _sourceBlobOid,
    summaryDetail: _summaryDetail,
    summary: source,
    ...version
  }: DeliverableRepository.StoredDeliverableVersion): DeliverableVersion => {
    const summary = versionSummary(source);
    return source === null || source === summary
      ? { ...version, summary }
      : { ...version, summary, summaryDetail: source };
  };

  /** Records one version of `relativePath` from a snapshot commit, unless it matches the current one. */
  const recordVersion = (input: RecordVersionInput) =>
    // Held from the first stored byte to the row that needs it, so cleanup sees both or neither.
    blobs.whileWriting(recordVersionUnlocked(input));

  interface RecordVersionInput {
    readonly projectId: ProjectId;
    readonly cwd: string;
    readonly relativePath: string;
    readonly sourceCommit: string;
    readonly source: DeliverableVersionSource;
    readonly title?: string | undefined;
    readonly summary: string | null;
    readonly expectedChanges: ReadonlyArray<DeliverableAnchor>;
  }

  const recordVersionUnlocked = Effect.fn("DeliverableService.recordVersion")(function* (
    input: RecordVersionInput,
  ) {
    const kind = deliverableKindForPath(input.relativePath);
    const blobOid = yield* git
      .blobAt({ cwd: input.cwd, commit: input.sourceCommit, path: input.relativePath })
      .pipe(Effect.mapError(fail("git_failed")));
    if (blobOid === null) return yield* fail("file_not_found")();
    const now = yield* DateTime.now;
    const existing = yield* repository
      .findDeliverableByPath({ projectId: input.projectId, path: input.relativePath })
      .pipe(persistence);
    let deliverable: Deliverable;
    if (Option.isSome(existing)) {
      deliverable = existing.value;
    } else {
      deliverable = {
        id: DeliverableId.make(`dlv_${(yield* random.uuidV4()).replaceAll("-", "")}`),
        projectId: input.projectId,
        kind,
        path: input.relativePath,
        title: input.title ?? path.basename(input.relativePath),
        currentVersionId: null,
        versionCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      yield* repository.insertDeliverable(deliverable).pipe(persistence);
    }
    const versions = yield* repository.listVersions(deliverable.id).pipe(persistence);
    const current = versions.find((version) => version.id === deliverable.currentVersionId);
    if (current !== undefined && current.sourceBlobOid === blobOid) {
      return { deliverable, version: current, created: false };
    }
    const ordinal = nextVersionOrdinal(versions);
    const parentCommit =
      current?.commitOid ??
      (yield* git
        .resolveCommit({ cwd: input.cwd, rev: "HEAD" })
        .pipe(Effect.mapError(fail("git_failed"))));
    const ref = `${DeliverableGit.DELIVERABLE_REFS_ROOT}/${deliverable.id}/v${ordinal}`;
    const snapshot = yield* git
      .snapshot({
        cwd: input.cwd,
        sourceCommit: input.sourceCommit,
        parentCommit,
        message: `${deliverable.title} V${ordinal}${input.summary === null ? "" : `\n\n${input.summary}`}`,
        ref,
      })
      .pipe(Effect.mapError(fail("git_failed")));
    const stored = snapshot.media.get(input.relativePath);
    if (stored === undefined) return yield* fail("unsupported_kind")();
    const version: DeliverableRepository.StoredDeliverableVersion = {
      id: DeliverableVersionId.make(`dlvv_${(yield* random.uuidV4()).replaceAll("-", "")}`),
      deliverableId: deliverable.id,
      ordinal,
      parentVersionId: current?.id ?? null,
      contentSha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      sourceBlobOid: blobOid,
      commitOid: snapshot.commitOid,
      ref,
      source: input.source,
      summary: input.summary,
      expectedChanges: input.expectedChanges,
      renditionStatus: "pending",
      selfCheck: null,
      createdAt: now,
    };
    yield* repository
      .insertVersion({
        version,
        updatedAt: now,
        blobs: [...snapshot.media.values()].map((media) => media.sha256),
      })
      .pipe(persistence);
    yield* worker.enqueue(version.id);
    const refreshed = yield* loadDeliverable(deliverable.id);
    const recorded = yield* loadVersion(version.id);
    yield* events.publish({
      type: "version-recorded",
      projectId: input.projectId,
      version: publicVersion(recorded),
    });
    yield* events.publish({ type: "changed", projectId: input.projectId });
    return { deliverable: refreshed, version: recorded, created: true };
  });

  const relativeInside = (root: string, requested: string) => {
    const absolute = path.resolve(root, requested);
    const relative = path.relative(root, absolute);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
  };

  const registerVersion: DeliverableService["Service"]["registerVersion"] = Effect.fn(
    "DeliverableService.registerVersion",
  )(function* (input) {
    const root = yield* projectRoot(input.projectId);
    const relativePath = relativeInside(root, input.path);
    if (relativePath === null) return yield* fail("path_outside_project")();
    if (deliverableKindForPath(relativePath) === "other") return yield* fail("unsupported_kind")();
    const exists = yield* fileSystem
      .exists(path.join(root, relativePath))
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) return yield* fail("file_not_found")();
    return yield* projectLock.withLock(
      input.projectId,
      Effect.gen(function* () {
        yield* git.ensureRepository(root).pipe(Effect.mapError(fail("git_failed")));
        const capture = yield* git
          .captureWorkingTree(root)
          .pipe(Effect.mapError(fail("git_failed")));
        const result = yield* recordVersion({
          projectId: input.projectId,
          cwd: root,
          relativePath,
          sourceCommit: capture.commitOid,
          source: {
            type: "explicit",
            ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
            ...(input.runId === undefined ? {} : { runId: input.runId }),
          },
          title: input.title,
          summary: versionSummarySource(input.summary),
          expectedChanges: input.expectedChanges ?? [],
        }).pipe(Effect.ensuring(capture.release));
        const version = publicVersion(result.version);
        // A copy registered by name is checked like one a turn left behind.
        if (result.created) yield* markStrays(input.projectId, [version]);
        return { ...result, deliverable: yield* loadDeliverable(result.deliverable.id), version };
      }),
    );
  });

  const detectFromCheckpoint: DeliverableService["Service"]["detectFromCheckpoint"] = Effect.fn(
    "DeliverableService.detectFromCheckpoint",
  )(function* (input) {
    const { checkpoint } = input;
    if (checkpoint.status !== "ready" || checkpoint.runId === null) return [];
    const turn = yield* context.turn({
      threadId: input.threadId,
      runId: checkpoint.runId,
      scopeId: checkpoint.scopeId,
      parentCheckpointId: checkpoint.parentCheckpointId,
    });
    if (turn === null) return [];
    const recorded = yield* recordCheckpointVersions(input, turn);
    yield* events.publish({
      type: "turn-settled",
      projectId: turn.projectId,
      threadId: input.threadId,
      runId: checkpoint.runId,
      versions: recorded,
    });
    return recorded;
  });

  const recordCheckpointVersions = Effect.fn("DeliverableService.recordCheckpointVersions")(
    function* (
      input: Parameters<DeliverableService["Service"]["detectFromCheckpoint"]>[0],
      turn: DeliverableContext.TurnContext,
    ) {
      const { checkpoint } = input;
      const truncated =
        checkpoint.filesTotal !== undefined &&
        checkpoint.filesTotal.count > checkpoint.files.length;
      const paths = truncated
        ? yield* git
            .changedPaths({ cwd: turn.cwd, from: turn.parentCheckpointRef, to: checkpoint.ref })
            .pipe(Effect.mapError(fail("git_failed")))
        : checkpoint.files.map((file) => file.path);
      const candidates = [...new Set(paths)].filter((candidate) =>
        AUTO_DETECTED_DELIVERABLE_KINDS.has(deliverableKindForPath(candidate)),
      );
      if (candidates.length === 0) return [];
      const sourceCommit = yield* git
        .resolveCommit({ cwd: turn.cwd, rev: checkpoint.ref })
        .pipe(Effect.mapError(fail("git_failed")));
      if (sourceCommit === null) return [];
      const recorded: DeliverableVersion[] = [];
      yield* projectLock.withLock(
        turn.projectId,
        Effect.forEach(
          candidates,
          (relativePath) =>
            recordVersion({
              projectId: turn.projectId,
              cwd: turn.cwd,
              relativePath,
              sourceCommit,
              source: {
                type: "checkpoint",
                threadId: input.threadId,
                runId: checkpoint.runId!,
                checkpointId: checkpoint.id,
              },
              summary: versionSummarySource(turn.reply),
              expectedChanges: [],
            }).pipe(
              Effect.tap((result) =>
                result.created
                  ? Effect.sync(() => recorded.push(publicVersion(result.version)))
                  : Effect.void,
              ),
              // A file deleted in the turn has no new version; the rest still record.
              Effect.catchTags({
                DeliverableError: (error) =>
                  error.reason === "file_not_found" ? Effect.void : Effect.fail(error),
              }),
            ),
          { discard: true },
        ),
      );
      yield* markStrays(turn.projectId, recorded);
      return recorded;
    },
  );

  /**
   * A file a turn created beside a deliverable under a version-suffixed name, while leaving
   * that deliverable alone, is most likely its revision saved as a copy; Work mode offers to
   * adopt it.
   */
  const markStrays = Effect.fn("DeliverableService.markStrays")(function* (
    projectId: ProjectId,
    recorded: ReadonlyArray<DeliverableVersion>,
  ) {
    const created = recorded.filter((version) => version.ordinal === 1);
    if (created.length === 0) return;
    const changed = new Set(recorded.map((version) => version.deliverableId as string));
    const all = yield* repository.listDeliverables(projectId).pipe(persistence);
    const originals = all.filter((candidate) => !changed.has(candidate.id));
    for (const version of created) {
      const stray = all.find((candidate) => candidate.id === version.deliverableId);
      const target = stray === undefined ? null : strayVersionTarget(stray.path, originals);
      if (target === null) continue;
      yield* repository
        .setStrayVersionOf({ deliverableId: version.deliverableId, strayVersionOf: target.id })
        .pipe(persistence);
      yield* events.publish({ type: "changed", projectId });
    }
  });

  const renditionRelative = (sha256: string, kind: DeliverableKind, file: string) =>
    path
      .relative(blobs.root, path.join(blobs.renditionDir({ sha256, kind }), file))
      .split(path.sep)
      .join("/");
  const urlFor = (sha256: string, kind: DeliverableKind, file: string | null) =>
    file === null
      ? Effect.succeed(null)
      : AssetAccess.issueDeliverableFileUrl({
          relativePath: renditionRelative(sha256, kind, file),
          mimeType: mimeFor(file),
        }).pipe(Effect.provide(assetContext), Effect.mapError(fail("storage_failed")));

  const rendition: DeliverableService["Service"]["rendition"] = Effect.fn(
    "DeliverableService.rendition",
  )(function* (versionId) {
    const version = yield* loadVersion(versionId);
    const deliverable = yield* loadDeliverable(version.deliverableId);
    const { stored, output } = yield* renditions.get({
      sha256: version.contentSha256,
      kind: deliverable.kind,
    });
    const sha = version.contentSha256;
    const sourceUrl = yield* AssetAccess.issueDeliverableFileUrl({
      relativePath: path.relative(blobs.root, blobs.blobPath(sha)).split(path.sep).join("/"),
      mimeType: mimeFor(deliverable.path),
    }).pipe(Effect.provide(assetContext), Effect.mapError(fail("storage_failed")));
    const units = output === null ? [] : output.units;
    return {
      versionId,
      status: stored?.status ?? "pending",
      renderer: stored?.renderer ?? null,
      detail: stored?.detail ?? null,
      width: output?.width ?? null,
      height: output?.height ?? null,
      durationSeconds: output?.durationSeconds ?? null,
      sourceUrl,
      posterUrl: yield* urlFor(sha, deliverable.kind, output?.poster ?? null),
      proxyUrl: yield* urlFor(sha, deliverable.kind, output?.proxy ?? null),
      units: yield* Effect.forEach(units, (unit) =>
        Effect.gen(function* () {
          return {
            index: unit.index,
            kind: unit.kind,
            ...(unit.start === undefined ? {} : { start: unit.start }),
            ...(unit.end === undefined ? {} : { end: unit.end }),
            ...(unit.title === undefined ? {} : { title: unit.title }),
            imageUrl: yield* urlFor(sha, deliverable.kind, unit.image),
            thumbUrl: yield* urlFor(sha, deliverable.kind, unit.thumb),
          };
        }),
      ),
    } satisfies DeliverableRendition;
  });

  const compareVersions = Effect.fn("DeliverableService.compareVersions")(function* (
    deliverable: Deliverable,
    base: DeliverableRepository.StoredDeliverableVersion,
    target: DeliverableRepository.StoredDeliverableVersion,
  ) {
    const kind = deliverable.kind;
    const compared = yield* comparer.compare({
      kind,
      baseSha256: base.contentSha256,
      targetSha256: target.contentSha256,
    });
    const units = compared.type === "compared" ? compared.units : [];
    const unavailable =
      compared.type === "compared"
        ? null
        : comparisonUnavailable(
            compared.reason,
            compared.side === null ? null : compared.side === "base" ? base : target,
          );
    const count = (status: DeliverableComparison["units"][number]["status"]) =>
      units.filter((unit) => unit.status === status).length;
    return {
      comparison: {
        deliverableId: deliverable.id,
        kind,
        baseVersionId: base.id,
        targetVersionId: target.id,
        method: compared.type === "compared" ? compared.method : "bytes",
        units,
        counts: {
          changed: count("changed"),
          unchanged: count("unchanged"),
          added: count("added"),
          removed: count("removed"),
          moved: count("moved"),
        },
        summary: versionSummary(target.summary),
        headline:
          unavailable === null
            ? comparisonHeadline(kind, units)
            : comparisonUnavailableHeadline(unavailable.reason),
        unavailable,
      } satisfies DeliverableComparison,
      targetUnits:
        (yield* renditions.get({ sha256: target.contentSha256, kind })).output?.units ?? [],
    };
  });

  const compare: DeliverableService["Service"]["compare"] = Effect.fn("DeliverableService.compare")(
    function* (input) {
      const target = yield* loadVersion(input.targetVersionId);
      const baseId = input.baseVersionId ?? target.parentVersionId;
      if (baseId === null) return yield* fail("no_base_version")();
      const base = yield* loadVersion(baseId);
      if (base.deliverableId !== target.deliverableId) return yield* fail("version_mismatch")();
      const deliverable = yield* loadDeliverable(target.deliverableId);
      return (yield* compareVersions(deliverable, base, target)).comparison;
    },
  );

  const graphOf = (
    deliverable: Deliverable,
    versions: ReadonlyArray<DeliverableRepository.StoredDeliverableVersion>,
  ) => {
    const current = deliverable.currentVersionId;
    return {
      deliverableId: deliverable.id,
      currentVersionId: current,
      canUndo: undoTarget(versions, current) !== null,
      canRedo: redoTarget(versions, current) !== null,
      nodes: buildVersionGraph(versions, current),
    } satisfies DeliverableVersionGraph;
  };

  const versionGraph: DeliverableService["Service"]["versionGraph"] = Effect.fn(
    "DeliverableService.versionGraph",
  )(function* (deliverableId) {
    const deliverable = yield* loadDeliverable(deliverableId);
    return graphOf(deliverable, yield* repository.listVersions(deliverableId).pipe(persistence));
  });

  const moveTo = Effect.fn("DeliverableService.moveTo")(function* (
    deliverableId: DeliverableId,
    action: "undo" | "redo" | "restore",
    pick: (
      versions: ReadonlyArray<DeliverableRepository.StoredDeliverableVersion>,
      current: DeliverableVersionId | null,
    ) => Effect.Effect<DeliverableVersionId, DeliverableError>,
  ) {
    yield* Effect.annotateCurrentSpan({
      "deliverable.id": deliverableId,
      "deliverable.action": action,
    });
    const initial = yield* loadDeliverable(deliverableId);
    return yield* projectLock.withLock(
      initial.projectId,
      Effect.gen(function* () {
        if (yield* context.projectBusy(initial.projectId)) return yield* fail("turn_running")();
        const deliverable = yield* loadDeliverable(deliverableId);
        const versions = yield* repository.listVersions(deliverableId).pipe(persistence);
        const targetId = yield* pick(versions, deliverable.currentVersionId);
        const target = versions.find((version) => version.id === targetId);
        const current = versions.find((version) => version.id === deliverable.currentVersionId);
        if (target === undefined || current === undefined)
          return yield* fail("version_not_found")();
        const root = yield* projectRoot(deliverable.projectId);
        const restoredPaths =
          target.id === current.id
            ? []
            : yield* git.restore({ cwd: root, from: current.commitOid, to: target.commitOid }).pipe(
                Effect.catchTags({
                  DeliverableWorkspaceChangedError: (cause) =>
                    Effect.fail(fail("workspace_changed")(cause)),
                  DeliverableGitError: (cause) => Effect.fail(fail("git_failed")(cause)),
                }),
              );
        yield* repository
          .setCurrentVersion({
            deliverableId,
            versionId: target.id,
            updatedAt: yield* DateTime.now,
            restore: { restoreId: yield* random.uuidV4(), action, fromVersionId: current.id },
          })
          .pipe(persistence);
        const updated = yield* loadDeliverable(deliverableId);
        yield* events.publish({ type: "changed", projectId: updated.projectId });
        return {
          deliverable: updated,
          graph: graphOf(updated, versions),
          restoredPaths,
        } satisfies DeliverableRestoreResult;
      }),
    );
  });

  const resolveStray: DeliverableService["Service"]["resolveStray"] = Effect.fn(
    "DeliverableService.resolveStray",
  )(function* (input) {
    const initial = yield* loadDeliverable(input.deliverableId);
    return yield* projectLock.withLock(
      initial.projectId,
      Effect.gen(function* () {
        const stray = yield* loadDeliverable(input.deliverableId);
        if (stray.strayVersionOf == null) return yield* fail("not_stray")();
        if (!input.adopt) {
          yield* repository
            .setStrayVersionOf({ deliverableId: stray.id, strayVersionOf: null })
            .pipe(persistence);
          yield* events.publish({ type: "changed", projectId: stray.projectId });
          return { deliverable: yield* loadDeliverable(stray.id) };
        }
        if (yield* context.projectBusy(stray.projectId)) return yield* fail("turn_running")();
        const original = yield* loadDeliverable(stray.strayVersionOf);
        const strayVersion = yield* loadVersion(
          stray.currentVersionId ?? (yield* fail("version_not_found")()),
        );
        const root = yield* projectRoot(stray.projectId);
        // The stray's bytes become the original file; the copy leaves the workspace.
        yield* fileSystem
          .copyFile(
            blobs.blobPath(strayVersion.contentSha256),
            path.join(root, ...original.path.split("/")),
          )
          .pipe(
            Effect.andThen(fileSystem.remove(path.join(root, ...stray.path.split("/")))),
            Effect.mapError(fail("storage_failed")),
          );
        yield* git.ensureRepository(root).pipe(Effect.mapError(fail("git_failed")));
        const capture = yield* git
          .captureWorkingTree(root)
          .pipe(Effect.mapError(fail("git_failed")));
        const { version } = yield* recordVersion({
          projectId: original.projectId,
          cwd: root,
          relativePath: original.path,
          sourceCommit: capture.commitOid,
          source: strayVersion.source,
          summary: strayVersion.summary,
          expectedChanges: strayVersion.expectedChanges,
        }).pipe(Effect.ensuring(capture.release));
        yield* notes
          .adoptVersion({
            projectId: original.projectId,
            runId: strayVersion.source.runId ?? null,
            strayDeliverableId: stray.id,
            version: publicVersion(version),
          })
          .pipe(Effect.mapError(fail("persistence_failed")));
        // Its content is now the original's newest version; only the copy's own rows go.
        yield* repository
          .deleteDeliverable({ deliverableId: stray.id, workspaceRoot: root })
          .pipe(persistence);
        yield* cleanup.request;
        yield* events.publish({ type: "changed", projectId: original.projectId });
        return { deliverable: yield* loadDeliverable(original.id) };
      }),
    );
  });

  /** Projects that were removed and still have deliverables. Missing ones are not among them. */
  const removedProjects = Effect.fn("DeliverableService.removedProjects")(function* () {
    const projectIds = yield* repository.listProjects.pipe(persistence);
    const states = yield* Effect.forEach(projectIds, (projectId) =>
      Effect.map(context.projectState(projectId), (project) =>
        project.type === "deleted" ? [{ projectId, title: project.title }] : [],
      ),
    );
    return states.flat();
  });

  const retainedHistory: DeliverableService["Service"]["retainedHistory"] = Effect.gen(
    function* () {
      const removed = yield* removedProjects();
      if (removed.length === 0) return { projects: [], bytes: 0 };
      const projects = yield* Effect.forEach(removed, (project) =>
        Effect.map(repository.countHistory(project.projectId).pipe(persistence), (counts) => ({
          ...project,
          ...counts,
        })),
      );
      const { held, elsewhere } = yield* repository
        .storeReferencesSplit(removed.map((project) => project.projectId))
        .pipe(persistence);
      const sizeOf = (
        folder: "objects" | "renditions" | "notes",
        only: (path: string) => boolean,
      ) =>
        Effect.map(blobs.listFiles(folder).pipe(Effect.mapError(fail("storage_failed"))), (files) =>
          files.filter((file) => only(file.path)).reduce((sum, file) => sum + file.sizeBytes, 0),
        );
      const bytes =
        (yield* sizeOf("objects", (file) => {
          const sha256 = DeliverableBlobStore.blobShaOfPath(file);
          return sha256 !== null && held.blobs.has(sha256) && !elsewhere.blobs.has(sha256);
        })) +
        (yield* sizeOf("renditions", (file) => {
          const [, sha256, kind] = file.split("/");
          const key = `${sha256}:${kind}`;
          return held.renditions.has(key) && !elsewhere.renditions.has(key);
        })) +
        (yield* sizeOf("notes", (file) => held.noteSnapshots.has(file)));
      return { projects, bytes } satisfies DeliverableRetainedHistory;
    },
  ).pipe(Effect.withSpan("DeliverableService.retainedHistory"));

  /**
   * Carries out one recorded decision. Only a project that is known to be removed loses its
   * history: one that is missing or cannot be read keeps the decision waiting, and one that is
   * in use again has the decision withdrawn.
   */
  const carryOutPurge = Effect.fn("DeliverableService.carryOutPurge")(function* (
    projectId: ProjectId,
  ) {
    return yield* projectLock.withLock(
      projectId,
      Effect.gen(function* () {
        const project = yield* context.projectState(projectId);
        if (project.type === "active") {
          yield* repository.cancelHistoryPurge(projectId).pipe(persistence);
          return false;
        }
        if (project.type !== "deleted") return false;
        const purged = yield* repository
          .purgeProjectHistory({
            projectId,
            workspaceRoot: project.workspaceRoot,
            completedAt: yield* DateTime.now,
          })
          .pipe(persistence);
        return purged !== null;
      }),
    );
  });

  const purgeHistory: DeliverableService["Service"]["purgeHistory"] = Effect.fn(
    "DeliverableService.purgeHistory",
  )(function* (input) {
    const projectIds = [...new Set(input.projectIds)];
    for (const projectId of projectIds) {
      if ((yield* context.projectState(projectId)).type !== "deleted") {
        return yield* fail("project_not_removed")();
      }
    }
    const requestedAt = yield* DateTime.now;
    yield* Effect.forEach(
      projectIds,
      (projectId) => repository.requestHistoryPurge({ projectId, requestedAt }),
      { discard: true },
    ).pipe(persistence);
    const purged = yield* Effect.forEach(projectIds, carryOutPurge);
    // The stored files and the Git refs go in the background, once nothing points at them.
    yield* cleanup.request;
    return { projects: purged.filter(Boolean).length } satisfies DeliverablePurgeHistoryResult;
  });

  const resumeHistoryPurges: DeliverableService["Service"]["resumeHistoryPurges"] =
    repository.listPendingHistoryPurges.pipe(
      persistence,
      Effect.flatMap((projectIds) => Effect.forEach(projectIds, carryOutPurge, { discard: true })),
      Effect.withSpan("DeliverableService.resumeHistoryPurges"),
    );

  /** Renders a version's content once; identical bytes in later versions reuse it. */
  const ensureRendered = (
    version: DeliverableRepository.StoredDeliverableVersion,
    deliverable: Deliverable,
  ) =>
    renditions.ensure({
      sha256: version.contentSha256,
      kind: deliverable.kind,
      fileName: deliverable.path,
      projectId: deliverable.projectId,
    });

  const retryRendition: DeliverableService["Service"]["retryRendition"] = Effect.fn(
    "DeliverableService.retryRendition",
  )(function* (versionId) {
    const version = yield* loadVersion(versionId);
    const deliverable = yield* loadDeliverable(version.deliverableId);
    const again = yield* renditions.retry({
      sha256: version.contentSha256,
      kind: deliverable.kind,
    });
    if (again) {
      // A check skipped because nothing could be compared is owed once this renders.
      if (version.selfCheck?.status === "skipped") {
        yield* repository.setSelfCheck({ versionId, result: null }).pipe(persistence);
      }
      yield* events.publish({ type: "changed", projectId: deliverable.projectId });
      yield* worker.enqueue(versionId);
    }
    return yield* rendition(versionId);
  });

  const renderVersion = Effect.fn("DeliverableService.renderVersion")(function* (
    versionId: DeliverableVersionId,
  ) {
    const version = yield* loadVersion(versionId);
    const deliverable = yield* loadDeliverable(version.deliverableId);
    yield* ensureRendered(version, deliverable);
    if (version.expectedChanges.length === 0 || version.selfCheck !== null) return;
    const versions = yield* repository.listVersions(deliverable.id).pipe(persistence);
    const parent = versions.find((candidate) => candidate.id === version.parentVersionId);
    if (parent !== undefined) yield* ensureRendered(parent, deliverable);
    const compared =
      parent === undefined ? null : yield* compareVersions(deliverable, parent, version);
    const result = yield* selfCheck.run({
      expectedChanges: version.expectedChanges,
      comparison: compared?.comparison ?? null,
      units: (compared?.targetUnits ?? []).map((unit) => ({
        index: unit.index,
        start: unit.start,
        end: unit.end,
      })),
    });
    yield* repository.setSelfCheck({ versionId, result }).pipe(persistence);
    yield* events.publish({ type: "changed", projectId: deliverable.projectId });
  });

  const worker = yield* makeDrainableWorker((versionId: DeliverableVersionId) =>
    renderVersion(versionId),
  );
  // Renditions and self-checks a restart interrupted, or an upgrade asked for again, pick up here.
  yield* repository.listUnfinished.pipe(
    Effect.flatMap((ids) => Effect.forEach(ids, worker.enqueue, { discard: true })),
    Effect.catch((error) =>
      Effect.logWarning("Could not resume deliverable renditions and self-checks", {
        error: error.message,
      }),
    ),
  );

  return DeliverableService.of({
    list: Effect.fn("DeliverableService.list")(function* (projectId) {
      yield* projectRoot(projectId);
      return yield* repository.listDeliverables(projectId).pipe(persistence);
    }),
    versions: Effect.fn("DeliverableService.versions")(function* (deliverableId) {
      const deliverable = yield* loadDeliverable(deliverableId);
      const versions = yield* repository.listVersions(deliverableId).pipe(persistence);
      return { deliverable, versions: versions.map(publicVersion) };
    }),
    registerVersion,
    detectFromCheckpoint,
    rendition,
    compare,
    versionGraph,
    undo: Effect.fn("DeliverableService.undo")(function* (deliverableId) {
      return yield* moveTo(deliverableId, "undo", (versions, current) =>
        Effect.fromNullishOr(undoTarget(versions, current)).pipe(
          Effect.mapError(() => fail("nothing_to_undo")()),
        ),
      );
    }),
    redo: Effect.fn("DeliverableService.redo")(function* (deliverableId) {
      return yield* moveTo(deliverableId, "redo", (versions, current) =>
        Effect.fromNullishOr(redoTarget(versions, current)).pipe(
          Effect.mapError(() => fail("nothing_to_redo")()),
        ),
      );
    }),
    resolveStray,
    retryRendition,
    retainedHistory,
    purgeHistory,
    resumeHistoryPurges,
    restore: Effect.fn("DeliverableService.restore")(function* (input) {
      return yield* moveTo(input.deliverableId, "restore", (versions) =>
        versions.some((version) => version.id === input.versionId)
          ? Effect.succeed(input.versionId)
          : Effect.fail(fail("version_not_found")()),
      );
    }),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(DeliverableService, make);
