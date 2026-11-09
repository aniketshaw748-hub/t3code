import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS direct_push_devices (
      device_id TEXT PRIMARY KEY,
      session_id TEXT,
      label TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT,
      android_api_level INTEGER,
      package_name TEXT NOT NULL,
      push_token TEXT NOT NULL UNIQUE,
      preferences_json TEXT NOT NULL,
      last_aggregate_json TEXT,
      last_delivery_at TEXT,
      last_delivery_ok INTEGER,
      last_delivery_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
