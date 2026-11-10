import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Every stored file a version's snapshot points at, the deliverable's own included, so cleanup
// can tell what is still needed without reading Git. Versions from before this table have no
// rows until the first cleanup reads their commits.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deliverable_version_blobs (
      version_id TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      PRIMARY KEY (version_id, content_sha256)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deliverable_version_blobs_content
    ON deliverable_version_blobs (content_sha256)
  `;
});
