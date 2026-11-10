import * as Schema from "effect/Schema";

import {
  CheckpointId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const DeliverableId = TrimmedNonEmptyString.pipe(Schema.brand("DeliverableId"));
export type DeliverableId = typeof DeliverableId.Type;

export const DeliverableVersionId = TrimmedNonEmptyString.pipe(
  Schema.brand("DeliverableVersionId"),
);
export type DeliverableVersionId = typeof DeliverableVersionId.Type;

export const DeliverableKind = Schema.Literals(["deck", "video", "image", "pdf", "other"]);
export type DeliverableKind = typeof DeliverableKind.Type;

const KIND_BY_EXTENSION: Readonly<Record<string, DeliverableKind>> = {
  pptx: "deck",
  ppt: "deck",
  key: "deck",
  odp: "deck",
  mp4: "video",
  mov: "video",
  m4v: "video",
  webm: "video",
  mkv: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  pdf: "pdf",
};

/** The kind a file is by its extension; `other` for anything Work mode cannot render. */
export const deliverableKindForPath = (path: string): DeliverableKind => {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "other";
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "other";
};

/** Kinds registered automatically when a turn's checkpoint shows them changed. */
export const AUTO_DETECTED_DELIVERABLE_KINDS: ReadonlySet<DeliverableKind> = new Set([
  "deck",
  "video",
  "pdf",
]);

/** A normalized rectangle: 0..1 of the unit's width and height, origin top-left. */
export const DeliverableRegion = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
});
export type DeliverableRegion = typeof DeliverableRegion.Type;

/**
 * Where a note, a change, or an expectation points inside a deliverable.
 * Shared by Work-mode notes, comparisons and the external review app.
 */
export const DeliverableAnchor = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("time"),
    t: Schema.Number,
    tEnd: Schema.optional(Schema.Number),
    region: Schema.optional(DeliverableRegion),
  }),
  Schema.Struct({
    kind: Schema.Literal("slide"),
    /** Zero-based slide index. */
    index: NonNegativeInt,
    region: Schema.optional(DeliverableRegion),
  }),
  Schema.Struct({ kind: Schema.Literal("region"), ...DeliverableRegion.fields }),
]);
export type DeliverableAnchor = typeof DeliverableAnchor.Type;

export const DeliverableVersionSource = Schema.Union([
  /** Detected from the checkpoint a finished turn captured. */
  Schema.Struct({
    type: Schema.Literal("checkpoint"),
    threadId: ThreadId,
    runId: RunId,
    checkpointId: CheckpointId,
  }),
  /** Registered by an agent tool call or a client. */
  Schema.Struct({
    type: Schema.Literal("explicit"),
    threadId: Schema.optional(ThreadId),
    runId: Schema.optional(RunId),
  }),
]);
export type DeliverableVersionSource = typeof DeliverableVersionSource.Type;

export const DeliverableRenditionStatus = Schema.Literals([
  "pending",
  "rendering",
  "ready",
  "failed",
  "unsupported",
]);
export type DeliverableRenditionStatus = typeof DeliverableRenditionStatus.Type;

export const DeliverableSelfCheckResult = Schema.Struct({
  check: TrimmedNonEmptyString,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  findings: Schema.Array(Schema.String),
  checkedAt: Schema.DateTimeUtc,
});
export type DeliverableSelfCheckResult = typeof DeliverableSelfCheckResult.Type;

export const Deliverable = Schema.Struct({
  id: DeliverableId,
  projectId: ProjectId,
  kind: DeliverableKind,
  /** Workspace-relative, forward slashes. */
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  currentVersionId: Schema.NullOr(DeliverableVersionId),
  versionCount: NonNegativeInt,
  /**
   * The deliverable this file looks like a revision of, saved under a new name (`deck-v2.pptx`
   * beside `deck.pptx`) in a turn that left the original alone. Work mode offers to adopt it.
   */
  strayVersionOf: Schema.optional(Schema.NullOr(DeliverableId)),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});
export type Deliverable = typeof Deliverable.Type;

export const DeliverableVersion = Schema.Struct({
  id: DeliverableVersionId,
  deliverableId: DeliverableId,
  /** 1 for V1. */
  ordinal: PositiveInt,
  /** The version this one was made from; versions after an undo fork from it. */
  parentVersionId: Schema.NullOr(DeliverableVersionId),
  contentSha256: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  /** The immutable Git commit that snapshots the project at this version. */
  commitOid: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  source: DeliverableVersionSource,
  /** One plain-text line from the turn that made it. */
  summary: Schema.NullOr(Schema.String),
  /** The text the summary was taken from, when it says more than the summary does. */
  summaryDetail: Schema.optional(Schema.String),
  expectedChanges: Schema.Array(DeliverableAnchor),
  renditionStatus: DeliverableRenditionStatus,
  selfCheck: Schema.NullOr(DeliverableSelfCheckResult),
  createdAt: Schema.DateTimeUtc,
});
export type DeliverableVersion = typeof DeliverableVersion.Type;

