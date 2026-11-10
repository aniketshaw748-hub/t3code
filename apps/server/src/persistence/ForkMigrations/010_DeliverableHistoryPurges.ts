import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A person's confirmed decision to delete a removed project's Work history. Nothing deletes
  // deliverable history without a row here; one with no completed_at is still owed.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_history_purges (
      project_id TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;
  // Version refs of deleted history that Git has not yet confirmed gone. Written in the
  // transaction that deletes the versions, so a crash or an unreachable folder cannot lose them.
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_ref_deletions (
      workspace_root TEXT NOT NULL,
      version_ref TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      PRIMARY KEY (workspace_root, version_ref)
    )
  `;
});
