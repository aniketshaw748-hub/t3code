import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { BUILD_MIGRATION_HEAD } from "./databaseMigrationHead.ts";
import {
  FORK_MIGRATIONS_TABLE,
  forkMigrationManifest,
  runForkMigrations,
} from "./ForkMigrations.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import { forkLedger, ledgerIds, schemaSnapshot, upstreamLedger } from "./testkit/MigrationState.ts";

const memoryDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

const forkIds = forkMigrationManifest.map(([id, name]) => [id, name] as const);

// What the fork's migrations may add to the database. A fork migration is safe when it only
// creates and changes the fork's own tables, because upstream's migrations then cannot disturb it
// in either order. Anything on an upstream table is listed here on purpose: upstream could drop or
// rebuild that table later, so keep the list short. See docs/internals/fork-migrations.md.
const forkTables = [
  "deliverable_blob_index",
  "deliverable_notes",
  "deliverable_renditions",
  "deliverable_restores",
  "deliverable_review_status",
  "deliverable_versions",
  "deliverables",
  "direct_push_devices",
];
const forkColumnsOnUpstreamTables = {
  projection_projects: ["kind TEXT NOT NULL DEFAULT 'code'"],
};

describe("fork migrations", () => {
  it.effect("keep their own ledger and leave upstream's as upstream wrote it", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runMigrations(), migrationManifest);
      assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), migrationManifest);
      assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);

      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* runForkMigrations(), []);
    }).pipe(memoryDatabase),
  );

  it.effect("wait for upstream's full schema", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: BUILD_MIGRATION_HEAD });
      assert.deepStrictEqual(yield* forkLedger, []);
      assert.notInclude(Object.keys((yield* schemaSnapshot).tables), "deliverables");
    }).pipe(memoryDatabase),
  );

  it.effect("add only the tables and columns listed here", () =>
    Effect.gen(function* () {
      const upstream = yield* Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: BUILD_MIGRATION_HEAD });
        return yield* schemaSnapshot;
      }).pipe(memoryDatabase);
      const full = yield* Effect.gen(function* () {
        yield* runMigrations();
        return yield* schemaSnapshot;
      }).pipe(memoryDatabase);

      const created = Object.keys(full.tables).filter((table) => !(table in upstream.tables));
      assert.deepStrictEqual(created.toSorted(), [FORK_MIGRATIONS_TABLE, ...forkTables].toSorted());

      const added: Record<string, ReadonlyArray<string>> = {};
      for (const [table, columns] of Object.entries(upstream.tables)) {
        const now = full.tables[table] ?? [];
        assert.deepStrictEqual(
          columns.filter((column) => !now.includes(column)),
          [],
          `${table} lost or changed columns`,
        );
        const extra = now.filter((column) => !columns.includes(column));
        if (extra.length > 0) added[table] = extra;
      }
      assert.deepStrictEqual(added, forkColumnsOnUpstreamTables);

      assert.deepStrictEqual(
        upstream.others.filter(
          (object) => !full.others.some((other) => other.name === object.name),
        ),
        [],
      );
      const addedObjects = full.others.filter(
        (object) => !upstream.others.some((other) => other.name === object.name),
      );
      for (const object of addedObjects) {
        assert.include(forkTables, object.table, `${object.name} is on an upstream table`);
      }
    }),
  );

  // A database that has followed every release ran each fork migration right after the upstream
  // migrations of its day; a new one runs all of upstream first. Both must end the same.
  it.effect("end with the same schema on a long-lived database and a new one", () =>
    Effect.gen(function* () {
      const longLived = yield* Effect.gen(function* () {
        for (const [id, , upstreamBase] of forkMigrationManifest) {
          yield* runMigrations({ toMigrationInclusive: upstreamBase });
          yield* runForkMigrations({ toMigrationInclusive: id });
        }
        yield* runMigrations();
        return yield* schemaSnapshot;
      }).pipe(memoryDatabase);
      const fresh = yield* Effect.gen(function* () {
        yield* runMigrations();
        return yield* schemaSnapshot;
      }).pipe(memoryDatabase);

      assert.deepStrictEqual(longLived, fresh);
    }),
  );

  it.effect("drops only the user's sent whole-deliverable notes, which are chat now", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: BUILD_MIGRATION_HEAD });
      yield* runForkMigrations({ toMigrationInclusive: 3 });
      const user = '{"kind":"user","name":null,"source":null}';
      const reviewer = '{"kind":"external","name":"Ana","source":"review-app"}';
      const slide = '{"kind":"slide","index":1}';
      yield* sql`
        INSERT INTO deliverables (
          deliverable_id, project_id, path, kind, title, current_version_id, created_at, updated_at
        ) VALUES (
          'dlv-1', 'project-1', 'deck.pptx', 'deck', 'deck.pptx', NULL,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `;
      for (const [id, anchor, author, sent] of [
        ["whole-sent", null, user, "message-1"],
        ["whole-unsent", null, user, null],
        ["whole-reviewer", null, reviewer, "message-2"],
        ["slide-sent", slide, user, "message-3"],
      ] as const) {
        yield* sql`
          INSERT INTO deliverable_notes (
            note_id, project_id, deliverable_id, version_id, anchor_json, body, author_json,
            status, sent_message_id, created_at, updated_at
          ) VALUES (
            ${id}, 'project-1', 'dlv-1', 'dlvv-1', ${anchor}, 'Body', ${author},
            'open', ${sent}, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `;
      }

      yield* runMigrations();

      const kept = yield* sql<{ readonly note_id: string }>`
        SELECT note_id FROM deliverable_notes ORDER BY note_id
      `;
      assert.deepStrictEqual(
        kept.map((row) => row.note_id),
        ["slide-sent", "whole-reviewer", "whole-unsent"],
      );
    }).pipe(memoryDatabase),
  );
});

it.effect("registers every fork migration file, in the order they were written", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "ForkMigrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      forkIds,
    );
    assert.deepStrictEqual(
      forkIds.map(([id]) => id),
      forkIds.map((_, index) => index + 1),
    );
    const bases = forkMigrationManifest.map(([, , upstreamBase]) => upstreamBase);
    assert.deepStrictEqual(
      bases,
      bases.toSorted((a, b) => a - b),
    );
    assert.isAtMost(Math.max(...bases), BUILD_MIGRATION_HEAD);
  }).pipe(Effect.provide(NodeServices.layer)),
);
