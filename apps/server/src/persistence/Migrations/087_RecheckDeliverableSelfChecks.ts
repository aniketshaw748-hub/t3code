import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Self-checks so far were judged with a comparison too coarse to see a changed word, so some
// say a requested change "looks the same" when it landed. Cleared here, they run again at startup.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE deliverable_versions
    SET self_check_json = NULL
    WHERE self_check_json IS NOT NULL
  `;
});
