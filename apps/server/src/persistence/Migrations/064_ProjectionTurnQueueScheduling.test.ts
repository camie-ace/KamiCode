import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("064_ProjectionTurnQueueScheduling", (it) => {
  it.effect("adds the durable schedule instant and its dispatch index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 63 });
      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turn_queue)
      `;
      assert.notInclude(
        before.map((column) => column.name),
        "scheduled_for",
      );

      yield* runMigrations({ toMigrationInclusive: 64 });
      const after = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turn_queue)
      `;
      assert.include(
        after.map((column) => column.name),
        "scheduled_for",
      );

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_projection_turn_queue_status_scheduled'
      `;
      assert.deepEqual(indexes, [{ name: "idx_projection_turn_queue_status_scheduled" }]);
    }),
  );
});
