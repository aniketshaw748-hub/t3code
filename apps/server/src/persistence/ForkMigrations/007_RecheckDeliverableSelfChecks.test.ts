import { assert, it } from "@effect/vitest";
import { DeliverableVersionId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as DeliverableRepository from "../Deliverables.ts";
import { runForkMigrations } from "../ForkMigrations.ts";
import { BUILD_MIGRATION_HEAD } from "../databaseMigrationHead.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-01T00:00:00.000Z";

layer("007_RecheckDeliverableSelfChecks", (it) => {
  it.effect("clears recorded self-checks and queues the versions that expect changes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: BUILD_MIGRATION_HEAD });
      yield* runForkMigrations({ toMigrationInclusive: 6 });
      yield* sql`
        INSERT INTO deliverables (
          deliverable_id, project_id, path, kind, title, current_version_id, created_at, updated_at
        ) VALUES ('dlv_1', 'project-1', 'deck.pptx', 'deck', 'Deck', 'v2', ${createdAt}, ${createdAt})
      `;
      const stale = JSON.stringify({
        check: "changed-where-requested",
        status: "failed",
        findings: ["Expected a change at slide 2, but it looks the same."],
        checkedAt: createdAt,
      });
      const versions = [
        ["v1", 1, "[]", null],
        ["v2", 2, JSON.stringify([{ kind: "slide", index: 1 }]), stale],
      ] as const;
      for (const [id, ordinal, expectedChanges, selfCheck] of versions) {
        yield* sql`
          INSERT INTO deliverable_versions (
            version_id, deliverable_id, ordinal, parent_version_id, content_sha256, size_bytes,
            source_blob_oid, commit_oid, version_ref, source_json, summary, expected_changes_json,
            self_check_json, created_at
          ) VALUES (
            ${id}, 'dlv_1', ${ordinal}, NULL, ${`sha-${id}`}, 1, NULL, 'commit', 'ref',
            '{"type":"explicit"}', NULL, ${expectedChanges}, ${selfCheck}, ${createdAt}
          )
        `;
        yield* sql`
          INSERT INTO deliverable_renditions (
            content_sha256, kind, status, renderer, detail, rendition_json, updated_at
          ) VALUES (${`sha-${id}`}, 'deck', 'ready', 'test', NULL, NULL, ${createdAt})
        `;
      }

      yield* runForkMigrations({ toMigrationInclusive: 7 });
      assert.deepStrictEqual(
        yield* sql`SELECT version_id, self_check_json FROM deliverable_versions ORDER BY ordinal`,
        [
          { version_id: "v1", self_check_json: null },
          { version_id: "v2", self_check_json: null },
        ],
      );
      // Both are rendered; only the one that named a place to change has a check to run again.
      const repository = yield* DeliverableRepository.DeliverableRepository.pipe(
        Effect.provide(DeliverableRepository.layer),
      );
      assert.deepStrictEqual(yield* repository.listUnfinished, [DeliverableVersionId.make("v2")]);
    }),
  );
});
