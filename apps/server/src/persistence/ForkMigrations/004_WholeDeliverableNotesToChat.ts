import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The user's whole-deliverable notes are chat now. The sent ones already live in the thread
// as messages, so their note rows, which could never be marked fixed, go.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    DELETE FROM deliverable_notes
    WHERE anchor_json IS NULL
      AND sent_message_id IS NOT NULL
      AND json_extract(author_json, '$.kind') = 'user'
  `;
});
