import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_turn_queue (
      queue_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      command_id TEXT,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      turn_id TEXT,
      model_selection_json TEXT,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      title_seed TEXT,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      failure_detail TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turn_queue_thread_status_requested
    ON projection_turn_queue(thread_id, status, requested_at)
  `;
});
