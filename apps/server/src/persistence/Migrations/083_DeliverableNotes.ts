import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A note's snapshot is a PNG under the deliverable store; snapshot_path is relative to it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_notes (
      note_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      deliverable_id TEXT NOT NULL REFERENCES deliverables (deliverable_id),
      version_id TEXT NOT NULL,
      anchor_json TEXT,
      body TEXT NOT NULL,
      author_json TEXT NOT NULL,
      snapshot_path TEXT,
      status TEXT NOT NULL,
      thread_id TEXT,
      sent_message_id TEXT,
      sent_run_id TEXT,
      addressed_run_id TEXT,
      reply TEXT,
      check_anchor_json TEXT,
      fixed_in_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deliverable_notes_project
    ON deliverable_notes (project_id, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deliverable_notes_sent_message
    ON deliverable_notes (sent_message_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_review_status (
      deliverable_id TEXT PRIMARY KEY REFERENCES deliverables (deliverable_id),
      state TEXT NOT NULL,
      version_id TEXT,
      source TEXT NOT NULL,
      label TEXT,
      url TEXT,
      updated_at TEXT NOT NULL
    )
  `;
});
