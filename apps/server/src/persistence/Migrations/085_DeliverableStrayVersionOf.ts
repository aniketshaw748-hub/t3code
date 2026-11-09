import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// A file the agent saved beside a deliverable under a version-suffixed name points at it here.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE deliverables ADD COLUMN stray_version_of TEXT`;
});
