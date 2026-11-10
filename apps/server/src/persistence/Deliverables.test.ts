import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as DeliverableRepository from "./Deliverables.ts";
import * as SqlitePersistence from "./Sqlite.ts";

it.layer(NodeServices.layer)("DeliverableRepository on a database file", (it) => {
  // The server's own settings: write-ahead log, commits not synced one by one.
  it.effect("flushToDisk puts every commit so far into the database file itself", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "deliverables-db-" });
      const databasePath = path.join(directory, "statev2.sqlite");
      /** Rendition rows in a copy of the database file alone, as after losing the log. */
      const rowsWithoutLog = Effect.fn("test.rowsWithoutLog")(function* (name: string) {
        const copy = path.join(directory, name);
        yield* fileSystem.copyFile(databasePath, copy);
        return yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [row] = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM deliverable_renditions
          `;
          return row?.count;
        }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: copy })));
      });

      yield* Effect.gen(function* () {
        const repository = yield* DeliverableRepository.DeliverableRepository;
        assert.isTrue(yield* repository.flushToDisk);
        yield* repository.putRendition({
          contentSha256: "a".repeat(64),
          kind: "deck",
          status: "ready",
          renderer: "test",
          detail: null,
          data: null,
          updatedAt: yield* DateTime.now,
        });
        // Committed, and so far only in the log.
        assert.strictEqual(yield* rowsWithoutLog("before.sqlite"), 0);
        assert.isTrue(yield* repository.flushToDisk);
        assert.strictEqual(yield* rowsWithoutLog("after.sqlite"), 1);
      }).pipe(
        Effect.provide(
          DeliverableRepository.layer.pipe(
            Layer.provide(SqlitePersistence.layerFromPath(databasePath)),
          ),
        ),
      );
    }),
  );
});
