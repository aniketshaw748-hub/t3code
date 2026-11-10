import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import {
  adoptLegacyForkMigrations,
  isLegacyForkMigrationRecord,
} from "./adoptLegacyForkMigrations.ts";
import Migration0001 from "./ForkMigrations/001_Deliverables.ts";
import Migration0002 from "./ForkMigrations/002_ProjectionProjectsKind.ts";
import Migration0003 from "./ForkMigrations/003_DeliverableNotes.ts";
import Migration0004 from "./ForkMigrations/004_WholeDeliverableNotesToChat.ts";
import Migration0005 from "./ForkMigrations/005_DeliverableStrayVersionOf.ts";
import Migration0006 from "./ForkMigrations/006_DirectPushDevices.ts";
import Migration0007 from "./ForkMigrations/007_RecheckDeliverableSelfChecks.ts";
import Migration0008 from "./ForkMigrations/008_DeliverableVersionBlobs.ts";
import Migration0009 from "./ForkMigrations/009_RecheckSelfChecksAfterContentAlignment.ts";
import Migration0010 from "./ForkMigrations/010_DeliverableHistoryPurges.ts";

type ForkMigrationEntry = readonly [
  id: number,
  name: string,
  migration: Effect.Effect<void, SqlError, SqlClient.SqlClient>,
  /** Upstream's highest migration when this entry was written. Never change it afterwards. */
  upstreamBase: number,
  /** The id an older build recorded this entry under in upstream's ledger. */
  legacyUpstreamId?: number,
];

/**
 * This fork's schema changes, in their own sequence and ledger so upstream's `Migrations.ts`
 * merges without renumbering. A long-lived database ran each entry before later upstream
 * migrations and a new one runs it after them: docs/internals/fork-migrations.md has the rules.
 */
const forkMigrationEntries: ReadonlyArray<ForkMigrationEntry> = [
  [1, "Deliverables", Migration0001, 80, 81],
  [2, "ProjectionProjectsKind", Migration0002, 80, 82],
  [3, "DeliverableNotes", Migration0003, 80, 83],
  [4, "WholeDeliverableNotesToChat", Migration0004, 80, 84],
  [5, "DeliverableStrayVersionOf", Migration0005, 80, 85],
  [6, "DirectPushDevices", Migration0006, 80, 86],
  [7, "RecheckDeliverableSelfChecks", Migration0007, 80],
  [8, "DeliverableVersionBlobs", Migration0008, 80],
  [9, "RecheckSelfChecksAfterContentAlignment", Migration0009, 80],
  [10, "DeliverableHistoryPurges", Migration0010, 80],
];

export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

export const forkMigrationManifest = forkMigrationEntries.map(
  ([id, name, , upstreamBase]) => [id, name, upstreamBase] as const,
);

const legacyForkMigrations = forkMigrationEntries.flatMap(([id, name, , , legacyUpstreamId]) =>
  legacyUpstreamId === undefined ? [] : [{ id, name, legacyUpstreamId }],
);

/** True for a row in upstream's ledger that is a fork migration an older build recorded there. */
export const isLegacyForkMigration = (record: { readonly id: number; readonly name: string }) =>
  isLegacyForkMigrationRecord(legacyForkMigrations, record);

const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      forkMigrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export interface RunForkMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/** Runs pending fork migrations. Upstream's schema must already be current. */
export const runForkMigrations = Effect.fn("runForkMigrations")(function* ({
  toMigrationInclusive,
}: RunForkMigrationsOptions = {}) {
  const executedMigrations = yield* run({
    loader: makeMigrationLoader(toMigrationInclusive),
    table: FORK_MIGRATIONS_TABLE,
  });
  if (executedMigrations.length > 0) {
    yield* Effect.log("Fork migrations ran successfully").pipe(
      Effect.annotateLogs({
        migrations: executedMigrations.map(([id, name]) => `${id}_${name}`),
      }),
    );
  }
  return executedMigrations;
});

/**
 * Wraps upstream's migration run with the fork's: legacy fork rows leave upstream's ledger first so
 * no upstream migration is skipped, then upstream runs, then the fork's migrations on top of it.
 * A run limited to an upstream id stops there, since fork migrations expect upstream's full schema.
 * The result is upstream's own, unchanged.
 */
export const withForkMigrations =
  <Options extends { readonly toMigrationInclusive?: number | undefined }, A, E, R>(
    runUpstreamMigrations: (options?: Options) => Effect.Effect<A, E, R>,
  ) =>
  (options?: Options) =>
    Effect.gen(function* () {
      const adopted = yield* adoptLegacyForkMigrations({
        forkTable: FORK_MIGRATIONS_TABLE,
        migrations: legacyForkMigrations,
      });
      if (adopted.length > 0) {
        yield* Effect.log("Moved fork migrations from upstream's ledger to their own").pipe(
          Effect.annotateLogs({ migrations: adopted.map(([id, name]) => `${id}_${name}`) }),
        );
      }
      const executedMigrations = yield* runUpstreamMigrations(options);
      if (options?.toMigrationInclusive === undefined) yield* runForkMigrations();
      return executedMigrations;
    });