export const DeliverableRenditionUnit = Schema.Struct({
  index: NonNegativeInt,
  kind: Schema.Literals(["slide", "shot", "page", "image"]),
  /** Seconds, for shots. */
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  thumbUrl: Schema.NullOr(Schema.String),
});
export type DeliverableRenditionUnit = typeof DeliverableRenditionUnit.Type;

export const DeliverableRendition = Schema.Struct({
  versionId: DeliverableVersionId,
  status: DeliverableRenditionStatus,
  renderer: Schema.NullOr(Schema.String),
  /** Why rendering failed or is unsupported, including what to install. */
  detail: Schema.NullOr(Schema.String),
  width: Schema.NullOr(NonNegativeInt),
  height: Schema.NullOr(NonNegativeInt),
  durationSeconds: Schema.NullOr(Schema.Number),
  sourceUrl: Schema.NullOr(Schema.String),
  posterUrl: Schema.NullOr(Schema.String),
  proxyUrl: Schema.NullOr(Schema.String),
  units: Schema.Array(DeliverableRenditionUnit),
});
export type DeliverableRendition = typeof DeliverableRendition.Type;

export const DeliverableUnitChangeStatus = Schema.Literals([
  "changed",
  "unchanged",
  "added",
  "removed",
  /** The same slide or shot at another place in the order; `difference` says if it also changed. */
  "moved",
]);
export type DeliverableUnitChangeStatus = typeof DeliverableUnitChangeStatus.Type;

export const DeliverableUnitChange = Schema.Struct({
  status: DeliverableUnitChangeStatus,
  baseIndex: Schema.NullOr(NonNegativeInt),
  targetIndex: Schema.NullOr(NonNegativeInt),
  /** 0 identical .. 1 completely different. */
  difference: Schema.Number,
  /** Where the change is, when the comparison could localize it. */
  anchor: Schema.NullOr(DeliverableAnchor),
});
export type DeliverableUnitChange = typeof DeliverableUnitChange.Type;

/** Why two versions have no comparison yet, or cannot have one. */
export const DeliverableComparisonUnavailableReason = Schema.Literals([
  "rendering",
  "render_failed",
  "source_missing",
  "comparison_failed",
]);
export type DeliverableComparisonUnavailableReason =
  typeof DeliverableComparisonUnavailableReason.Type;

export const DeliverableComparisonUnavailable = Schema.Struct({
  reason: DeliverableComparisonUnavailableReason,
  /** The version that holds it up; null when the comparison itself failed. */
  versionId: Schema.NullOr(DeliverableVersionId),
  /** The cause in plain words, ready to show. */
  message: Schema.String,
});
export type DeliverableComparisonUnavailable = typeof DeliverableComparisonUnavailable.Type;

export const DeliverableComparison = Schema.Struct({
  deliverableId: DeliverableId,
  kind: DeliverableKind,
  baseVersionId: DeliverableVersionId,
  targetVersionId: DeliverableVersionId,
  /** `perceptual` compares rendered pixels; `structural` compares file parts when no renderer ran. */
  method: Schema.Literals(["perceptual", "structural", "bytes"]),
  units: Schema.Array(DeliverableUnitChange),
  counts: Schema.Struct({
    changed: NonNegativeInt,
    unchanged: NonNegativeInt,
    added: NonNegativeInt,
    removed: NonNegativeInt,
    moved: NonNegativeInt,
  }),
  /** The target version's summary from the turn that made it. */
  summary: Schema.NullOr(Schema.String),
  headline: Schema.String,
  /** Set when the versions could not be compared; `units` is then empty. */
  unavailable: Schema.NullOr(DeliverableComparisonUnavailable),
});
export type DeliverableComparison = typeof DeliverableComparison.Type;

export const DeliverableVersionGraphNode = Schema.Struct({
  versionId: DeliverableVersionId,
  ordinal: PositiveInt,
  parentVersionId: Schema.NullOr(DeliverableVersionId),
  childVersionIds: Schema.Array(DeliverableVersionId),
  isCurrent: Schema.Boolean,
  /** On the line from V1 to the current version or the redo path beyond it. */
  onCurrentLine: Schema.Boolean,
  /** Left behind when a new edit forked after an undo; still restorable. */
  alternate: Schema.Boolean,
});
export type DeliverableVersionGraphNode = typeof DeliverableVersionGraphNode.Type;

export const DeliverableVersionGraph = Schema.Struct({
  deliverableId: DeliverableId,
  currentVersionId: Schema.NullOr(DeliverableVersionId),
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  nodes: Schema.Array(DeliverableVersionGraphNode),
});
export type DeliverableVersionGraph = typeof DeliverableVersionGraph.Type;

