import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Self-checks so far lined slides and shots up by position, so one added slide or second made
// every later one read as changed outside the request. Cleared here, they run again at startup.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE deliverable_versions
    SET self_check_json = NULL
    WHERE self_check_json IS NOT NULL
  `;
});
