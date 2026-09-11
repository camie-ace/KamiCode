import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())(
  "065_ProjectionTurnQueuePriorityAndMessageTiming",
  (it) => {
    it.effect("persists queue priority and repairs adopted message chronology", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 64 });

        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (
            'message-completed', 'thread-priority', NULL, 'user', 'queued second', 0,
            '2026-09-11T10:00:00.000Z', '2026-09-11T10:00:00.000Z'
          )
        `;
        yield* sql`
          INSERT INTO projection_turn_queue (
            queue_id, thread_id, event_id, message_id, status, requested_at, scheduled_for,
            started_at, completed_at, turn_id, runtime_mode, interaction_mode
          ) VALUES
            (
              'queue:b', 'thread-priority', 'event:b', 'message-completed', 'completed',
              '2026-09-11T10:00:00.000Z', NULL, '2026-09-11T10:02:00.000Z',
              '2026-09-11T10:03:00.000Z', 'turn:b', 'full-access', 'default'
            ),
            (
              'queue:a', 'thread-priority', 'event:a', 'message-pending', 'queued',
              '2026-09-11T10:01:00.000Z', NULL, NULL, NULL, NULL, 'full-access', 'default'
            )
        `;

        yield* runMigrations({ toMigrationInclusive: 65 });

        const queueRows = yield* sql<{
          readonly queueId: string;
          readonly position: number;
        }>`
          SELECT queue_id AS "queueId", queue_position AS position
          FROM projection_turn_queue
          ORDER BY queue_position ASC
        `;
        assert.deepEqual(queueRows, [
          { queueId: "queue:a", position: 0 },
          { queueId: "queue:b", position: 1 },
        ]);

        const messages = yield* sql<{
          readonly createdAt: string;
          readonly turnId: string | null;
        }>`
          SELECT created_at AS "createdAt", turn_id AS "turnId"
          FROM projection_thread_messages
          WHERE message_id = 'message-completed'
        `;
        assert.deepEqual(messages, [{ createdAt: "2026-09-11T10:02:00.000Z", turnId: "turn:b" }]);
      }),
    );
  },
);
