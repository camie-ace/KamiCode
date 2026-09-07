import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("060_KcWebUserProfiles", (it) => {
  it.effect("adds access-session profile links and durable activity attribution", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 59 });
      yield* runMigrations({ toMigrationInclusive: 60 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'auth_session_user_profiles',
            'user_thread_attribution',
            'user_turn_attribution'
          )
        ORDER BY name
      `;
      assert.deepEqual(
        tables.map((row) => row.name),
        ["auth_session_user_profiles", "user_thread_attribution", "user_turn_attribution"],
      );

      const turnColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(user_turn_attribution)
      `;
      assert.includeMembers(
        turnColumns.map((column) => column.name),
        [
          "project_id",
          "user_id",
          "message_id",
          "turn_id",
          "input_tokens",
          "output_tokens",
          "reasoning_tokens",
          "total_cost_usd",
        ],
      );
    }),
  );
});
