import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN target_thread_id TEXT
  `;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN created_by_json TEXT
  `;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN disabled_reason TEXT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_triggers_target_thread
    ON project_triggers(target_thread_id, deleted_at, enabled)
  `;
});
