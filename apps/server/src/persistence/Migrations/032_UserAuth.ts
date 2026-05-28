import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS user_auth_users (
      user_id TEXT PRIMARY KEY,
      github_id TEXT NOT NULL UNIQUE,
      github_login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_auth_users_github_id
    ON user_auth_users(github_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS user_auth_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_auth_users(user_id) ON DELETE CASCADE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_user_auth_sessions_active
    ON user_auth_sessions(revoked_at, expires_at, user_id)
  `;
});
