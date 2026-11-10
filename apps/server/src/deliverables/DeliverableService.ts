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
  type DeliverableResolveStrayInput,
  type DeliverableResolveStrayResult,
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
import {
  buildVersionGraph,
  nextVersionOrdinal,
  redoTarget,
  undoTarget,
} from "@t3tools/shared/deliverableVersionGraph";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableSelfCheck from "./DeliverableSelfCheck.ts";
import { strayVersionTarget } from "./strayVersions.ts";
import { versionSummary, versionSummarySource } from "./versionSummary.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";
import {
  alignSequences,
  compareHashes,
  DISPLAY_TOLERANCE,
  rasterDifference,
  removedShots,
  SAME,
  samplesFromBytes,
  sequenceChanges,
  shotChange,
  type UnitDifference,
  type UnitSignature,
  unmeasuredDifference,
  VIDEO_GRID,
} from "./perceptualDiff.ts";

const fail = (reason: DeliverableFailureReason) => (cause?: unknown) =>
  new DeliverableError({ reason, ...(cause === undefined ? {} : { cause }) });

const decodeRenderOutput = Schema.decodeUnknownOption(DeliverableRenderers.RenderOutput);

/** Content comparisons kept in memory; each is a few hundred bytes. */
const COMPARISON_CACHE_CAPACITY = 128;

/** What changed between two stored contents, whichever versions hold them. */
interface ContentComparison {
  readonly method: DeliverableComparison["method"];
  readonly units: ReadonlyArray<DeliverableUnitChange>;
  /** False while a rendition is missing or a unit could not be measured, so it is worked out again. */
  readonly settled: boolean;
}

