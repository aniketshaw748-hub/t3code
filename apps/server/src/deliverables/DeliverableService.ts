import {
  AUTO_DETECTED_DELIVERABLE_KINDS,
  type Deliverable,
  type DeliverableAnchor,
  type DeliverableComparison,
  DeliverableError,
  type DeliverableFailureReason,
  DeliverableId,
  type DeliverableKind,
  type DeliverableRegisterVersionInput,
  type DeliverableRegisterVersionResult,
  type DeliverableRendition,
  type DeliverableRestoreResult,
  type DeliverableUnitChange,
  type DeliverableVersion,
  type DeliverableVersionGraph,
  DeliverableVersionId,
  type DeliverableVersionSource,
  deliverableKindForPath,
  type OrchestrationV2Checkpoint,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as AssetAccess from "../assets/AssetAccess.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableSelfCheck from "./DeliverableSelfCheck.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";
import {
  compareSequences,
  compareTimelines,
  samplesFromBytes,
  type UnitSignature,
} from "./perceptualDiff.ts";
import { buildVersionGraph, nextVersionOrdinal, redoTarget, undoTarget } from "./versionGraph.ts";

const fail = (reason: DeliverableFailureReason) => (cause?: unknown) =>
  new DeliverableError({ reason, ...(cause === undefined ? {} : { cause }) });

const decodeRenderOutput = Schema.decodeUnknownOption(DeliverableRenderers.RenderOutput);

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

/** The first line of the agent's reply, short enough for a version row. */
function versionSummary(reply: string | null): string | null {
  if (reply === null) return null;
  const line = reply
    .split("\n")
    .map((candidate) => candidate.replace(/^[#>*\-\s]+/, "").trim())
    .find((candidate) => candidate.length > 0);
  if (line === undefined) return null;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

function comparisonHeadline(
  kind: DeliverableKind,
  units: ReadonlyArray<DeliverableUnitChange>,
): string {
  const noun =
    kind === "video" ? "shot" : kind === "deck" ? "slide" : kind === "pdf" ? "page" : "image";
  const count = (status: DeliverableUnitChange["status"]) =>
    units.filter((unit) => unit.status === status).length;
  const parts = (
    [
      ["changed", count("changed")],
      ["added", count("added")],
      ["removed", count("removed")],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${noun}${n === 1 ? "" : "s"} ${status}`);
  return parts.length === 0 ? `No visible change` : parts.join(", ");
}

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
    /** Resolves once queued renditions and self-checks have finished. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableService") {}

const make = Effect.gen(function* () {
  const repository = yield* DeliverableRepository.DeliverableRepository;
  const git = yield* DeliverableGit.DeliverableGit;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const renderers = yield* DeliverableRenderers.DeliverableRenderers;
  const selfCheck = yield* DeliverableSelfCheck.DeliverableSelfCheck;
  const context = yield* DeliverableContext.DeliverableContext;
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

  const publicVersion = ({
    sourceBlobOid: _sourceBlobOid,
    ...version
  }: DeliverableRepository.StoredDeliverableVersion): DeliverableVersion => version;

  /** Records one version of `relativePath` from a snapshot commit, unless it matches the current one. */
  const recordVersion = Effect.fn("DeliverableService.recordVersion")(function* (input: {
    readonly projectId: ProjectId;
    readonly cwd: string;
    readonly relativePath: string;
    readonly sourceCommit: string;
    readonly source: DeliverableVersionSource;
    readonly title?: string | undefined;
    readonly summary: string | null;
    readonly expectedChanges: ReadonlyArray<DeliverableAnchor>;
  }) {
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
    yield* repository.insertVersion({ version, updatedAt: now }).pipe(persistence);
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
          summary: input.summary === undefined ? null : versionSummary(input.summary),
          expectedChanges: input.expectedChanges ?? [],
        }).pipe(Effect.ensuring(capture.release));
        return { ...result, version: publicVersion(result.version) };
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
              summary: versionSummary(turn.reply),
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
      return recorded;
    },
  );

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

  const storedOutput = Effect.fn("DeliverableService.storedOutput")(function* (
    sha256: string,
    kind: DeliverableKind,
  ) {
    const stored = yield* repository
      .getRendition({ contentSha256: sha256, kind })
      .pipe(persistence);
    if (Option.isNone(stored)) return { stored: null, output: null };
    const output =
      stored.value.status === "ready"
        ? Option.getOrNull(decodeRenderOutput(stored.value.data))
        : null;
    return { stored: stored.value, output };
  });

  const rendition: DeliverableService["Service"]["rendition"] = Effect.fn(
    "DeliverableService.rendition",
  )(function* (versionId) {
    const version = yield* loadVersion(versionId);
    const deliverable = yield* loadDeliverable(version.deliverableId);
    const { stored, output } = yield* storedOutput(version.contentSha256, deliverable.kind);
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

  const readFile = (sha256: string, kind: DeliverableKind, file: string) =>
    fileSystem
      .readFile(path.join(blobs.renditionDir({ sha256, kind }), file))
      .pipe(Effect.mapError(fail("storage_failed")));

  const signatures = Effect.fn("DeliverableService.signatures")(function* (
    sha256: string,
    kind: DeliverableKind,
    output: DeliverableRenderers.RenderOutput,
  ) {
    return yield* Effect.forEach(output.units, (unit) =>
      unit.signature === null
        ? Effect.succeed<UnitSignature>({ type: "hash", value: `${sha256}:${unit.index}` })
        : "hash" in unit.signature
          ? Effect.succeed<UnitSignature>({ type: "hash", value: unit.signature.hash })
          : Effect.map(readFile(sha256, kind, unit.signature.file), (data): UnitSignature => ({
              type: "pixels",
              data,
            })),
    );
  });

  const timeline = Effect.fn("DeliverableService.timeline")(function* (
    sha256: string,
    output: DeliverableRenderers.RenderOutput,
  ) {
    const samples =
      output.samples === null
        ? []
        : samplesFromBytes(
            yield* readFile(sha256, "video", output.samples.file),
            output.samples.fps,
          );
    return {
      duration: output.durationSeconds ?? 0,
      shots: output.units.map((unit) => ({
        index: unit.index,
        start: unit.start ?? 0,
        end: unit.end ?? 0,
      })),
      samples,
    };
  });

  const compareVersions = Effect.fn("DeliverableService.compareVersions")(function* (
    deliverable: Deliverable,
    base: DeliverableRepository.StoredDeliverableVersion,
    target: DeliverableRepository.StoredDeliverableVersion,
  ) {
    const kind = deliverable.kind;
    const [baseOut, targetOut] = [
      (yield* storedOutput(base.contentSha256, kind)).output,
      (yield* storedOutput(target.contentSha256, kind)).output,
    ];
    let method: DeliverableComparison["method"];
    let units: ReadonlyArray<DeliverableUnitChange>;
    if (baseOut === null || targetOut === null) {
      method = "bytes";
      const same = base.contentSha256 === target.contentSha256;
      units = [
        {
          status: same ? "unchanged" : "changed",
          baseIndex: 0,
          targetIndex: 0,
          difference: same ? 0 : 1,
          anchor: null,
        },
      ];
    } else if (kind === "video") {
      method = "perceptual";
      units = compareTimelines(
        yield* timeline(base.contentSha256, baseOut),
        yield* timeline(target.contentSha256, targetOut),
      );
    } else {
      const [baseSignatures, targetSignatures] = [
        yield* signatures(base.contentSha256, kind, baseOut),
        yield* signatures(target.contentSha256, kind, targetOut),
      ];
      method = targetSignatures.every((signature) => signature.type === "pixels")
        ? "perceptual"
        : "structural";
      units = compareSequences(baseSignatures, targetSignatures);
    }
    const count = (status: DeliverableUnitChange["status"]) =>
      units.filter((unit) => unit.status === status).length;
    return {
      comparison: {
        deliverableId: deliverable.id,
        kind,
        baseVersionId: base.id,
        targetVersionId: target.id,
        method,
        units,
        counts: {
          changed: count("changed"),
          unchanged: count("unchanged"),
          added: count("added"),
          removed: count("removed"),
        },
        summary: target.summary,
        headline: comparisonHeadline(kind, units),
      } satisfies DeliverableComparison,
      targetUnits: targetOut?.units ?? [],
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

  /** Renders a version's content once; identical bytes in later versions reuse it. */
  const ensureRendered = Effect.fn("DeliverableService.ensureRendered")(function* (
    version: DeliverableRepository.StoredDeliverableVersion,
    deliverable: Deliverable,
  ) {
    const sha = version.contentSha256;
    const existing = yield* repository
      .getRendition({ contentSha256: sha, kind: deliverable.kind })
      .pipe(persistence);
    if (
      Option.isNone(existing) ||
      existing.value.status === "pending" ||
      existing.value.status === "rendering"
    ) {
      const put = (
        fields: Pick<
          DeliverableRepository.StoredRendition,
          "status" | "renderer" | "detail" | "data"
        >,
      ) =>
        Effect.flatMap(DateTime.now, (updatedAt) =>
          repository
            .putRendition({ contentSha256: sha, kind: deliverable.kind, updatedAt, ...fields })
            .pipe(
              persistence,
              Effect.andThen(events.publish({ type: "changed", projectId: deliverable.projectId })),
            ),
        );
      yield* put({ status: "rendering", renderer: null, detail: null, data: null });
      const outDir = blobs.renditionDir({ sha256: sha, kind: deliverable.kind });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const scratchDir = yield* blobs.scratchDir.pipe(Effect.mapError(fail("storage_failed")));
          return yield* renderers.render({
            kind: deliverable.kind,
            sourcePath: blobs.blobPath(sha),
            fileName: path.basename(deliverable.path),
            outDir,
            scratchDir,
          });
        }),
      ).pipe(
        Effect.flatMap((output) =>
          put({ status: "ready", renderer: output.renderer, detail: output.detail, data: output }),
        ),
        Effect.catchTags({
          DeliverableRenderUnsupportedError: (error) =>
            put({ status: "unsupported", renderer: null, detail: error.detail, data: null }),
          DeliverableRenderError: (error) =>
            Effect.logWarning("Deliverable rendering failed", {
              stage: error.stage,
              cause: error.cause,
            }).pipe(
              Effect.andThen(
                put({ status: "failed", renderer: null, detail: error.message, data: null }),
              ),
            ),
        }),
      );
    }
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
  // Renditions interrupted by a restart pick up where they were.
  yield* repository.listUnrendered.pipe(
    Effect.flatMap((ids) => Effect.forEach(ids, worker.enqueue, { discard: true })),
    Effect.catch((error) =>
      Effect.logWarning("Could not resume deliverable renditions", { error: error.message }),
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
