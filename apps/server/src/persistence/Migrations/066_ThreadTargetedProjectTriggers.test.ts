import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("066_ThreadTargetedProjectTriggers", (it) => {
  it.effect("adds thread lifecycle and creator metadata without changing existing triggers", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 65 });

      yield* sql`
        INSERT INTO project_triggers (
          trigger_id, project_id, name, enabled, schedule_kind, schedule_cron,
          schedule_once_at, timezone, runtime_target, next_fire_at, last_fire_at,
          prompt, attachments_json, model_selection_json, runtime_mode,
          interaction_mode, dispatch_policy, title_seed, bootstrap_json, created_at,
          updated_at, deleted_at, schedule_claimed_at, schedule_claim_expires_at,
          failure_detail, description
        ) VALUES (
          'trigger-existing', 'project-existing', 'Existing trigger', 1, 'cron',
          '0 9 * * *', NULL, 'UTC', 'local', '2026-09-12T09:00:00.000Z', NULL,
          'Run this', '[]', '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access', 'default', NULL, NULL, NULL,
          '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', NULL, NULL,
          NULL, NULL, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 66 });

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(project_triggers)`;
      const columnNames = new Set(columns.map((column) => column.name));
      assert.strictEqual(columnNames.has("target_thread_id"), true);
      assert.strictEqual(columnNames.has("created_by_json"), true);
      assert.strictEqual(columnNames.has("disabled_reason"), true);

      const rows = yield* sql<{
        readonly targetThreadId: string | null;
        readonly createdByJson: string | null;
        readonly disabledReason: string | null;
      }>`
        SELECT
          target_thread_id AS "targetThreadId",
          created_by_json AS "createdByJson",
          disabled_reason AS "disabledReason"
        FROM project_triggers
        WHERE trigger_id = 'trigger-existing'
      `;
      assert.deepEqual(rows, [{ targetThreadId: null, createdByJson: null, disabledReason: null }]);
    }),
  );
});
