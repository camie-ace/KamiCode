import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_turn_queue
    ADD COLUMN scheduled_for TEXT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turn_queue_status_scheduled
    ON projection_turn_queue(status, scheduled_for)
  `;
});