export const DeliverablesListInput = Schema.Struct({ projectId: ProjectId });
export const DeliverablesListResult = Schema.Struct({ deliverables: Schema.Array(Deliverable) });
export type DeliverablesListResult = typeof DeliverablesListResult.Type;

export const DeliverableRef = Schema.Struct({ deliverableId: DeliverableId });
export type DeliverableRef = typeof DeliverableRef.Type;

export const DeliverableVersionsResult = Schema.Struct({
  deliverable: Deliverable,
  versions: Schema.Array(DeliverableVersion),
});
export type DeliverableVersionsResult = typeof DeliverableVersionsResult.Type;

export const DeliverableVersionRef = Schema.Struct({ versionId: DeliverableVersionId });
export type DeliverableVersionRef = typeof DeliverableVersionRef.Type;

export const DeliverableCompareInput = Schema.Struct({
  /** Defaults to the version the target was made from. */
  baseVersionId: Schema.optional(DeliverableVersionId),
  targetVersionId: DeliverableVersionId,
});
export type DeliverableCompareInput = typeof DeliverableCompareInput.Type;

export const DeliverableRegisterVersionInput = Schema.Struct({
  projectId: ProjectId,
  /** Workspace-relative or absolute inside the project. */
  path: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  /** Where the request said the change should land; checked once renditions are ready. */
  expectedChanges: Schema.optional(Schema.Array(DeliverableAnchor).check(Schema.isMaxLength(64))),
  threadId: Schema.optional(ThreadId),
  runId: Schema.optional(RunId),
});
export type DeliverableRegisterVersionInput = typeof DeliverableRegisterVersionInput.Type;

export const DeliverableRegisterVersionResult = Schema.Struct({
  deliverable: Deliverable,
  version: DeliverableVersion,
  /** False when the file matched the current version and nothing was recorded. */
  created: Schema.Boolean,
});
export type DeliverableRegisterVersionResult = typeof DeliverableRegisterVersionResult.Type;

export const DeliverableRestoreInput = Schema.Struct({
  deliverableId: DeliverableId,
  versionId: DeliverableVersionId,
});
export type DeliverableRestoreInput = typeof DeliverableRestoreInput.Type;

/** Adopt a stray file as the next version of the deliverable it revises, or keep it separate. */
export const DeliverableResolveStrayInput = Schema.Struct({
  deliverableId: DeliverableId,
  adopt: Schema.Boolean,
});
export type DeliverableResolveStrayInput = typeof DeliverableResolveStrayInput.Type;

export const DeliverableResolveStrayResult = Schema.Struct({
  /** The original with its new version after adopting; the kept file otherwise. */
  deliverable: Deliverable,
});
export type DeliverableResolveStrayResult = typeof DeliverableResolveStrayResult.Type;

export const DeliverableRestoreResult = Schema.Struct({
  deliverable: Deliverable,
  graph: DeliverableVersionGraph,
  /** Workspace paths written or removed to match the restored version. */
  restoredPaths: Schema.Array(Schema.String),
});
export type DeliverableRestoreResult = typeof DeliverableRestoreResult.Type;

const DELIVERABLE_FAILURE_MESSAGES = {
  project_not_found: "That project does not exist here.",
  deliverable_not_found: "That deliverable does not exist.",
  version_not_found: "That deliverable version does not exist.",
  path_outside_project: "The file is outside the project's workspace.",
  file_not_found: "The file does not exist.",
  unsupported_kind: "That file is not a deck, video, image or PDF.",
  version_mismatch: "Those versions belong to different deliverables.",
  no_base_version: "This is the first version; name a version to compare it with.",
  nothing_to_undo: "This is the first version; there is nothing to undo.",
  nothing_to_redo: "There is no later version to redo.",
  turn_running:
    "An agent turn is running in this project. Wait for it to finish, then undo or restore.",
  not_stray: "That file is no longer offered as a version of another deliverable.",
  workspace_changed:
    "Files this restore would overwrite changed since the current version. Register or discard those changes first.",
  storage_failed: "Could not read or write deliverable storage.",
  git_failed: "A Git operation on the project failed.",
  persistence_failed: "Could not read or write deliverable records.",
} as const;

export const DeliverableFailureReason = Schema.Literals(
  Object.keys(DELIVERABLE_FAILURE_MESSAGES) as Array<keyof typeof DELIVERABLE_FAILURE_MESSAGES>,
);
export type DeliverableFailureReason = typeof DeliverableFailureReason.Type;

export class DeliverableError extends Schema.TaggedError<DeliverableError>()("DeliverableError", {
  reason: DeliverableFailureReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return DELIVERABLE_FAILURE_MESSAGES[this.reason];
  }
}
