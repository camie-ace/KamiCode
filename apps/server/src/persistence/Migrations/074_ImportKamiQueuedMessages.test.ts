import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("Kami queue migration", (it) => {
  it.effect(
    "preserves reordered and delayed prompts, attachments and ambiguous dispatches without changing old rows",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 73 });
        yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
      VALUES ('thread', 'project', 'Work', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`;
        for (const [id, status, position, scheduled] of [
          ["second", "queued", 1, null],
          ["first", "queued", 0, null],
          ["later", "queued", 2, "2099-10-06T10:00:00.000Z"],
          ["uncertain", "dispatching", 3, null],
          ["finished", "completed", 4, null],
        ] as const) {
          yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at)
        VALUES (${id}, 'thread', 'user', ${id}, '[{"type":"video","id":"clip","name":"clip.mp4","mimeType":"video/mp4","sizeBytes":42}]', 0, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`;
          yield* sql`INSERT INTO projection_turn_queue (queue_id, thread_id, event_id, message_id, status, requested_at, runtime_mode, interaction_mode, queue_position, scheduled_for)
        VALUES (${id}, 'thread', ${id}, ${id}, ${status}, '2026-10-01T00:00:00.000Z', 'approval-required', 'test', ${position}, ${scheduled})`;
        }
        yield* runMigrations({ toMigrationInclusive: 74 });
        const rows = yield* sql<{
          prompt: string;
          enabled: number;
          next_fire_at: string;
          attachments_json: string;
          runtime_mode: string;
          target_thread_id: string;
        }>`SELECT * FROM project_triggers ORDER BY next_fire_at`;
        assert.strictEqual(rows.length, 4);
        assert.deepEqual(
          rows.slice(0, 2).map((row) => row.prompt),
          ["first", "second"],
        );
        assert.strictEqual(
          rows.find((row) => row.prompt === "later")?.next_fire_at,
          "2099-10-06T10:00:00.000Z",
        );
        assert.strictEqual(rows.find((row) => row.prompt === "uncertain")?.enabled, 0);
        assert.strictEqual(rows[0]?.runtime_mode, "approval-required");
        assert.strictEqual(rows[0]?.target_thread_id, "thread");
        const attachments = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String }))),
        )(rows[0]!.attachments_json);
        assert.strictEqual(attachments[0]?.type, "video");
        const original = yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM projection_turn_queue`;
        assert.strictEqual(original[0]?.count, 5);
        yield* runMigrations({ toMigrationInclusive: 74 });
        const repeated = yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM project_triggers`;
        assert.strictEqual(repeated[0]?.count, 4);
      }),
  );
});
