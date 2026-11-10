import * as Schema from "effect/Schema";

import { MessageId, ProjectId, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  Deliverable,
  DeliverableAnchor,
  DeliverableId,
  DeliverableVersion,
  DeliverableVersionId,
} from "./deliverables.ts";

export const DeliverableNoteId = TrimmedNonEmptyString.pipe(Schema.brand("DeliverableNoteId"));
export type DeliverableNoteId = typeof DeliverableNoteId.Type;

/**
 * `open` until sent to the agent, `fixing` while its turn runs, `fixed` once a version addressed
 * it (check it in `fixedInVersionId`), `resolved` when the user accepts the fix.
 */
export const DeliverableNoteStatus = Schema.Literals(["open", "fixing", "fixed", "resolved"]);
export type DeliverableNoteStatus = typeof DeliverableNoteStatus.Type;

export const DeliverableNoteAuthor = Schema.Struct({
  kind: Schema.Literals(["user", "agent", "external"]),
  name: Schema.NullOr(Schema.String),
  /** Where an external note came from, such as a review app or a share link. */
  source: Schema.NullOr(Schema.String),
});
export type DeliverableNoteAuthor = typeof DeliverableNoteAuthor.Type;

export const DeliverableNote = Schema.Struct({
  id: DeliverableNoteId,
  projectId: ProjectId,
  deliverableId: DeliverableId,
  /** The version the note was left on. */
  versionId: DeliverableVersionId,
  /** Where it points; null means the whole deliverable. */
  anchor: Schema.NullOr(DeliverableAnchor),
  body: Schema.String,
  author: DeliverableNoteAuthor,
  /**
   * A picture of where the note points: the user's drawing on the frame when their client sent
   * one, else the frame or slide the server made with the note's area outlined.
   */
  snapshotUrl: Schema.NullOr(Schema.String),
  status: DeliverableNoteStatus,
  threadId: Schema.NullOr(ThreadId),
  /** The user message that sent it to the agent, and the run that message started. */
  sentMessageId: Schema.NullOr(MessageId),
  sentRunId: Schema.NullOr(RunId),
  /** The run whose agent said it addressed the note. */
  addressedRunId: Schema.NullOr(RunId),
  /** The agent's one- or two-line answer. */
  reply: Schema.NullOr(Schema.String),
  /** Where to look to check the fix. */
  checkAnchor: Schema.NullOr(DeliverableAnchor),
  fixedInVersionId: Schema.NullOr(DeliverableVersionId),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  resolvedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type DeliverableNote = typeof DeliverableNote.Type;

/** Fed by an external review integration; Work mode shows it on the project shelf. */
export const DeliverableReviewState = Schema.Literals(["in_review", "final"]);
export type DeliverableReviewState = typeof DeliverableReviewState.Type;

export const DeliverableReviewStatus = Schema.Struct({
  deliverableId: DeliverableId,
  state: DeliverableReviewState,
  versionId: Schema.NullOr(DeliverableVersionId),
  source: TrimmedNonEmptyString,
  label: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateTimeUtc,
});
export type DeliverableReviewStatus = typeof DeliverableReviewStatus.Type;

/** Everything a Work project view renders, re-sent whenever any of it changes. */
export const WorkProjectSnapshot = Schema.Struct({
  projectId: ProjectId,
  deliverables: Schema.Array(Deliverable),
  versions: Schema.Array(DeliverableVersion),
  /** Rendered posters of current versions; URLs expire after an hour. */
  posters: Schema.Array(Schema.Struct({ versionId: DeliverableVersionId, url: Schema.String })),
  notes: Schema.Array(DeliverableNote),
  reviews: Schema.Array(DeliverableReviewStatus),
});
export type WorkProjectSnapshot = typeof WorkProjectSnapshot.Type;

export const WorkProjectSubscribeInput = Schema.Struct({ projectId: ProjectId });
export type WorkProjectSubscribeInput = typeof WorkProjectSubscribeInput.Type;

const DELIVERABLE_NOTE_MAX_BODY = 4_000;
/** A PNG data URL of about 6 MB. */
const DELIVERABLE_NOTE_MAX_SNAPSHOT_CHARS = 8_000_000;

export const DeliverableNoteCreateInput = Schema.Struct({
  deliverableId: DeliverableId,
  versionId: DeliverableVersionId,
  anchor: Schema.NullOr(DeliverableAnchor),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(DELIVERABLE_NOTE_MAX_BODY)),
  /** Omitted for the user's own notes; review integrations name the reviewer. */
  author: Schema.optional(
    Schema.Struct({
      kind: Schema.Literal("external"),
      name: Schema.NullOr(Schema.String),
      source: TrimmedNonEmptyString,
    }),
  ),
  /**
   * Only for what the server cannot make from the anchor, such as a freehand drawing. Left out,
   * the server makes the note's picture from the stored version.
   */
  snapshotDataUrl: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(DELIVERABLE_NOTE_MAX_SNAPSHOT_CHARS),
      Schema.isPattern(/^data:image\/png;base64,/),
    ),
  ),
});
export type DeliverableNoteCreateInput = typeof DeliverableNoteCreateInput.Type;