const contentKey = (kind: DeliverableKind, baseSha256: string, targetSha256: string) =>
  `${kind}:${baseSha256}:${targetSha256}`;

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
    /** Adopts a stray file as the next version of the deliverable it revises, or keeps it. */
    readonly resolveStray: (
      input: DeliverableResolveStrayInput,
    ) => Effect.Effect<DeliverableResolveStrayResult, DeliverableError>;
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
          : Effect.map(readFile(sha256, kind, unit.signature.file), (outline): UnitSignature => ({
              type: "pixels",
              outline,
            })),
    );
  });

  // One resample per video at a time: two comparisons often ask for the same one together.
  const resampleLock = yield* KeyedLock.make<string>();

  /**
   * A video's rendition with its sampled frames on the current grid. One rendered before the grid
   * grew is resampled from the stored video and saved, once. Null when it cannot be compared.
   */
  const videoOutput = (sha256: string) =>
    resampleLock.withLock(
      sha256,
      Effect.gen(function* () {
        const { stored, output } = yield* storedOutput(sha256, "video");
        if (stored === null || output === null) return null;
        if (output.samples?.grid === VIDEO_GRID) return output;
        if (output.durationSeconds === null) return null;
        const outDir = blobs.renditionDir({ sha256, kind: "video" });
        const samples = yield* renderers.sampleFrames({
          sourcePath: blobs.blobPath(sha256),
          outDir,
          durationSeconds: output.durationSeconds,
        });
        const current = { ...output, samples };
        yield* repository
          .putRendition({ ...stored, data: current, updatedAt: yield* DateTime.now })
          .pipe(persistence);
        if (output.samples !== null && output.samples.file !== samples.file) {
          yield* fileSystem.remove(path.join(outDir, output.samples.file)).pipe(Effect.ignore);
        }
        return current;
      }).pipe(
        Effect.catchTags({
          DeliverableRenderUnsupportedError: (error) =>
            Effect.as(
              Effect.logWarning("Could not resample a video for comparison", {
                detail: error.detail,
              }),
              null,
            ),
          DeliverableRenderError: (error) =>
            Effect.as(
              Effect.logWarning("Could not resample a video for comparison", {
                stage: error.stage,
                cause: error.cause,
              }),
              null,
            ),
        }),
      ),
    );

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
            output.samples.grid ?? VIDEO_GRID,
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

  /**
   * What changed between two rendered slides, pages or images, judged on the images Work mode
   * shows. The same content renders to the same bytes, so most pairs never need their pixels read.
   */
  const displayDifference = Effect.fn("DeliverableService.displayDifference")(function* (
    kind: DeliverableKind,
    base: { readonly sha256: string; readonly image: string },
    target: { readonly sha256: string; readonly image: string },
  ) {
    const [before, after] = [
      yield* readFile(base.sha256, kind, base.image),
      yield* readFile(target.sha256, kind, target.image),
    ];
    if (Buffer.compare(before, after) === 0) return SAME;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* blobs.scratchDir.pipe(Effect.mapError(fail("storage_failed")));
        const pixels = (side: typeof base, name: string) =>
          renderers.readImage({
            imagePath: path.join(blobs.renditionDir({ sha256: side.sha256, kind }), side.image),
            scratchPath: path.join(scratch, name),
          });
        return rasterDifference(
          yield* pixels(base, "base.ppm"),
          yield* pixels(target, "target.ppm"),
          DISPLAY_TOLERANCE,
        );
      }),
    );
  });

  /** Slides, pages or an image: lined up by outline, then each pair judged at display size. */
  const compareStills = Effect.fn("DeliverableService.compareStills")(function* (
    kind: DeliverableKind,
    base: { readonly sha256: string; readonly output: DeliverableRenderers.RenderOutput },
    target: { readonly sha256: string; readonly output: DeliverableRenderers.RenderOutput },
  ) {
    const [baseSignatures, targetSignatures] = [
      yield* signatures(base.sha256, kind, base.output),
      yield* signatures(target.sha256, kind, target.output),
    ];
    const rendered = (all: ReadonlyArray<UnitSignature>) =>
      all.every((signature) => signature.type === "pixels");
    if (!rendered(baseSignatures) || !rendered(targetSignatures)) {
      return {
        method: rendered(targetSignatures) ? "perceptual" : "structural",
        units: compareHashes(baseSignatures, targetSignatures),
        settled: true,
      } satisfies ContentComparison;
    }
    let settled = true;
    const measured = yield* Effect.forEach(
      alignSequences(baseSignatures, targetSignatures),
      (pair) => {
        const { baseIndex, targetIndex } = pair;
        if (baseIndex === null || targetIndex === null) {
          return Effect.succeed({ ...pair, difference: SAME });
        }
        const [baseImage, targetImage] = [
          base.output.units[baseIndex]?.image,
          target.output.units[targetIndex]?.image,
        ];
        const unmeasured = (): UnitDifference => {
          settled = false;
          return unmeasuredDifference(baseSignatures[baseIndex]!, targetSignatures[targetIndex]!);
        };
        if (baseImage == null || targetImage == null) {
          return Effect.succeed({ ...pair, difference: unmeasured() });
        }
        return displayDifference(
          kind,
          { sha256: base.sha256, image: baseImage },
          { sha256: target.sha256, image: targetImage },
        ).pipe(
          // Images that differ but cannot be decoded still count as a change, just an unplaced one.
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("Could not read a deliverable's pixels for comparison", {
                error: error.message,
              }),
              unmeasured(),
            ),
          ),
          Effect.map((difference) => ({ ...pair, difference })),
        );
      },
      { concurrency: 2 },
    );
    return {
      method: "perceptual",
      units: sequenceChanges(measured),
      settled,
    } satisfies ContentComparison;
  });

  const compareContent = Effect.fn("DeliverableService.compareContent")(function* (
    kind: DeliverableKind,
    baseSha256: string,
    targetSha256: string,
  ) {
    const outputOf = (sha256: string) =>
      kind === "video"
        ? videoOutput(sha256)
        : Effect.map(storedOutput(sha256, kind), ({ output }) => output);
    const [baseOut, targetOut] = [yield* outputOf(baseSha256), yield* outputOf(targetSha256)];
    if (baseOut === null || targetOut === null) {
      const same = baseSha256 === targetSha256;
      return {
        method: "bytes",
        units: [
          {
            status: same ? "unchanged" : "changed",
            baseIndex: 0,
            targetIndex: 0,
            difference: same ? 0 : 1,
            anchor: null,
          },
        ],
        settled: false,
      } satisfies ContentComparison;
    }
    if (kind === "video") {
      const [before, after] = [
        yield* timeline(baseSha256, baseOut),
        yield* timeline(targetSha256, targetOut),
      ];
      // A shot at a time, so a long video never holds the server's one thread for seconds.
      const shots = yield* Effect.forEach(after.shots, (shot) =>
        Effect.andThen(
          Effect.yieldNow,
          Effect.sync(() => shotChange(before, after, shot)),
        ),
      );
      return {
        method: "perceptual",
        units: [...shots, ...removedShots(before, after)],
        settled: true,
      } satisfies ContentComparison;
    }
    return yield* compareStills(
      kind,
      { sha256: baseSha256, output: baseOut },
      { sha256: targetSha256, output: targetOut },
    );
  });

  // Content is immutable, so a settled comparison of two hashes never goes stale.
  const comparisons = yield* Cache.makeWith(
    (key: string) => {
      const [kind, baseSha256, targetSha256] = key.split(":") as [DeliverableKind, string, string];
      return compareContent(kind, baseSha256, targetSha256);
    },
    {
      capacity: COMPARISON_CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value.settled ? Duration.infinity : Duration.zero,
    },
  );

  const compareVersions = Effect.fn("DeliverableService.compareVersions")(function* (
    deliverable: Deliverable,
    base: DeliverableRepository.StoredDeliverableVersion,
    target: DeliverableRepository.StoredDeliverableVersion,
  ) {
    const kind = deliverable.kind;
    const { method, units } = yield* Cache.get(
      comparisons,
      contentKey(kind, base.contentSha256, target.contentSha256),
    );
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
        summary: versionSummary(target.summary),
        headline: comparisonHeadline(kind, units),
      } satisfies DeliverableComparison,
      targetUnits: (yield* storedOutput(target.contentSha256, kind)).output?.units ?? [],
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
        yield* repository.deleteDeliverable(stray.id).pipe(persistence);
        yield* events.publish({ type: "changed", projectId: original.projectId });
        return { deliverable: yield* loadDeliverable(original.id) };
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
