import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { runServicePreflight } from "../cloud/servicePreflight.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import { adoptLegacyForkMigrations } from "./adoptLegacyForkMigrations.ts";
import { BUILD_MIGRATION_HEAD, databaseMigrationHead } from "./databaseMigrationHead.ts";
import { FORK_MIGRATIONS_TABLE, withForkMigrations } from "./ForkMigrations.ts";
import Deliverables from "./ForkMigrations/001_Deliverables.ts";
import ProjectionProjectsKind from "./ForkMigrations/002_ProjectionProjectsKind.ts";
import DeliverableNotes from "./ForkMigrations/003_DeliverableNotes.ts";
import WholeDeliverableNotesToChat from "./ForkMigrations/004_WholeDeliverableNotesToChat.ts";
import DeliverableStrayVersionOf from "./ForkMigrations/005_DeliverableStrayVersionOf.ts";
import DirectPushDevices from "./ForkMigrations/006_DirectPushDevices.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import {
  forkLedger,
  ledgerIds,
  type LedgerRow,
  schemaSnapshot,
  upstreamLedger,
} from "./testkit/MigrationState.ts";

// Written out, not derived from the manifest: this is what real databases hold.
const LEGACY_UPSTREAM_HEAD = 80;
const legacyForkMigrations = [
  [81, "Deliverables", Deliverables],
  [82, "ProjectionProjectsKind", ProjectionProjectsKind],
  [83, "DeliverableNotes", DeliverableNotes],
  [84, "WholeDeliverableNotesToChat", WholeDeliverableNotesToChat],
  [85, "DeliverableStrayVersionOf", DeliverableStrayVersionOf],
  [86, "DirectPushDevices", DirectPushDevices],
] as const;
const forkIds = legacyForkMigrations.map(
  ([id, name]) => [id - LEGACY_UPSTREAM_HEAD, name] as const,
);
const upstreamIds = migrationManifest.filter(([id]) => id <= LEGACY_UPSTREAM_HEAD);

const runInUpstreamLedger = Migrator.make({});

/** The build before the separate ledger: fork migrations numbered in upstream's sequence. */
const runOldBuild = (throughId = 86) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: LEGACY_UPSTREAM_HEAD });
    yield* runInUpstreamLedger({
      loader: Migrator.fromRecord(
        Object.fromEntries(
          legacyForkMigrations
            .filter(([id]) => id <= throughId)
            .map(([id, name, migration]) => [`${id}_${name}`, migration]),
        ),
      ),
    });
    // Distinct times, to show each row keeps its own when it moves.
    yield* sql`
      UPDATE effect_sql_migrations
      SET created_at = '2026-10-' || printf('%02d', migration_id - 80) || ' 09:00:00'
      WHERE migration_id > 80
    `;
  });

const futureUpstreamMigrations = {
  "81_FutureUpstreamItems": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE future_upstream_items (item_id TEXT PRIMARY KEY)`;
  }),
  // The same table fork migration 2 adds a column to.
  "82_FutureUpstreamProjectFlag": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE projection_projects ADD COLUMN future_upstream_flag INTEGER NOT NULL DEFAULT 0`;
  }),
};
const futureUpstreamIds: Array<readonly [number, string]> = [
  [81, "FutureUpstreamItems"],
  [82, "FutureUpstreamProjectFlag"],
];

/** A build after the next upstream sync, where upstream's own sequence continues at 81. */
const runFutureBuild = withForkMigrations(() =>
  Effect.gen(function* () {
    const current = yield* runMigrations({ toMigrationInclusive: LEGACY_UPSTREAM_HEAD });
    const added = yield* runInUpstreamLedger({
      loader: Migrator.fromRecord(futureUpstreamMigrations),
    });
    return [...current, ...added];
  }),
);

const USER = '{"kind":"user","name":null,"source":null}';

