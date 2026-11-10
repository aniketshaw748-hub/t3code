import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { FORK_MIGRATIONS_TABLE } from "../ForkMigrations.ts";

export interface LedgerRow {
  readonly migration_id: number;
  readonly name: string;
  readonly created_at: string;
}

const ledger = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}
    `;
    if (tables.length === 0) return [];
    return yield* sql<LedgerRow>`
      SELECT migration_id, name, created_at FROM ${sql(table)} ORDER BY migration_id
    `;
  });

export const upstreamLedger = ledger("effect_sql_migrations");
export const forkLedger = ledger(FORK_MIGRATIONS_TABLE);

export const ledgerIds = (rows: ReadonlyArray<LedgerRow>) =>
  rows.map((row) => [row.migration_id, row.name] as const);

export interface SchemaSnapshot {
  /** Columns per table, sorted by name: `ALTER TABLE` order differs between upgrade paths. */
  readonly tables: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Indexes, triggers and views with their defining SQL. */
  readonly others: ReadonlyArray<{
    readonly name: string;
    readonly table: string;
    readonly sql: string | null;
  }>;
}

/** The schema without row data or column order, so two migration orders can be compared. */
export const schemaSnapshot = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly table_name: string;
    readonly name: string;
    readonly type: string;
    readonly notnull: number;
    readonly dflt_value: string | null;
    readonly pk: number;
  }>`
    SELECT m.name AS table_name, c.name, c.type, c."notnull", c.dflt_value, c.pk
    FROM sqlite_master m, pragma_table_info(m.name) c
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, c.name
  `;
  const tables: Record<string, Array<string>> = {};
  for (const column of columns) {
    (tables[column.table_name] ??= []).push(
      [
        column.name,
        column.type,
        column.notnull === 1 ? "NOT NULL" : "",
        column.dflt_value === null ? "" : `DEFAULT ${column.dflt_value}`,
        column.pk > 0 ? `PRIMARY KEY ${column.pk}` : "",
      ]
        .filter((part) => part !== "")
        .join(" "),
    );
  }
  const others = yield* sql<{
    readonly name: string;
    readonly table: string;
    readonly sql: string | null;
  }>`
    SELECT name, tbl_name AS "table", sql FROM sqlite_master
    WHERE type <> 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `;
  return { tables, others } satisfies SchemaSnapshot;
});
