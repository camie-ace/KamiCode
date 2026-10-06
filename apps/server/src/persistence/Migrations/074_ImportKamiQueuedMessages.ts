import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** V1 queue jobs become durable one-shot schedules on the same conversation. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO project_triggers (
      trigger_id, project_id, name, description, enabled, schedule_kind,
      schedule_cron, schedule_once_at, timezone, runtime_target, next_fire_at,
      last_fire_at, prompt, attachments_json, model_selection_json, runtime_mode,
      interaction_mode, dispatch_policy, title_seed, bootstrap_json,
      created_at, updated_at, target_thread_id, created_by_json, disabled_reason
    )
    SELECT
      'migration:v1:queue:' || queue.queue_id, thread.project_id,
      'Scheduled: ' || substr(COALESCE(NULLIF(message.text, ''), 'Attached files'), 1, 140),
      'Message preserved from the previous KamiCode queue',
      CASE WHEN thread.deleted_at IS NOT NULL OR thread.archived_at IS NOT NULL
        OR thread.settled_at IS NOT NULL OR queue.status = 'dispatching' THEN 0 ELSE 1 END,
      'once', NULL,
      COALESCE(queue.scheduled_for, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || queue.queue_position || ' seconds')),
      'UTC', 'local',
      COALESCE(queue.scheduled_for, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || queue.queue_position || ' seconds')),
      NULL, COALESCE(NULLIF(message.text, ''), 'Continue with the attached files.'),
      COALESCE(message.attachments_json, '[]'),
      COALESCE(queue.model_selection_json, thread.model_selection_json, '{"instanceId":"codex","model":"gpt-5.4"}'),
      queue.runtime_mode, queue.interaction_mode, 'queue', queue.title_seed, NULL,
      queue.requested_at, queue.requested_at, thread.thread_id, (SELECT json_object('userId', attribution.user_id, 'githubLogin', attribution.github_login, 'displayName', attribution.display_name, 'avatarUrl', attribution.avatar_url) FROM user_thread_attribution attribution WHERE attribution.thread_id = thread.thread_id),
      CASE WHEN thread.deleted_at IS NOT NULL THEN 'thread-deleted'
        WHEN thread.archived_at IS NOT NULL THEN 'thread-archived'
        WHEN thread.settled_at IS NOT NULL THEN 'thread-settled' ELSE NULL END
    FROM projection_turn_queue queue
    JOIN projection_threads thread ON thread.thread_id = queue.thread_id
    JOIN projection_thread_messages message ON message.message_id = queue.message_id
    WHERE queue.status IN ('queued', 'dispatching')
    ON CONFLICT(trigger_id) DO NOTHING
  `;
  // Leave the original rows intact for audit and rollback. A dispatch already in
  // flight is imported paused because the old provider may have accepted it.
});
