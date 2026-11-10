import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

/** A fork migration that older builds recorded in upstream's ledger under `legacyUpstreamId`. */
export interface LegacyForkMigration {
  readonly id: number;
  readonly name: string;
  readonly legacyUpstreamId: number;
}

export const isLegacyForkMigrationRecord = (
  migrations: ReadonlyArray<LegacyForkMigration>,
  record: { readonly id: number; readonly name: string },
): boolean =>
  migrations.some(
    (migration) => migration.legacyUpstreamId === record.id && migration.name === record.name,
  );

/**
 * Older builds numbered fork migrations inside upstream's sequence. Move those ledger rows to the
 * fork's own ledger, so upstream's ledger reads as if only upstream's migrations had run and its
 * next migration is not skipped. Only ledger rows move; the schema they describe already exists.
 * One transaction, so a crash leaves either the old history or the new one.
 */
export const adoptLegacyForkMigrations = Effect.fn("adoptLegacyForkMigrations")(function* (input: {
  readonly forkTable: string;
  readonly migrations: ReadonlyArray<LegacyForkMigration>;
}) {
  const sql = yield* SqlClient.SqlClient;
  const forkTable = sql(input.forkTable);
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return [];
      const upstream = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
      `;
      const legacy = input.migrations.filter((migration) =>
        upstream.some(
          (row) => row.migration_id === migration.legacyUpstreamId && row.name === migration.name,
        ),
      );
      if (legacy.length === 0) return [];

      // Same shape the migrator creates, so it can take this ledger over.
      yield* sql`
        CREATE TABLE IF NOT EXISTS ${forkTable} (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )
      `;
      const recorded = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM ${forkTable}
      `;
      const recordedIds = new Set(recorded.map((row) => row.migration_id));

      // Everything is checked before anything moves. A fork migration's old number held by some
      // other name, while that fork migration is not yet in the fork's ledger, is a history this
      // cannot explain: moving the rows around it would run that migration a second time.
      const unexplained = input.migrations.flatMap((migration) => {
        if (recordedIds.has(migration.id)) return [];
        const row = upstream.find((other) => other.migration_id === migration.legacyUpstreamId);
        return row === undefined || row.name === migration.name
          ? []
          : [`${row.migration_id}_${row.name}`];
      });
      // Nor can one migration be recorded in both ledgers: which of the two ran is unknowable.
      const recordedTwice = legacy
        .filter((migration) => recordedIds.has(migration.id))
        .map((migration) => `${migration.legacyUpstreamId}_${migration.name}`);
      if (unexplained.length > 0 || recordedTwice.length > 0) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: `Cannot move fork migrations out of upstream's ledger: ${[
            ...(unexplained.length === 0
              ? []
              : [`it holds ${unexplained.join(", ")} under a fork migration's old number`]),
            ...(recordedTwice.length === 0
              ? []
              : [`${recordedTwice.join(", ")} is already in the fork's ledger too`]),
          ].join(", and ")}. The database is unchanged.`,
        });
      }
      const adoptable = legacy.toSorted((a, b) => a.id - b.id);

      // The migrator skips every id up to the highest recorded, so a gap would never be filled.
      const head = Math.max(0, ...recordedIds);
      if (adoptable.some((migration, index) => migration.id !== head + index + 1)) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: `Cannot move fork migrations out of upstream's ledger: after ${head} recorded fork migrations it holds ${adoptable.map((migration) => `${migration.legacyUpstreamId}_${migration.name}`).join(", ")}, which leaves a gap. The database is unchanged.`,
        });
      }

      for (const migration of adoptable) {
        yield* sql`
          INSERT INTO ${forkTable} (migration_id, created_at, name)
          SELECT ${migration.id}, created_at, name FROM effect_sql_migrations
          WHERE migration_id = ${migration.legacyUpstreamId} AND name = ${migration.name}
        `;
        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = ${migration.legacyUpstreamId} AND name = ${migration.name}
        `;
      }
      return adoptable.map((migration) => [migration.id, migration.name] as const);
    }),
  );
});
