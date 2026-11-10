import {
  DeliverableAnchor,
  DeliverableId,
  DeliverableNote,
  DeliverableNoteAuthor,
  DeliverableNoteId,
  DeliverableReviewStatus,
  type MessageId,
  ProjectId,
  type RunId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  type PersistenceDecodeError,
  type PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "./Errors.ts";

export type DeliverableNoteRepositoryError = PersistenceSqlError | PersistenceDecodeError;

const json = <S extends Schema.Top>(schema: S) => Schema.fromJsonString(Schema.toCodecJson(schema));

const { snapshotUrl: _snapshotUrl, ...noteFields } = DeliverableNote.fields;

/** A note as stored: its snapshot is a path in the deliverable store, signed into a URL on read. */
export const StoredDeliverableNote = Schema.Struct({
  ...noteFields,
  snapshotPath: Schema.NullOr(Schema.String),
});
export type StoredDeliverableNote = typeof StoredDeliverableNote.Type;

const NoteRow = Schema.Struct({
  ...StoredDeliverableNote.fields,
  anchor: Schema.NullOr(json(DeliverableAnchor)),
  author: json(DeliverableNoteAuthor),
  checkAnchor: Schema.NullOr(json(DeliverableAnchor)),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  resolvedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});

const ReviewRow = Schema.Struct({
  ...DeliverableReviewStatus.fields,
  updatedAt: Schema.DateTimeUtcFromString,
});

export class DeliverableNoteRepository extends Context.Service<
  DeliverableNoteRepository,
  {
    readonly listNotes: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<StoredDeliverableNote>, DeliverableNoteRepositoryError>;
    readonly getNote: (
      noteId: DeliverableNoteId,
    ) => Effect.Effect<Option.Option<StoredDeliverableNote>, DeliverableNoteRepositoryError>;
    /** Notes sent to the agent in one message, in the order they were written. */
    readonly listNotesSentIn: (
      messageId: MessageId,
    ) => Effect.Effect<ReadonlyArray<StoredDeliverableNote>, DeliverableNoteRepositoryError>;
    /** Inserts or replaces the whole note. */
    readonly putNote: (
      note: StoredDeliverableNote,
    ) => Effect.Effect<void, DeliverableNoteRepositoryError>;
    readonly deleteNote: (
      noteId: DeliverableNoteId,
    ) => Effect.Effect<void, DeliverableNoteRepositoryError>;
    /** Links notes sent by `messageId` to the run it started; returns their projects. */
    readonly linkRun: (input: {
      readonly messageId: MessageId;
      readonly runId: RunId;
    }) => Effect.Effect<ReadonlyArray<ProjectId>, DeliverableNoteRepositoryError>;
    /** Projects with notes sent in or addressed by `runId`. */
    readonly projectsForRun: (
      runId: RunId,
    ) => Effect.Effect<ReadonlyArray<ProjectId>, DeliverableNoteRepositoryError>;
    readonly listReviews: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<DeliverableReviewStatus>, DeliverableNoteRepositoryError>;
    readonly putReview: (
      review: DeliverableReviewStatus,
    ) => Effect.Effect<void, DeliverableNoteRepositoryError>;
    readonly deleteReview: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<void, DeliverableNoteRepositoryError>;
  }
>()("t3/persistence/DeliverableNotes/DeliverableNoteRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sqlError = (operation: string) => (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(operation)(cause)
      : toPersistenceSqlError(operation)(cause);

  const findNotes = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      noteId: Schema.optional(DeliverableNoteId),
      sentMessageId: Schema.optional(Schema.String),
    }),
    Result: NoteRow,
    execute: (request) => sql`
      SELECT
        note_id AS "id",
        project_id AS "projectId",
        deliverable_id AS "deliverableId",
        version_id AS "versionId",
        anchor_json AS "anchor",
        body,
        author_json AS "author",
        snapshot_path AS "snapshotPath",
        status,
        thread_id AS "threadId",
        sent_message_id AS "sentMessageId",
        sent_run_id AS "sentRunId",
        addressed_run_id AS "addressedRunId",
        reply,
        check_anchor_json AS "checkAnchor",
        fixed_in_version_id AS "fixedInVersionId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        resolved_at AS "resolvedAt"
      FROM deliverable_notes
      WHERE ${sql.and([
        ...(request.projectId === undefined ? [] : [sql`project_id = ${request.projectId}`]),
        ...(request.noteId === undefined ? [] : [sql`note_id = ${request.noteId}`]),
        ...(request.sentMessageId === undefined
          ? []
          : [sql`sent_message_id = ${request.sentMessageId}`]),
      ])}
      ORDER BY created_at ASC, note_id ASC
    `,
  });

  const findReviews = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: ReviewRow,
    execute: ({ projectId }) => sql`
      SELECT
        r.deliverable_id AS "deliverableId",
        r.state,
        r.version_id AS "versionId",
        r.source,
        r.label,
        r.url,
        r.updated_at AS "updatedAt"
      FROM deliverable_review_status r
      JOIN deliverables d ON d.deliverable_id = r.deliverable_id
      WHERE d.project_id = ${projectId}
    `,
  });

  const encodeNote = Schema.encodeEffect(NoteRow);
  const encodeReview = Schema.encodeEffect(ReviewRow);

  return DeliverableNoteRepository.of({
    listNotes: Effect.fn("DeliverableNoteRepository.listNotes")(function* (projectId) {
      return yield* findNotes({ projectId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("listNotes")),
      );
    }),
    getNote: Effect.fn("DeliverableNoteRepository.getNote")(function* (noteId) {
      const rows = yield* findNotes({ noteId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("getNote")),
      );
      return Option.fromNullishOr(rows[0]);
    }),
    listNotesSentIn: Effect.fn("DeliverableNoteRepository.listNotesSentIn")(function* (messageId) {
      return yield* findNotes({ sentMessageId: messageId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("listNotesSentIn")),
      );
    }),
    putNote: Effect.fn("DeliverableNoteRepository.putNote")(
      function* (note) {
        const row = yield* encodeNote(note);
        yield* sql`
          INSERT INTO deliverable_notes (
            note_id, project_id, deliverable_id, version_id, anchor_json, body, author_json,
            snapshot_path, status, thread_id, sent_message_id, sent_run_id, addressed_run_id,
            reply, check_anchor_json, fixed_in_version_id, created_at, updated_at, resolved_at
          ) VALUES (
            ${row.id}, ${row.projectId}, ${row.deliverableId}, ${row.versionId}, ${row.anchor},
            ${row.body}, ${row.author}, ${row.snapshotPath}, ${row.status}, ${row.threadId},
            ${row.sentMessageId}, ${row.sentRunId}, ${row.addressedRunId}, ${row.reply},
            ${row.checkAnchor}, ${row.fixedInVersionId}, ${row.createdAt}, ${row.updatedAt},
            ${row.resolvedAt}
          )
          ON CONFLICT (note_id) DO UPDATE SET
            anchor_json = excluded.anchor_json,
            body = excluded.body,
            snapshot_path = excluded.snapshot_path,
            status = excluded.status,
            thread_id = excluded.thread_id,
            sent_message_id = excluded.sent_message_id,
            sent_run_id = excluded.sent_run_id,
            addressed_run_id = excluded.addressed_run_id,
            reply = excluded.reply,
            check_anchor_json = excluded.check_anchor_json,
            fixed_in_version_id = excluded.fixed_in_version_id,
            updated_at = excluded.updated_at,
            resolved_at = excluded.resolved_at
        `;
      },
      Effect.mapError(sqlError("putNote")),
    ),
    deleteNote: Effect.fn("DeliverableNoteRepository.deleteNote")(
      function* (noteId) {
        yield* sql`DELETE FROM deliverable_notes WHERE note_id = ${noteId}`;
      },
      Effect.mapError(sqlError("deleteNote")),
    ),
    linkRun: Effect.fn("DeliverableNoteRepository.linkRun")(
      function* (input) {
        const rows = yield* sql<{ readonly projectId: ProjectId }>`
          UPDATE deliverable_notes SET sent_run_id = ${input.runId}
          WHERE sent_message_id = ${input.messageId}
            AND (sent_run_id IS NULL OR sent_run_id <> ${input.runId})
          RETURNING project_id AS "projectId"
        `;
        return [...new Set(rows.map((row) => row.projectId))];
      },
      Effect.mapError(sqlError("linkRun")),
    ),
    projectsForRun: Effect.fn("DeliverableNoteRepository.projectsForRun")(
      function* (runId) {
        const rows = yield* sql<{ readonly projectId: ProjectId }>`
          SELECT DISTINCT project_id AS "projectId" FROM deliverable_notes
          WHERE sent_run_id = ${runId} OR addressed_run_id = ${runId}
        `.pipe(NodeSqliteClient.readOnly);
        return rows.map((row) => row.projectId);
      },
      Effect.mapError(sqlError("projectsForRun")),
    ),
    listReviews: Effect.fn("DeliverableNoteRepository.listReviews")(function* (projectId) {
      return yield* findReviews({ projectId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("listReviews")),
      );
    }),
    putReview: Effect.fn("DeliverableNoteRepository.putReview")(
      function* (review) {
        const row = yield* encodeReview(review);
        yield* sql`
          INSERT INTO deliverable_review_status (
            deliverable_id, state, version_id, source, label, url, updated_at
          ) VALUES (
            ${row.deliverableId}, ${row.state}, ${row.versionId}, ${row.source}, ${row.label},
            ${row.url}, ${row.updatedAt}
          )
          ON CONFLICT (deliverable_id) DO UPDATE SET
            state = excluded.state,
            version_id = excluded.version_id,
            source = excluded.source,
            label = excluded.label,
            url = excluded.url,
            updated_at = excluded.updated_at
        `;
      },
      Effect.mapError(sqlError("putReview")),
    ),
    deleteReview: Effect.fn("DeliverableNoteRepository.deleteReview")(
      function* (deliverableId) {
        yield* sql`DELETE FROM deliverable_review_status WHERE deliverable_id = ${deliverableId}`;
      },
      Effect.mapError(sqlError("deleteReview")),
    ),
  });
});

export const layer = Layer.effect(DeliverableNoteRepository, make);