/** Rows a Work project leaves behind, using only what the old sequence had created by `throughId`. */
const seedWorkRows = (throughId = 86) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at, kind)
      VALUES ('project-work', 'Deck', '/tmp/deck', '[]', '2026-10-01', '2026-10-01', 'work')
    `;
    yield* sql`
      INSERT INTO deliverables (
        deliverable_id, project_id, path, kind, title, current_version_id, created_at, updated_at
      ) VALUES ('dlv-1', 'project-work', 'deck.pptx', 'deck', 'deck.pptx', NULL, '2026-10-01', '2026-10-01')
    `;
    // The old id 84 deletes notes like this one, so it shows whether a fork migration ran twice.
    yield* sql`
      INSERT INTO deliverable_notes (
        note_id, project_id, deliverable_id, version_id, anchor_json, body, author_json,
        status, sent_message_id, created_at, updated_at
      ) VALUES (
        'whole-sent', 'project-work', 'dlv-1', 'dlvv-1', NULL, 'Body', ${USER},
        'open', 'message-1', '2026-10-01', '2026-10-01'
      )
    `;
    if (throughId < 86) return;
    yield* sql`
      INSERT INTO direct_push_devices (
        device_id, label, platform, package_name, push_token, preferences_json, created_at, updated_at
      ) VALUES ('device-1', 'Pixel', 'android', 'app.example', 'token-1', '{}', '2026-10-01', '2026-10-01')
    `;
  });

const workRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return {
    projects: yield* sql`SELECT project_id, kind FROM projection_projects`,
    deliverables: yield* sql`SELECT deliverable_id, path, stray_version_of FROM deliverables`,
    notes: yield* sql`SELECT note_id, sent_message_id FROM deliverable_notes`,
    devices: yield* sql`SELECT device_id, push_token FROM direct_push_devices`,
  };
});
const seededWorkRows = {
  projects: [{ project_id: "project-work", kind: "work" }],
  deliverables: [{ deliverable_id: "dlv-1", path: "deck.pptx", stray_version_of: null }],
  notes: [{ note_id: "whole-sent", sent_message_id: "message-1" }],
  devices: [{ device_id: "device-1", push_token: "token-1" }],
};

const legacyTime = (legacyId: number) =>
  `2026-10-${String(legacyId - 80).padStart(2, "0")} 09:00:00`;

const assertSeparateLedgers = Effect.fn("assertSeparateLedgers")(function* (
  upstreamBefore: ReadonlyArray<LedgerRow>,
) {
  // Exactly what upstream's own migrations left, row for row.
  assert.deepStrictEqual(
    yield* upstreamLedger,
    upstreamBefore.filter((row) => row.migration_id <= LEGACY_UPSTREAM_HEAD),
  );
  assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), upstreamIds);
  assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
});

it.layer(NodeServices.layer)("fork migration ledger", (it) => {
  const open = <A, E>(databasePath: string, effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
    effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })));

  const makeDatabasePath = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "fork-migrations-" }),
      "statev2.sqlite",
    );
  });

  it.effect("a new database records upstream and fork migrations apart", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      yield* open(
        databasePath,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runMigrations(), migrationManifest);
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), migrationManifest);
          assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
          yield* seedWorkRows();
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
        }),
      );
    }),
  );

  it.effect("a database at upstream's head gains the fork migrations in their own ledger", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      const before = yield* open(
        databasePath,
        Effect.gen(function* () {
          yield* runMigrations({ toMigrationInclusive: LEGACY_UPSTREAM_HEAD });
          assert.deepStrictEqual(yield* forkLedger, []);
          return yield* upstreamLedger;
        }),
      );
      yield* open(
        databasePath,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runMigrations(), []);
          yield* assertSeparateLedgers(before);
          yield* seedWorkRows();
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
        }),
      );
    }),
  );

  it.effect("moves fork migrations recorded as 81-86 without running them again", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      const before = yield* open(
        databasePath,
        Effect.gen(function* () {
          yield* runOldBuild();
          yield* seedWorkRows();
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), [
            ...upstreamIds,
            ...legacyForkMigrations.map(([id, name]) => [id, name] as const),
          ]);
          return { ledger: yield* upstreamLedger, schema: yield* schemaSnapshot };
        }),
      );
      yield* open(
        databasePath,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runMigrations(), []);
          yield* assertSeparateLedgers(before.ledger);
          assert.deepStrictEqual(
            (yield* forkLedger).map((row) => row.created_at),
            legacyForkMigrations.map(([id]) => legacyTime(id)),
          );
          // Running 2 again would fail on its column, and running 4 again would delete the note.
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
          const { [FORK_MIGRATIONS_TABLE]: ledgerTable, ...tables } = (yield* schemaSnapshot)
            .tables;
          assert.isDefined(ledgerTable);
          assert.deepStrictEqual(tables, before.schema.tables);
        }),
      );
    }),
  );

  it.effect("finishes a database that stopped part-way through the old sequence", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      const before = yield* open(
        databasePath,
        Effect.gen(function* () {
          yield* runOldBuild(84);
          yield* seedWorkRows(84);
          return yield* upstreamLedger;
        }),
      );
      yield* open(
        databasePath,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runMigrations(), []);
          yield* assertSeparateLedgers(before);
          // 1-4 moved with their times; 5 and 6 ran now.
          assert.deepStrictEqual(
            (yield* forkLedger).slice(0, 4).map((row) => row.created_at),
            [81, 82, 83, 84].map(legacyTime),
          );
          assert.deepStrictEqual(yield* workRows, { ...seededWorkRows, devices: [] });
        }),
      );
    }),
  );

  it.effect("does nothing on a database whose ledgers are already apart", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      const settled = yield* open(
        databasePath,
        Effect.gen(function* () {
          yield* runOldBuild();
          yield* seedWorkRows();
          yield* runMigrations();
          return { upstream: yield* upstreamLedger, fork: yield* forkLedger };
        }),
      );
      const restart = open(
        databasePath,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runMigrations(), []);
          assert.deepStrictEqual(yield* upstreamLedger, settled.upstream);
          assert.deepStrictEqual(yield* forkLedger, settled.fork);
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
        }),
      );
      yield* restart;
      yield* restart;
    }),
  );

  it.effect("lets upstream's next migrations run after the move, whichever build sees them", () =>
    Effect.gen(function* () {
      const expectedUpstream = [...upstreamIds, ...futureUpstreamIds];

      // The old scheme's trap: upstream's 81 and 82 are at or below the recorded 86, so they never run.
      const trapped = yield* makeDatabasePath;
      yield* open(
        trapped,
        Effect.gen(function* () {
          yield* runOldBuild();
          assert.deepStrictEqual(
            yield* runInUpstreamLedger({ loader: Migrator.fromRecord(futureUpstreamMigrations) }),
            [],
          );
          assert.notProperty((yield* schemaSnapshot).tables, "future_upstream_items");
        }),
      );

      // Moved by this build first, then opened by the build with upstream's new migrations.
      const moved = yield* makeDatabasePath;
      yield* open(moved, Effect.andThen(runOldBuild(), seedWorkRows()));
      yield* open(moved, runMigrations());
      const movedSchema = yield* open(
        moved,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runFutureBuild(), futureUpstreamIds);
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), expectedUpstream);
          assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
          // Upstream's own 81 and 82 stay where they are on later starts.
          assert.deepStrictEqual(yield* runFutureBuild(), []);
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), expectedUpstream);
          assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
          return yield* schemaSnapshot;
        }),
      );

      // Still on the old scheme when the build with upstream's new migrations first opens it.
      const legacy = yield* makeDatabasePath;
      yield* open(legacy, Effect.andThen(runOldBuild(), seedWorkRows()));
      const legacySchema = yield* open(
        legacy,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runFutureBuild(), futureUpstreamIds);
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), expectedUpstream);
          assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
          return yield* schemaSnapshot;
        }),
      );

      // Created by the build with upstream's new migrations: all of upstream, then the fork.
      const fresh = yield* makeDatabasePath;
      const freshSchema = yield* open(
        fresh,
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* runFutureBuild(), expectedUpstream);
          assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), expectedUpstream);
          assert.deepStrictEqual(ledgerIds(yield* forkLedger), forkIds);
          return yield* schemaSnapshot;
        }),
      );

      assert.property(freshSchema.tables, "future_upstream_items");
      assert.deepStrictEqual(movedSchema, freshSchema);
      assert.deepStrictEqual(legacySchema, freshSchema);
    }),
  );

  it.effect("rolls the whole move back on failure and can retry", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      yield* open(
        databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runOldBuild();
          yield* seedWorkRows();
          const before = yield* upstreamLedger;
          yield* sql`
            CREATE TRIGGER fail_fork_adoption BEFORE DELETE ON effect_sql_migrations
            WHEN OLD.migration_id = 84
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END
          `;

          assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
          assert.deepStrictEqual(yield* upstreamLedger, before);
          assert.deepStrictEqual(yield* forkLedger, []);
          assert.deepStrictEqual(yield* workRows, seededWorkRows);

          yield* sql`DROP TRIGGER fail_fork_adoption`;
          assert.deepStrictEqual(yield* runMigrations(), []);
          yield* assertSeparateLedgers(before);
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
        }),
      );
    }),
  );

  it.effect("refuses a legacy history with a gap and leaves it untouched", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      yield* open(
        databasePath,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runOldBuild();
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 82`;
          const before = yield* upstreamLedger;

          const exit = yield* Effect.exit(runMigrations());

          assert.isTrue(Exit.isFailure(exit));
          assert.include(String(exit), "leaves a gap");
          assert.deepStrictEqual(yield* upstreamLedger, before);
          assert.deepStrictEqual(yield* forkLedger, []);
        }),
      );
    }),
  );

  it.effect("stops the old build from running on a database whose ledgers are apart", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      yield* open(
        databasePath,
        Effect.gen(function* () {
          yield* runOldBuild();
          yield* seedWorkRows();
          yield* runMigrations();
          const before = {
            upstream: yield* upstreamLedger,
            fork: yield* forkLedger,
            schema: yield* schemaSnapshot,
          };

          // It sees upstream at 80 and tries its 81-86 again; 82's column already exists.
          const exit = yield* Effect.exit(runOldBuild());

          assert.isTrue(Exit.isFailure(exit));
          assert.include(String(exit), "82_ProjectionProjectsKind");
          assert.deepStrictEqual(
            {
              upstream: yield* upstreamLedger,
              fork: yield* forkLedger,
              schema: yield* schemaSnapshot,
            },
            before,
          );
          assert.deepStrictEqual(yield* workRows, seededWorkRows);
        }),
      );
    }),
  );

  // How a migration that another branch still numbered in upstream's sequence is folded in.
  it.effect.each([true, false])(
    "adopts a later legacy migration (first six moved: %s)",
    (movedFirst) =>
      Effect.gen(function* () {
        const databasePath = yield* makeDatabasePath;
        const manifest = [
          ...legacyForkMigrations.map(([legacyUpstreamId, name]) => ({
            id: legacyUpstreamId - LEGACY_UPSTREAM_HEAD,
            name,
            legacyUpstreamId,
          })),
          { id: 7, name: "LateLegacy", legacyUpstreamId: 87 },
        ];
        yield* open(
          databasePath,
          Effect.gen(function* () {
            yield* runOldBuild();
            if (movedFirst) yield* runMigrations();
            yield* runInUpstreamLedger({
              loader: Migrator.fromRecord({ "87_LateLegacy": Effect.void }),
            });

            const adopted = yield* adoptLegacyForkMigrations({
              forkTable: FORK_MIGRATIONS_TABLE,
              migrations: manifest,
            });

            assert.deepStrictEqual(
              adopted,
              movedFirst ? [[7, "LateLegacy"]] : [...forkIds, [7, "LateLegacy"]],
            );
            assert.deepStrictEqual(ledgerIds(yield* upstreamLedger), upstreamIds);
            assert.deepStrictEqual(ledgerIds(yield* forkLedger), [...forkIds, [7, "LateLegacy"]]);
          }),
        );
      }),
  );

  it.effect("reports upstream's head for a database that still has legacy fork rows", () =>
    Effect.gen(function* () {
      const databasePath = yield* makeDatabasePath;
      yield* open(databasePath, runOldBuild());

      assert.strictEqual(databaseMigrationHead(databasePath), BUILD_MIGRATION_HEAD);
      assert.strictEqual(
        runServicePreflight({ databasePath, launcherProtocol: SERVICE_LAUNCHER_PROTOCOL }).status,
        "ready",
      );
    }),
  );
});
