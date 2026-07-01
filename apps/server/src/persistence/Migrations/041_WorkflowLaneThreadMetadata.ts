import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const existing = new Set(columns.map((column) => column.name));

  if (!existing.has("workflow_parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workflow_parent_thread_id TEXT
    `;
  }

  if (!existing.has("workflow_lane_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workflow_lane_id TEXT
    `;
  }

  if (!existing.has("workflow_lane_role")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workflow_lane_role TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_workflow_parent
    ON projection_threads(workflow_parent_thread_id, workflow_lane_id)
  `;
});
