import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_projects (
      shared_project_id TEXT PRIMARY KEY,
      source_project_id TEXT,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      owner_github_id TEXT NOT NULL,
      owner_github_login TEXT NOT NULL,
      repo_canonical_key TEXT,
      repo_remote_url TEXT,
      repo_remote_name TEXT,
      default_branch TEXT,
      current_branch TEXT,
      current_head_sha TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      context_json TEXT,
      context_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS shared_projects_owner_source_project_idx
    ON shared_projects(owner_user_id, source_project_id)
    WHERE source_project_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_projects_repo_idx
    ON shared_projects(repo_canonical_key)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_project_members (
      shared_project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      github_id TEXT NOT NULL,
      github_login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      invited_by_user_id TEXT,
      removed_at TEXT,
      PRIMARY KEY (shared_project_id, user_id),
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_project_members_user_idx
    ON shared_project_members(user_id, removed_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_project_members_github_login_idx
    ON shared_project_members(github_login)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_project_invites (
      invite_code TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      invited_github_login TEXT NOT NULL,
      invited_github_id TEXT,
      role TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT,
      claimed_by_user_id TEXT,
      revoked_at TEXT,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_project_invites_project_idx
    ON shared_project_invites(shared_project_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_threads (
      shared_thread_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      local_thread_id TEXT,
      created_by_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL,
      code_state_json TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      session_snapshot_json TEXT,
      last_runtime_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS shared_threads_project_local_thread_idx
    ON shared_threads(shared_project_id, local_thread_id)
    WHERE local_thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_runtimes (
      runtime_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      runtime_type TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      endpoint_label TEXT,
      health TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      provider_label TEXT,
      unavailable_reason TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_runtimes_project_idx
    ON shared_runtimes(shared_project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_project_environments (
      environment_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      environment_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT NOT NULL,
      last_validated_at TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS shared_project_environments_default_idx
    ON shared_project_environments(shared_project_id)
    WHERE is_default = 1
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_project_environments_project_idx
    ON shared_project_environments(shared_project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_deploy_associations (
      deploy_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      deploy_url TEXT NOT NULL,
      deployed_sha TEXT,
      source TEXT NOT NULL,
      last_checked_state TEXT NOT NULL,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
      FOREIGN KEY (environment_id) REFERENCES shared_project_environments(environment_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS shared_deploy_associations_project_branch_env_idx
    ON shared_deploy_associations(shared_project_id, branch, environment_id)
  `;
});
