# Fork migrations

This fork keeps its schema changes out of upstream's migration sequence. Upstream's migrator skips
every id at or below the highest one a database has recorded, whatever its name, so a fork
migration numbered inside that sequence hides the upstream migration that later takes the same
number ([Divergent migration ids](./legacy-orchestration-migration.md#divergent-migration-ids)).

- Upstream's migrations live in `apps/server/src/persistence/Migrations/` and are recorded in
  `effect_sql_migrations`. Do not add fork migrations there. A merge from upstream should apply to
  that folder and to the list in `Migrations.ts` with no renumbering.
- The fork's migrations live in `apps/server/src/persistence/ForkMigrations/`, are listed in
  [`ForkMigrations.ts`](../../apps/server/src/persistence/ForkMigrations.ts) and are recorded in
  `fork_sql_migrations`, numbered from 1.

`runMigrations` runs upstream's migrations first and the fork's after them, on every path that
opens the database. A run limited to an upstream id, which only tests use, runs no fork migration.

## Adding a fork migration

1. Add `ForkMigrations/NNN_Name.ts` with the next fork number.
2. Add its line to `forkMigrationEntries`, such as `[7, "Name", Migration0007, 80]`. The last
   number is `upstreamBase`: the highest number in `Migrations/` at that moment. Never change it
   afterwards.
3. If it creates a table, add the table to `forkTables` in `ForkMigrations.test.ts`.

## What a fork migration may touch

Fork and upstream migrations do not run in one fixed order. A database that has followed every
release ran each fork migration before the upstream migrations written after it. A new database
runs all of upstream first, including migrations written years later, and then the fork's. Both
must end with the same schema and data, so a fork migration has to give the same result on either
side of any later upstream migration.

The rule: a fork migration creates and changes only the fork's own tables. Then upstream cannot
disturb it, in either order. Reading an upstream table is safe only while upstream keeps the
columns read.

Changing an upstream table is the exception and needs a reason, because upstream can later rebuild
or drop that table. A rebuild on a long-lived database would silently lose the fork's column, while
a new database would still get it. Prefer a fork table keyed by the upstream row's id. The one
existing exception is `projection_projects.kind` (fork migration 2).

`ForkMigrations.test.ts` enforces this. It fails when the fork's migrations add anything outside
the listed tables and columns, and it replays both orders and compares the schemas. Run it after
every upstream sync: a failure there means an upstream migration collides with a fork one, and the
fix is a new fork migration, never an edit to an old one or to upstream's.

Fork migrations do not change the `databaseMigration` number the server reports. Clients use that
number, with the server version, to decide whether a cached snapshot is still valid, so a fork
migration that rewrites data clients cache must ship with a new server version.

## Databases from before the separate ledger

Fork migrations 1 to 6 were first released as upstream ids 81 to 86. At startup
[`adoptLegacyForkMigrations`](../../apps/server/src/persistence/adoptLegacyForkMigrations.ts) moves
those ledger rows, matched by id and name, into `fork_sql_migrations` in one transaction. Nothing
is run again and no other table is touched. Afterwards `effect_sql_migrations` holds only
upstream's rows, so upstream's own 81 runs normally when it arrives.

A build from before this change cannot open a database once the rows have moved. It tries to add
`projection_projects.kind` again, fails, and leaves the database unchanged.

A migration another branch still added as an upstream number (say `087_Name.ts`) is folded in
during the merge: move the file to `ForkMigrations/` under the next fork number, take its line out
of `Migrations.ts`, and add it to `forkMigrationEntries` with its old number as the fifth value,
such as `[7, "Name", Migration0007, 80, 87]`. A database that already ran it as 87 then has the row
moved instead of running it twice.
