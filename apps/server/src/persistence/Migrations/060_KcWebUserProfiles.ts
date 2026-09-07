import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Links an environment access session to the GitHub user session that
 * identified it. The link is deliberately separate from either session row:
 * one GitHub login may identify several access-code sessions, and revoking
 * either side removes or invalidates the association without changing the
 * shared environment authorization model.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_session_user_profiles (
      environment_session_id TEXT PRIMARY KEY
        REFERENCES auth_sessions(session_id) ON DELETE CASCADE,
      user_auth_session_id TEXT NOT NULL
        REFERENCES user_auth_sessions(session_id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_session_user_profiles_user_session
    ON auth_session_user_profiles(user_auth_session_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS user_thread_attribution (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      github_login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_thread_attribution_user_project_created
    ON user_thread_attribution(user_id, project_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS user_turn_attribution (
      request_event_id TEXT PRIMARY KEY,
      command_id TEXT,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      turn_id TEXT,
      user_id TEXT NOT NULL,
      github_login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      terminal_status TEXT,
      provider TEXT,
      provider_instance_id TEXT,
      model TEXT,
      effort TEXT,
      usage_status TEXT,
      usage_scope TEXT,
      has_subagents INTEGER,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      cache_creation_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_cost_usd REAL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_turn_attribution_thread_turn
    ON user_turn_attribution(thread_id, turn_id)
    WHERE turn_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_turn_attribution_thread_message
    ON user_turn_attribution(thread_id, message_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_turn_attribution_user_project_requested
    ON user_turn_attribution(user_id, project_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_turn_attribution_project_requested
    ON user_turn_attribution(project_id, requested_at)
  `;
});
