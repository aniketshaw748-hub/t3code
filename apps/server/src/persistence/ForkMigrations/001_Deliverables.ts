import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverables (
      deliverable_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      current_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, path)
    )
  `;
  // A version's bytes live in the blob store under content_sha256; commit_oid is the Git
  // snapshot of the whole project at that version, with media kept as pointers.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_versions (
      version_id TEXT PRIMARY KEY,
      deliverable_id TEXT NOT NULL REFERENCES deliverables (deliverable_id),
      ordinal INTEGER NOT NULL,
      parent_version_id TEXT,
      content_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      source_blob_oid TEXT,
      commit_oid TEXT NOT NULL,
      version_ref TEXT NOT NULL,
      source_json TEXT NOT NULL,
      summary TEXT,
      expected_changes_json TEXT NOT NULL,
      self_check_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (deliverable_id, ordinal)
    )
  `;
  // Renditions depend only on content, so identical bytes in two versions render once.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_renditions (
      content_sha256 TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      renderer TEXT,
      detail TEXT,
      rendition_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (content_sha256, kind)
    )
  `;
  // Git blob ids already stored, so unchanged media is not read out of Git again.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_blob_index (
      git_blob_oid TEXT PRIMARY KEY,
      content_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_restores (
      restore_id TEXT PRIMARY KEY,
      deliverable_id TEXT NOT NULL REFERENCES deliverables (deliverable_id),
      action TEXT NOT NULL,
      from_version_id TEXT,
      to_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deliverable_restores_deliverable
    ON deliverable_restores (deliverable_id, created_at)
  `;
});
