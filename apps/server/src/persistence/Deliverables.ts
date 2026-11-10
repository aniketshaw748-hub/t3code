import {
  Deliverable,
  DeliverableAnchor,
  DeliverableId,
  DeliverableKind,
  DeliverableRenditionStatus,
  DeliverableSelfCheckResult,
  DeliverableVersion,
  DeliverableVersionId,
  DeliverableVersionSource,
  ProjectId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
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

export type DeliverableRepositoryError = PersistenceSqlError | PersistenceDecodeError;

const json = <S extends Schema.Top>(schema: S) => Schema.fromJsonString(Schema.toCodecJson(schema));

const DeliverableRow = Schema.Struct({
  ...Deliverable.fields,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

export const StoredDeliverableVersion = Schema.Struct({
  ...DeliverableVersion.fields,
  /** Git blob id of the deliverable file in the snapshot, for cheap change detection. */
  sourceBlobOid: Schema.NullOr(Schema.String),
});
export type StoredDeliverableVersion = typeof StoredDeliverableVersion.Type;

const VersionRow = Schema.Struct({
  ...StoredDeliverableVersion.fields,
  source: json(DeliverableVersionSource),
  expectedChanges: json(Schema.Array(DeliverableAnchor)),
  selfCheck: Schema.NullOr(json(DeliverableSelfCheckResult)),
  createdAt: Schema.DateTimeUtcFromString,
});

/** What a renderer produced for one content hash, kept as opaque JSON the service owns. */
export const StoredRendition = Schema.Struct({
  contentSha256: Schema.String,
  kind: DeliverableKind,
  status: DeliverableRenditionStatus,
  renderer: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  data: Schema.NullOr(Schema.Unknown),
  updatedAt: Schema.DateTimeUtc,
});
export type StoredRendition = typeof StoredRendition.Type;

const RenditionRow = Schema.Struct({
  ...StoredRendition.fields,
  data: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  updatedAt: Schema.DateTimeUtcFromString,
});

export interface NewDeliverableVersion {
  readonly version: StoredDeliverableVersion;
  /** Moves the deliverable's current pointer to the new version in the same transaction. */
  readonly updatedAt: DateTime.Utc;
  /** Content hashes of every stored file the version's snapshot points at. */
  readonly blobs: ReadonlyArray<string>;
}

/** What the deliverable store must keep: everything else in it is left over. */
export interface StoreReferences {
  /** Content hashes of stored files that a version, its snapshot or a note still points at. */
  readonly blobs: ReadonlySet<string>;
  /** `renditionKey` of every rendition some version shows. */
  readonly renditions: ReadonlySet<string>;
  /** Store-relative paths of note snapshots. */
  readonly noteSnapshots: ReadonlySet<string>;
}

export const renditionKey = (content: {
  readonly contentSha256: string;
  readonly kind: DeliverableKind;
}) => `${content.contentSha256}:${content.kind}`;

export class DeliverableRepository extends Context.Service<
  DeliverableRepository,
  {
    readonly listDeliverables: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<Deliverable>, DeliverableRepositoryError>;
    readonly getDeliverable: (
      id: DeliverableId,
    ) => Effect.Effect<Option.Option<Deliverable>, DeliverableRepositoryError>;
    readonly findDeliverableByPath: (input: {
      readonly projectId: ProjectId;
      readonly path: string;
    }) => Effect.Effect<Option.Option<Deliverable>, DeliverableRepositoryError>;
    readonly insertDeliverable: (
      deliverable: Deliverable,
    ) => Effect.Effect<void, DeliverableRepositoryError>;
    readonly setCurrentVersion: (input: {
      readonly deliverableId: DeliverableId;
      readonly versionId: DeliverableVersionId;
      readonly updatedAt: DateTime.Utc;
      readonly restore?: {
        readonly restoreId: string;
        readonly action: "undo" | "redo" | "restore";
        readonly fromVersionId: DeliverableVersionId | null;
      };
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    readonly setStrayVersionOf: (input: {
      readonly deliverableId: DeliverableId;
      readonly strayVersionOf: DeliverableId | null;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /**
     * Removes a deliverable with its versions, notes, restores and review status in one step. The
     * same step records its version refs as owed to Git under `workspaceRoot`. What it stored is
     * left for cleanup.
     */
    readonly deleteDeliverable: (input: {
      readonly deliverableId: DeliverableId;
      readonly workspaceRoot: string;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /** Every project that has deliverables, whether or not the project still exists. */
    readonly listProjects: Effect.Effect<ReadonlyArray<ProjectId>, DeliverableRepositoryError>;
    /** How much Work history one project holds. */
    readonly countHistory: (projectId: ProjectId) => Effect.Effect<
      {
        readonly deliverableCount: number;
        readonly versionCount: number;
        readonly noteCount: number;
      },
      DeliverableRepositoryError
    >;
    /** Records a person's decision to delete a project's Work history, to be carried out. */
    readonly requestHistoryPurge: (input: {
      readonly projectId: ProjectId;
      readonly requestedAt: DateTime.Utc;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /** Decisions recorded and not yet carried out, oldest first. */
    readonly listPendingHistoryPurges: Effect.Effect<
      ReadonlyArray<ProjectId>,
      DeliverableRepositoryError
    >;
    /** Withdraws a decision that was not carried out, because the project is in use again. */
    readonly cancelHistoryPurge: (
      projectId: ProjectId,
    ) => Effect.Effect<void, DeliverableRepositoryError>;
    /**
     * Deletes every deliverable of the project as `deleteDeliverable` does and marks the decision
     * carried out, all in one step. Does nothing and returns null without a pending decision.
     */
    readonly purgeProjectHistory: (input: {
      readonly projectId: ProjectId;
      readonly workspaceRoot: string;
      readonly completedAt: DateTime.Utc;
    }) => Effect.Effect<number | null, DeliverableRepositoryError>;
    /** Version refs of deleted history that Git has not confirmed gone. */
    readonly listPendingRefDeletions: Effect.Effect<
      ReadonlyArray<{ readonly workspaceRoot: string; readonly ref: string }>,
      DeliverableRepositoryError
    >;
    readonly completeRefDeletions: (input: {
      readonly workspaceRoot: string;
      readonly refs: ReadonlyArray<string>;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /**
     * Makes every change committed so far survive a power cut, and says whether it did. Commits
     * here are not synced one by one, so this comes before any file a deleted row named is removed.
     */
    readonly flushToDisk: Effect.Effect<boolean, DeliverableRepositoryError>;
    /** What these projects' history keeps in the store, and what everything else keeps. */
    readonly storeReferencesSplit: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<
      { readonly held: StoreReferences; readonly elsewhere: StoreReferences },
      DeliverableRepositoryError
    >;
    readonly listVersions: (
      deliverableId: DeliverableId,
    ) => Effect.Effect<ReadonlyArray<StoredDeliverableVersion>, DeliverableRepositoryError>;
    readonly getVersion: (
      versionId: DeliverableVersionId,
    ) => Effect.Effect<Option.Option<StoredDeliverableVersion>, DeliverableRepositoryError>;
    readonly insertVersion: (
      input: NewDeliverableVersion,
    ) => Effect.Effect<void, DeliverableRepositoryError>;
    /**
     * Versions with work left for the render queue, oldest first: content with no finished
     * rendition, or expected changes that have no self-check yet.
     */
    readonly listUnfinished: Effect.Effect<
      ReadonlyArray<DeliverableVersionId>,
      DeliverableRepositoryError
    >;
    /** Undo, redo and restore actions in the project after `since`, oldest first. */
    readonly listRestoresSince: (input: {
      readonly projectId: ProjectId;
      readonly since: DateTime.Utc;
    }) => Effect.Effect<
      ReadonlyArray<{
        readonly action: "undo" | "redo" | "restore";
        readonly path: string;
        readonly ordinal: number;
      }>,
      DeliverableRepositoryError
    >;
    /** Records a version's self-check, or clears it with null so it runs again. */
    readonly setSelfCheck: (input: {
      readonly versionId: DeliverableVersionId;
      readonly result: DeliverableSelfCheckResult | null;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    readonly getRendition: (input: {
      readonly contentSha256: string;
      readonly kind: DeliverableKind;
    }) => Effect.Effect<Option.Option<StoredRendition>, DeliverableRepositoryError>;
    readonly putRendition: (
      rendition: StoredRendition,
    ) => Effect.Effect<void, DeliverableRepositoryError>;
    readonly listRenditions: Effect.Effect<
      ReadonlyArray<StoredRendition>,
      DeliverableRepositoryError
    >;
    readonly deleteRendition: (input: {
      readonly contentSha256: string;
      readonly kind: DeliverableKind;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /**
     * Puts renditions a process left mid-render back in line: nothing is rendering when a server
     * starts. Returns how many there were.
     */
    readonly requeueInterruptedRenditions: Effect.Effect<number, DeliverableRepositoryError>;
    readonly storeReferences: Effect.Effect<StoreReferences, DeliverableRepositoryError>;
    /** Versions recorded before snapshots listed their stored files, with where to read them. */
    readonly listVersionsWithoutBlobs: Effect.Effect<
      ReadonlyArray<{
        readonly versionId: DeliverableVersionId;
        readonly projectId: ProjectId;
        readonly commitOid: string;
        readonly contentSha256: string;
      }>,
      DeliverableRepositoryError
    >;
    readonly recordVersionBlobs: (input: {
      readonly versionId: DeliverableVersionId;
      readonly blobs: ReadonlyArray<string>;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
    /** Forgets which Git blobs held this content, so the bytes are stored afresh if seen again. */
    readonly forgetBlob: (contentSha256: string) => Effect.Effect<void, DeliverableRepositoryError>;
    /** Content hashes already stored for these Git blob ids. */
    readonly lookupBlobs: (
      gitBlobOids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, string>, DeliverableRepositoryError>;
    readonly recordBlob: (input: {
      readonly gitBlobOid: string;
      readonly contentSha256: string;
      readonly sizeBytes: number;
    }) => Effect.Effect<void, DeliverableRepositoryError>;
  }
>()("t3/persistence/Deliverables/DeliverableRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sqlError = (operation: string) => (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(operation)(cause)
      : toPersistenceSqlError(operation)(cause);

  const deliverableColumns = sql`
    d.deliverable_id AS "id",
    d.project_id AS "projectId",
    d.kind AS "kind",
    d.path AS "path",
    d.title AS "title",
    d.current_version_id AS "currentVersionId",
    (SELECT COUNT(*) FROM deliverable_versions v WHERE v.deliverable_id = d.deliverable_id)
      AS "versionCount",
    d.stray_version_of AS "strayVersionOf",
    d.created_at AS "createdAt",
    d.updated_at AS "updatedAt"
  `;

  const findDeliverables = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      id: Schema.optional(DeliverableId),
      path: Schema.optional(Schema.String),
    }),
    Result: DeliverableRow,
    execute: (request) => sql`
      SELECT ${deliverableColumns}
      FROM deliverables d
      WHERE ${sql.and([
        ...(request.projectId === undefined ? [] : [sql`d.project_id = ${request.projectId}`]),
        ...(request.id === undefined ? [] : [sql`d.deliverable_id = ${request.id}`]),
        ...(request.path === undefined ? [] : [sql`d.path = ${request.path}`]),
      ])}
      ORDER BY d.updated_at DESC, d.deliverable_id ASC
    `,
  });

  const findVersions = SqlSchema.findAll({
    Request: Schema.Struct({
      deliverableId: Schema.optional(DeliverableId),
      versionId: Schema.optional(DeliverableVersionId),
    }),
    Result: VersionRow,
    execute: (request) => sql`
      SELECT
        v.version_id AS "id",
        v.deliverable_id AS "deliverableId",
        v.ordinal AS "ordinal",
        v.parent_version_id AS "parentVersionId",
        v.content_sha256 AS "contentSha256",
        v.size_bytes AS "sizeBytes",
        v.source_blob_oid AS "sourceBlobOid",
        v.commit_oid AS "commitOid",
        v.version_ref AS "ref",
        v.source_json AS "source",
        v.summary AS "summary",
        v.expected_changes_json AS "expectedChanges",
        COALESCE(r.status, 'pending') AS "renditionStatus",
        v.self_check_json AS "selfCheck",
        v.created_at AS "createdAt"
      FROM deliverable_versions v
      JOIN deliverables d ON d.deliverable_id = v.deliverable_id
      LEFT JOIN deliverable_renditions r
        ON r.content_sha256 = v.content_sha256 AND r.kind = d.kind
      WHERE ${sql.and([
        ...(request.deliverableId === undefined
          ? []
          : [sql`v.deliverable_id = ${request.deliverableId}`]),
        ...(request.versionId === undefined ? [] : [sql`v.version_id = ${request.versionId}`]),
      ])}
      ORDER BY v.ordinal ASC
    `,
  });

  const findRenditions = SqlSchema.findAll({
    Request: Schema.Struct({
      content: Schema.optional(
        Schema.Struct({ contentSha256: Schema.String, kind: DeliverableKind }),
      ),
    }),
    Result: RenditionRow,
    execute: ({ content }) => sql`
      SELECT
        content_sha256 AS "contentSha256",
        kind,
        status,
        renderer,
        detail,
        rendition_json AS "data",
        updated_at AS "updatedAt"
      FROM deliverable_renditions
      WHERE ${sql.and(
        content === undefined
          ? []
          : [sql`content_sha256 = ${content.contentSha256}`, sql`kind = ${content.kind}`],
      )}
      ORDER BY content_sha256 ASC, kind ASC
    `,
  });

  /** The rows of one deliverable, with its version refs handed to Git's to-do list. */
  const removeDeliverableRows = Effect.fn("DeliverableRepository.removeDeliverableRows")(function* (
    deliverableId: DeliverableId,
    workspaceRoot: string,
    at: string,
  ) {
    yield* sql`
        INSERT INTO deliverable_ref_deletions (workspace_root, version_ref, requested_at)
        SELECT ${workspaceRoot}, version_ref, ${at} FROM deliverable_versions
        WHERE deliverable_id = ${deliverableId}
        ON CONFLICT (workspace_root, version_ref) DO NOTHING
      `;
    yield* sql`DELETE FROM deliverable_notes WHERE deliverable_id = ${deliverableId}`;
    yield* sql`DELETE FROM deliverable_review_status WHERE deliverable_id = ${deliverableId}`;
    yield* sql`DELETE FROM deliverable_restores WHERE deliverable_id = ${deliverableId}`;
    yield* sql`
        DELETE FROM deliverable_version_blobs WHERE version_id IN (
          SELECT version_id FROM deliverable_versions WHERE deliverable_id = ${deliverableId}
        )
      `;
    yield* sql`DELETE FROM deliverable_versions WHERE deliverable_id = ${deliverableId}`;
    yield* sql`
        UPDATE deliverables SET stray_version_of = NULL
        WHERE stray_version_of = ${deliverableId}
      `;
    yield* sql`DELETE FROM deliverables WHERE deliverable_id = ${deliverableId}`;
  });

  const NOTE_PICTURE_OBJECT = /^objects\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})$/;
  interface ReferenceRows {
    readonly blobs: ReadonlyArray<{ readonly projectId: string | null; readonly sha: string }>;
    readonly renditions: ReadonlyArray<{
      readonly projectId: string;
      readonly sha: string;
      readonly kind: DeliverableKind;
    }>;
    readonly snapshots: ReadonlyArray<{ readonly projectId: string; readonly path: string }>;
  }
  /** Every reference into the store with the project that holds it, read in one transaction. */
  const referenceRows = Effect.gen(function* () {
    const blobs = yield* sql<{ readonly projectId: string | null; readonly sha: string }>`
      SELECT d.project_id AS "projectId", v.content_sha256 AS "sha"
      FROM deliverable_versions v
      LEFT JOIN deliverables d ON d.deliverable_id = v.deliverable_id
      UNION
      SELECT d.project_id AS "projectId", b.content_sha256 AS "sha"
      FROM deliverable_version_blobs b
      LEFT JOIN deliverable_versions v ON v.version_id = b.version_id
      LEFT JOIN deliverables d ON d.deliverable_id = v.deliverable_id
    `;
    const renditions = yield* sql<{
      readonly projectId: string;
      readonly sha: string;
      readonly kind: DeliverableKind;
    }>`
      SELECT DISTINCT d.project_id AS "projectId", v.content_sha256 AS "sha", d.kind AS "kind"
      FROM deliverable_versions v
      JOIN deliverables d ON d.deliverable_id = v.deliverable_id
    `;
    const snapshots = yield* sql<{ readonly projectId: string; readonly path: string }>`
      SELECT project_id AS "projectId", snapshot_path AS "path"
      FROM deliverable_notes WHERE snapshot_path IS NOT NULL
    `;
    return { blobs, renditions, snapshots } satisfies ReferenceRows;
  }).pipe(sql.withTransaction);

  /** The references among `rows` that `keep` lets through. */
  const referencesOf = (
    rows: ReferenceRows,
    keep: (projectId: string | null) => boolean,
  ): StoreReferences => {
    const snapshots = rows.snapshots.filter((row) => keep(row.projectId));
    // A note's picture is a stored file like any other; older ones sit in their own folder.
    const pictures = snapshots.flatMap((row) => {
      const sha = NOTE_PICTURE_OBJECT.exec(row.path)?.[1];
      return sha === undefined ? [] : [sha];
    });
    return {
      blobs: new Set([
        ...rows.blobs.filter((row) => keep(row.projectId)).map((row) => row.sha),
        ...pictures,
      ]),
      renditions: new Set(
        rows.renditions
          .filter((row) => keep(row.projectId))
          .map((row) => renditionKey({ contentSha256: row.sha, kind: row.kind })),
      ),
      noteSnapshots: new Set(snapshots.map((row) => row.path)),
    };
  };

  const insertVersionBlobs = (versionId: DeliverableVersionId, blobs: ReadonlyArray<string>) =>
    Effect.forEach(
      new Set(blobs),
      (contentSha256) => sql`
        INSERT INTO deliverable_version_blobs (version_id, content_sha256)
        VALUES (${versionId}, ${contentSha256})
        ON CONFLICT (version_id, content_sha256) DO NOTHING
      `,
      { discard: true },
    );

  const encodeVersion = Schema.encodeEffect(VersionRow);
  const encodeDeliverable = Schema.encodeEffect(DeliverableRow);
  const encodeRendition = Schema.encodeEffect(RenditionRow);
  const encodeSelfCheck = Schema.encodeEffect(json(DeliverableSelfCheckResult));
  const encodeUtc = Schema.encodeEffect(Schema.DateTimeUtcFromString);

  const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0]);

  return DeliverableRepository.of({
    listDeliverables: Effect.fn("DeliverableRepository.listDeliverables")(function* (projectId) {
      return yield* findDeliverables({ projectId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("listDeliverables")),
      );
    }),
    getDeliverable: Effect.fn("DeliverableRepository.getDeliverable")(function* (id) {
      return first(
        yield* findDeliverables({ id }).pipe(
          NodeSqliteClient.readOnly,
          Effect.mapError(sqlError("getDeliverable")),
        ),
      );
    }),
    findDeliverableByPath: Effect.fn("DeliverableRepository.findDeliverableByPath")(
      function* (input) {
        return first(
          yield* findDeliverables(input).pipe(
            NodeSqliteClient.readOnly,
            Effect.mapError(sqlError("findDeliverableByPath")),
          ),
        );
      },
    ),
    insertDeliverable: Effect.fn("DeliverableRepository.insertDeliverable")(
      function* (input) {
        const row = yield* encodeDeliverable(input);
        yield* sql`
        INSERT INTO deliverables (
          deliverable_id, project_id, path, kind, title, current_version_id, stray_version_of,
          created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.projectId}, ${row.path}, ${row.kind}, ${row.title},
          ${row.currentVersionId}, ${row.strayVersionOf ?? null}, ${row.createdAt}, ${row.updatedAt}
        )
      `;
      },
      Effect.mapError(sqlError("insertDeliverable")),
    ),
    setCurrentVersion: Effect.fn("DeliverableRepository.setCurrentVersion")(
      function* (input) {
        const updatedAt = yield* encodeUtc(input.updatedAt);
        yield* Effect.gen(function* () {
          yield* sql`
          UPDATE deliverables
          SET current_version_id = ${input.versionId}, updated_at = ${updatedAt}
          WHERE deliverable_id = ${input.deliverableId}
        `;
          if (input.restore !== undefined) {
            yield* sql`
            INSERT INTO deliverable_restores (
              restore_id, deliverable_id, action, from_version_id, to_version_id, created_at
            ) VALUES (
              ${input.restore.restoreId}, ${input.deliverableId}, ${input.restore.action},
              ${input.restore.fromVersionId}, ${input.versionId}, ${updatedAt}
            )
          `;
          }
        }).pipe(sql.withTransaction);
      },
      Effect.mapError(sqlError("setCurrentVersion")),
    ),
    setStrayVersionOf: Effect.fn("DeliverableRepository.setStrayVersionOf")(
      function* (input) {
        yield* sql`
        UPDATE deliverables SET stray_version_of = ${input.strayVersionOf}
        WHERE deliverable_id = ${input.deliverableId}
      `;
      },
      Effect.mapError(sqlError("setStrayVersionOf")),
    ),
    deleteDeliverable: Effect.fn("DeliverableRepository.deleteDeliverable")(
      function* (input) {
        const at = yield* encodeUtc(yield* DateTime.now);
        yield* removeDeliverableRows(input.deliverableId, input.workspaceRoot, at).pipe(
          sql.withTransaction,
        );
      },
      Effect.mapError(sqlError("deleteDeliverable")),
    ),
    countHistory: Effect.fn("DeliverableRepository.countHistory")(
      function* (projectId) {
        const [row] = yield* sql<{
          readonly deliverableCount: number;
          readonly versionCount: number;
          readonly noteCount: number;
        }>`
          SELECT
            (SELECT COUNT(*) FROM deliverables WHERE project_id = ${projectId})
              AS "deliverableCount",
            (SELECT COUNT(*) FROM deliverable_versions v
              JOIN deliverables d ON d.deliverable_id = v.deliverable_id
              WHERE d.project_id = ${projectId}) AS "versionCount",
            (SELECT COUNT(*) FROM deliverable_notes WHERE project_id = ${projectId})
              AS "noteCount"
        `.pipe(NodeSqliteClient.readOnly);
        return row ?? { deliverableCount: 0, versionCount: 0, noteCount: 0 };
      },
      Effect.mapError(sqlError("countHistory")),
    ),
    requestHistoryPurge: Effect.fn("DeliverableRepository.requestHistoryPurge")(
      function* (input) {
        const requestedAt = yield* encodeUtc(input.requestedAt);
        yield* sql`
          INSERT INTO deliverable_history_purges (project_id, requested_at, completed_at)
          VALUES (${input.projectId}, ${requestedAt}, NULL)
          ON CONFLICT (project_id) DO UPDATE SET
            requested_at = excluded.requested_at,
            completed_at = NULL
        `;
      },
      Effect.mapError(sqlError("requestHistoryPurge")),
    ),
    listPendingHistoryPurges: sql<{ readonly projectId: ProjectId }>`
      SELECT project_id AS "projectId" FROM deliverable_history_purges
      WHERE completed_at IS NULL
      ORDER BY requested_at ASC, project_id ASC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows.map((row) => row.projectId)),
      Effect.mapError(sqlError("listPendingHistoryPurges")),
      Effect.withSpan("DeliverableRepository.listPendingHistoryPurges"),
    ),
    cancelHistoryPurge: Effect.fn("DeliverableRepository.cancelHistoryPurge")(
      function* (projectId) {
        yield* sql`
          DELETE FROM deliverable_history_purges
          WHERE project_id = ${projectId} AND completed_at IS NULL
        `;
      },
      Effect.mapError(sqlError("cancelHistoryPurge")),
    ),
    purgeProjectHistory: Effect.fn("DeliverableRepository.purgeProjectHistory")(
      function* (input) {
        const completedAt = yield* encodeUtc(input.completedAt);
        return yield* Effect.gen(function* () {
          // The decision is read inside the transaction that acts on it.
          const decided = yield* sql`
            SELECT 1 FROM deliverable_history_purges
            WHERE project_id = ${input.projectId} AND completed_at IS NULL
          `;
          if (decided.length === 0) return null;
          const deliverables = yield* sql<{ readonly id: DeliverableId }>`
            SELECT deliverable_id AS "id" FROM deliverables WHERE project_id = ${input.projectId}
          `;
          for (const deliverable of deliverables) {
            yield* removeDeliverableRows(deliverable.id, input.workspaceRoot, completedAt);
          }
          yield* sql`
            UPDATE deliverable_history_purges SET completed_at = ${completedAt}
            WHERE project_id = ${input.projectId}
          `;
          return deliverables.length;
        }).pipe(sql.withTransaction);
      },
      Effect.mapError(sqlError("purgeProjectHistory")),
    ),
    listPendingRefDeletions: sql<{ readonly workspaceRoot: string; readonly ref: string }>`
      SELECT workspace_root AS "workspaceRoot", version_ref AS "ref"
      FROM deliverable_ref_deletions
      ORDER BY workspace_root ASC, version_ref ASC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(sqlError("listPendingRefDeletions")),
      Effect.withSpan("DeliverableRepository.listPendingRefDeletions"),
    ),
    completeRefDeletions: Effect.fn("DeliverableRepository.completeRefDeletions")(
      function* (input) {
        yield* Effect.forEach(
          input.refs,
          (ref) => sql`
            DELETE FROM deliverable_ref_deletions
            WHERE workspace_root = ${input.workspaceRoot} AND version_ref = ${ref}
          `,
          { discard: true },
        ).pipe(sql.withTransaction);
      },
      Effect.mapError(sqlError("completeRefDeletions")),
    ),
    // WAL with synchronous=NORMAL syncs nothing at commit, so a power cut can undo a committed
    // delete. A checkpoint syncs the log and then the database; one that took in the whole log
    // (not busy, nothing left behind) puts every commit so far beyond a power cut.
    flushToDisk: sql<{
      readonly busy: number;
      readonly log: number;
      readonly checkpointed: number;
    }>`PRAGMA wal_checkpoint(FULL)`.pipe(
      // A database with no write-ahead log, as in tests, reports -1 and has nothing to sync.
      Effect.map(([state]) =>
        state === undefined
          ? false
          : state.busy === 0 && (state.log === -1 || state.checkpointed === state.log),
      ),
      Effect.mapError(sqlError("flushToDisk")),
      Effect.withSpan("DeliverableRepository.flushToDisk"),
    ),
    storeReferencesSplit: Effect.fn("DeliverableRepository.storeReferencesSplit")(
      function* (projectIds) {
        const rows = yield* referenceRows;
        const chosen = new Set<string>(projectIds);
        return {
          held: referencesOf(rows, (projectId) => projectId !== null && chosen.has(projectId)),
          elsewhere: referencesOf(
            rows,
            (projectId) => projectId === null || !chosen.has(projectId),
          ),
        };
      },
      Effect.mapError(sqlError("storeReferencesSplit")),
    ),
    listProjects: sql<{ readonly projectId: ProjectId }>`
      SELECT DISTINCT project_id AS "projectId" FROM deliverables ORDER BY project_id ASC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows.map((row) => row.projectId)),
      Effect.mapError(sqlError("listProjects")),
      Effect.withSpan("DeliverableRepository.listProjects"),
    ),
    listVersions: Effect.fn("DeliverableRepository.listVersions")(function* (deliverableId) {
      return yield* findVersions({ deliverableId }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(sqlError("listVersions")),
      );
    }),
    getVersion: Effect.fn("DeliverableRepository.getVersion")(function* (versionId) {
      return first(
        yield* findVersions({ versionId }).pipe(
          NodeSqliteClient.readOnly,
          Effect.mapError(sqlError("getVersion")),
        ),
      );
    }),
    insertVersion: Effect.fn("DeliverableRepository.insertVersion")(
      function* (input) {
        const row = yield* encodeVersion(input.version);
        const updatedAt = yield* encodeUtc(input.updatedAt);
        yield* Effect.gen(function* () {
          yield* sql`
          INSERT INTO deliverable_versions (
            version_id, deliverable_id, ordinal, parent_version_id, content_sha256, size_bytes,
            source_blob_oid, commit_oid, version_ref, source_json, summary, expected_changes_json,
            self_check_json, created_at
          ) VALUES (
            ${row.id}, ${row.deliverableId}, ${row.ordinal}, ${row.parentVersionId},
            ${row.contentSha256}, ${row.sizeBytes}, ${row.sourceBlobOid}, ${row.commitOid},
            ${row.ref}, ${row.source}, ${row.summary}, ${row.expectedChanges}, ${row.selfCheck},
            ${row.createdAt}
          )
        `;
          yield* insertVersionBlobs(input.version.id, [row.contentSha256, ...input.blobs]);
          yield* sql`
          UPDATE deliverables
          SET current_version_id = ${row.id}, updated_at = ${updatedAt}
          WHERE deliverable_id = ${row.deliverableId}
        `;
        }).pipe(sql.withTransaction);
      },
      Effect.mapError(sqlError("insertVersion")),
    ),
    listUnfinished: sql<{ readonly id: DeliverableVersionId }>`
      SELECT v.version_id AS "id"
      FROM deliverable_versions v
      JOIN deliverables d ON d.deliverable_id = v.deliverable_id
      LEFT JOIN deliverable_renditions r
        ON r.content_sha256 = v.content_sha256 AND r.kind = d.kind
      WHERE r.status IS NULL
        OR r.status IN ('pending', 'rendering')
        OR (v.self_check_json IS NULL AND v.expected_changes_json <> '[]')
      ORDER BY v.created_at ASC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows.map((row) => row.id)),
      Effect.mapError(sqlError("listUnfinished")),
      Effect.withSpan("DeliverableRepository.listUnfinished"),
    ),
    listRestoresSince: Effect.fn("DeliverableRepository.listRestoresSince")(
      function* (input) {
        const since = yield* encodeUtc(input.since);
        return yield* sql<{
          readonly action: "undo" | "redo" | "restore";
          readonly path: string;
          readonly ordinal: number;
        }>`
        SELECT r.action AS "action", d.path AS "path", v.ordinal AS "ordinal"
        FROM deliverable_restores r
        JOIN deliverables d ON d.deliverable_id = r.deliverable_id
        JOIN deliverable_versions v ON v.version_id = r.to_version_id
        WHERE d.project_id = ${input.projectId} AND r.created_at > ${since}
        ORDER BY r.created_at ASC
      `.pipe(NodeSqliteClient.readOnly);
      },
      Effect.mapError(sqlError("listRestoresSince")),
    ),
    setSelfCheck: Effect.fn("DeliverableRepository.setSelfCheck")(
      function* (input) {
        const encoded = input.result === null ? null : yield* encodeSelfCheck(input.result);
        yield* sql`
        UPDATE deliverable_versions SET self_check_json = ${encoded}
        WHERE version_id = ${input.versionId}
      `;
      },
      Effect.mapError(sqlError("setSelfCheck")),
    ),
    getRendition: Effect.fn("DeliverableRepository.getRendition")(function* (input) {
      return first(
        yield* findRenditions({ content: input }).pipe(
          NodeSqliteClient.readOnly,
          Effect.mapError(sqlError("getRendition")),
        ),
      );
    }),
    listRenditions: findRenditions({}).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(sqlError("listRenditions")),
      Effect.withSpan("DeliverableRepository.listRenditions"),
    ),
    deleteRendition: Effect.fn("DeliverableRepository.deleteRendition")(
      function* (input) {
        yield* sql`
          DELETE FROM deliverable_renditions
          WHERE content_sha256 = ${input.contentSha256} AND kind = ${input.kind}
        `;
      },
      Effect.mapError(sqlError("deleteRendition")),
    ),
    requeueInterruptedRenditions: sql<{ readonly sha: string }>`
      UPDATE deliverable_renditions SET status = 'pending', detail = NULL
      WHERE status = 'rendering'
      RETURNING content_sha256 AS "sha"
    `.pipe(
      Effect.map((rows) => rows.length),
      Effect.mapError(sqlError("requeueInterruptedRenditions")),
      Effect.withSpan("DeliverableRepository.requeueInterruptedRenditions"),
    ),
    storeReferences: referenceRows.pipe(
      Effect.map((rows) => referencesOf(rows, () => true)),
      Effect.mapError(sqlError("storeReferences")),
      Effect.withSpan("DeliverableRepository.storeReferences"),
    ),
    listVersionsWithoutBlobs: sql<{
      readonly versionId: DeliverableVersionId;
      readonly projectId: ProjectId;
      readonly commitOid: string;
      readonly contentSha256: string;
    }>`
      SELECT
        v.version_id AS "versionId",
        d.project_id AS "projectId",
        v.commit_oid AS "commitOid",
        v.content_sha256 AS "contentSha256"
      FROM deliverable_versions v
      JOIN deliverables d ON d.deliverable_id = v.deliverable_id
      WHERE NOT EXISTS (
        SELECT 1 FROM deliverable_version_blobs b WHERE b.version_id = v.version_id
      )
      ORDER BY v.created_at ASC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(sqlError("listVersionsWithoutBlobs")),
      Effect.withSpan("DeliverableRepository.listVersionsWithoutBlobs"),
    ),
    recordVersionBlobs: Effect.fn("DeliverableRepository.recordVersionBlobs")(
      function* (input) {
        yield* insertVersionBlobs(input.versionId, input.blobs).pipe(sql.withTransaction);
      },
      Effect.mapError(sqlError("recordVersionBlobs")),
    ),
    forgetBlob: Effect.fn("DeliverableRepository.forgetBlob")(
      function* (contentSha256) {
        yield* sql`DELETE FROM deliverable_blob_index WHERE content_sha256 = ${contentSha256}`;
      },
      Effect.mapError(sqlError("forgetBlob")),
    ),
    putRendition: Effect.fn("DeliverableRepository.putRendition")(
      function* (input) {
        const row = yield* encodeRendition(input);
        yield* sql`
        INSERT INTO deliverable_renditions (
          content_sha256, kind, status, renderer, detail, rendition_json, updated_at
        ) VALUES (
          ${row.contentSha256}, ${row.kind}, ${row.status}, ${row.renderer}, ${row.detail},
          ${row.data}, ${row.updatedAt}
        )
        ON CONFLICT (content_sha256, kind) DO UPDATE SET
          status = excluded.status,
          renderer = excluded.renderer,
          detail = excluded.detail,
          rendition_json = excluded.rendition_json,
          updated_at = excluded.updated_at
      `;
      },
      Effect.mapError(sqlError("putRendition")),
    ),
    lookupBlobs: Effect.fn("DeliverableRepository.lookupBlobs")(function* (gitBlobOids) {
      if (gitBlobOids.length === 0) return new Map<string, string>();
      const rows = yield* sql<{ readonly oid: string; readonly sha: string }>`
        SELECT git_blob_oid AS "oid", content_sha256 AS "sha"
        FROM deliverable_blob_index
        WHERE ${sql.in("git_blob_oid", gitBlobOids)}
      `.pipe(NodeSqliteClient.readOnly, Effect.mapError(sqlError("lookupBlobs")));
      return new Map(rows.map((row) => [row.oid, row.sha]));
    }),
    recordBlob: Effect.fn("DeliverableRepository.recordBlob")(function* (input) {
      yield* sql`
        INSERT INTO deliverable_blob_index (git_blob_oid, content_sha256, size_bytes)
        VALUES (${input.gitBlobOid}, ${input.contentSha256}, ${input.sizeBytes})
        ON CONFLICT (git_blob_oid) DO NOTHING
      `.pipe(Effect.mapError(sqlError("recordBlob")));
    }),
  });
});

export const layer = Layer.effect(DeliverableRepository, make);