/** Recorded before the message goes out, so the run it starts links back to the notes. */
export const DeliverableNotesMarkSentInput = Schema.Struct({
  noteIds: Schema.Array(DeliverableNoteId).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  threadId: ThreadId,
  messageId: MessageId,
});
export type DeliverableNotesMarkSentInput = typeof DeliverableNotesMarkSentInput.Type;

export const DeliverableNoteSetStatusInput = Schema.Struct({
  noteId: DeliverableNoteId,
  status: Schema.Literals(["open", "resolved"]),
});
export type DeliverableNoteSetStatusInput = typeof DeliverableNoteSetStatusInput.Type;

export const DeliverableNoteRef = Schema.Struct({ noteId: DeliverableNoteId });
export type DeliverableNoteRef = typeof DeliverableNoteRef.Type;

export const DeliverableReviewStatusSetInput = Schema.Struct({
  deliverableId: DeliverableId,
  /** Null clears it. */
  state: Schema.NullOr(DeliverableReviewState),
  source: TrimmedNonEmptyString,
  versionId: Schema.optional(DeliverableVersionId),
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type DeliverableReviewStatusSetInput = typeof DeliverableReviewStatusSetInput.Type;

export const DeliverableNotesResult = Schema.Struct({ notes: Schema.Array(DeliverableNote) });
export type DeliverableNotesResult = typeof DeliverableNotesResult.Type;

const DELIVERABLE_NOTE_FAILURE_MESSAGES = {
  project_not_found: "That project does not exist here.",
  deliverable_not_found: "That deliverable does not exist.",
  version_not_found: "That deliverable version does not exist.",
  version_mismatch: "That version belongs to a different deliverable.",
  note_not_found: "That note does not exist.",
  note_resolved: "That note is resolved; reopen it first.",
  snapshot_invalid: "The note's snapshot is not a PNG image.",
  storage_failed: "Could not store the note's snapshot.",
  persistence_failed: "Could not read or write notes.",
} as const;

export const DeliverableNoteFailureReason = Schema.Literals(
  Object.keys(DELIVERABLE_NOTE_FAILURE_MESSAGES) as Array<
    keyof typeof DELIVERABLE_NOTE_FAILURE_MESSAGES
  >,
);
export type DeliverableNoteFailureReason = typeof DeliverableNoteFailureReason.Type;

export class DeliverableNoteError extends Schema.TaggedError<DeliverableNoteError>()(
  "DeliverableNoteError",
  {
    reason: DeliverableNoteFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return DELIVERABLE_NOTE_FAILURE_MESSAGES[this.reason];
  }
}
