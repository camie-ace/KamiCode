import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("KamiCode nightly database upgrade", (it) => {
  it.effect(
    "appends context, title, and thread-lock migrations after KamiCode's existing 66 migrations",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 66 });
        const before = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
        yield* sql`CREATE TABLE nightly_upgrade_sentinel (value TEXT NOT NULL)`;
        yield* sql`INSERT INTO nightly_upgrade_sentinel VALUES ('preserved')`;
        yield* runMigrations();
        yield* runMigrations();
        const after = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
        assert.deepEqual(after.slice(0, 66), before);
        assert.deepEqual(
          after.slice(66).map((entry) => entry.migration_id),
          [67, 68, 69],
        );
        const messages = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(projection_thread_messages)`;
        const threads = yield* sql<{
          readonly name: string;
          readonly notnull: number;
          readonly dflt_value: string | null;
        }>`PRAGMA table_info(projection_threads)`;
        const queue = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(projection_turn_queue)`;
        assert.include(
          messages.map((column) => column.name),
          "context_json",
        );
        assert.include(
          threads.map((column) => column.name),
          "title_state_json",
        );
        const locked = threads.find((column) => column.name === "locked");
        assert.equal(locked?.notnull, 1);
        assert.equal(locked?.dflt_value, "0");
        assert.include(
          queue.map((column) => column.name),
          "scheduled_for",
        );
        assert.deepEqual(yield* sql`SELECT value FROM nightly_upgrade_sentinel`, [
          { value: "preserved" },
        ]);
      }),
  );
});
