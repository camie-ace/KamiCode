import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_turn_queue
    ADD COLUMN queue_position INTEGER NOT NULL DEFAULT 0
  `;

  yield* sql`
    WITH ranked AS (
      SELECT
        queue_id,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY COALESCE(
            (SELECT sequence FROM orchestration_events WHERE event_id = queue.event_id),
            9223372036854775807
          ), queue_id
        ) - 1 AS queue_position
      FROM projection_turn_queue queue
    )
    UPDATE projection_turn_queue
    SET queue_position = (
      SELECT ranked.queue_position
      FROM ranked
      WHERE ranked.queue_id = projection_turn_queue.queue_id
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turn_queue_thread_status_position
    ON projection_turn_queue(thread_id, status, queue_position)
  `;

  // Queued user messages were originally timestamped when enqueued. Once
  // adopted, that made several prompts bunch together ahead of the response
  // that actually preceded them. The queue keeps requested_at for audit; the
  // chat message now represents the time its turn was adopted.
  yield* sql`
    UPDATE projection_thread_messages
    SET
      turn_id = COALESCE(
        (
          SELECT queue.turn_id
          FROM projection_turn_queue queue
          WHERE queue.message_id = projection_thread_messages.message_id
          LIMIT 1
        ),
        turn_id
      ),
      created_at = (
        SELECT queue.started_at
        FROM projection_turn_queue queue
        WHERE queue.message_id = projection_thread_messages.message_id
        LIMIT 1
      ),
      updated_at = (
        SELECT queue.started_at
        FROM projection_turn_queue queue
        WHERE queue.message_id = projection_thread_messages.message_id
        LIMIT 1
      )
    WHERE role = 'user'
      AND EXISTS (
        SELECT 1
        FROM projection_turn_queue queue
        WHERE queue.message_id = projection_thread_messages.message_id
          AND queue.status IN ('started', 'completed', 'failed')
          AND queue.started_at IS NOT NULL
      )
  `;
});
