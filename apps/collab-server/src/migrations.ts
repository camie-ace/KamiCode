import type { Pool } from "pg";

import { query, withTransaction } from "./db.ts";

interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "shared-project-control-plane",
    sql: `
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
        dirty BOOLEAN NOT NULL DEFAULT FALSE,
        context_json JSONB,
        context_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS shared_projects_owner_source_project_idx
        ON shared_projects(owner_user_id, source_project_id)
        WHERE source_project_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS shared_projects_repo_idx
        ON shared_projects(repo_canonical_key);

      CREATE TABLE IF NOT EXISTS shared_project_members (
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        github_id TEXT NOT NULL,
        github_login TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL,
        invited_by_user_id TEXT,
        removed_at TIMESTAMPTZ,
        PRIMARY KEY (shared_project_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS shared_project_members_user_idx
        ON shared_project_members(user_id, removed_at);

      CREATE INDEX IF NOT EXISTS shared_project_members_github_login_idx
        ON shared_project_members(github_login);

      CREATE TABLE IF NOT EXISTS shared_project_invites (
        invite_code TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        invited_github_login TEXT NOT NULL,
        invited_github_id TEXT,
        role TEXT NOT NULL,
        invited_by_user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        claimed_at TIMESTAMPTZ,
        claimed_by_user_id TEXT,
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS shared_project_invites_project_idx
        ON shared_project_invites(shared_project_id, created_at);

      CREATE TABLE IF NOT EXISTS shared_threads (
        shared_thread_id TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        local_thread_id TEXT,
        created_by_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        visibility TEXT NOT NULL,
        code_state_json JSONB NOT NULL,
        messages_json JSONB NOT NULL,
        session_snapshot_json JSONB,
        last_runtime_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS shared_threads_project_local_thread_idx
        ON shared_threads(shared_project_id, local_thread_id)
        WHERE local_thread_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS shared_runtimes (
        runtime_id TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        runtime_type TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        endpoint_label TEXT,
        health TEXT NOT NULL,
        capabilities_json JSONB NOT NULL,
        provider_label TEXT,
        unavailable_reason TEXT,
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS shared_runtimes_project_idx
        ON shared_runtimes(shared_project_id);

      CREATE TABLE IF NOT EXISTS shared_project_environments (
        environment_id TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        environment_type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        validation_status TEXT NOT NULL,
        last_validated_at TIMESTAMPTZ,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS shared_project_environments_default_idx
        ON shared_project_environments(shared_project_id)
        WHERE is_default = TRUE;

      CREATE INDEX IF NOT EXISTS shared_project_environments_project_idx
        ON shared_project_environments(shared_project_id);

      CREATE TABLE IF NOT EXISTS shared_deploy_associations (
        deploy_id TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        branch TEXT NOT NULL,
        environment_id TEXT NOT NULL REFERENCES shared_project_environments(environment_id) ON DELETE CASCADE,
        deploy_url TEXT NOT NULL,
        deployed_sha TEXT,
        source TEXT NOT NULL,
        last_checked_state TEXT NOT NULL,
        last_checked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS shared_deploy_associations_project_branch_env_idx
        ON shared_deploy_associations(shared_project_id, branch, environment_id);
    `,
  },
  {
    id: 2,
    name: "shared-artifacts",
    sql: `
      CREATE TABLE IF NOT EXISTS shared_project_artifacts (
        artifact_id TEXT PRIMARY KEY,
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        content_json JSONB,
        uri TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS shared_project_artifacts_project_idx
        ON shared_project_artifacts(shared_project_id, updated_at DESC);
    `,
  },
  {
    id: 3,
    name: "shared-session-snapshots",
    sql: `
      ALTER TABLE shared_threads
        ADD COLUMN IF NOT EXISTS session_snapshot_json JSONB;
    `,
  },
  {
    id: 4,
    name: "shared-thread-links",
    sql: `
      ALTER TABLE shared_threads
        ADD COLUMN IF NOT EXISTS share_code TEXT;

      ALTER TABLE shared_threads
        ADD COLUMN IF NOT EXISTS allowed_github_logins_json JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE UNIQUE INDEX IF NOT EXISTS shared_threads_share_code_idx
        ON shared_threads(share_code)
        WHERE share_code IS NOT NULL;
    `,
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  await query(
    pool,
    `
      CREATE TABLE IF NOT EXISTS collab_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await withTransaction(pool, async (client) => {
    for (const migration of migrations) {
      const applied = await query<{ id: number }>(
        client,
        "SELECT id FROM collab_migrations WHERE id = $1",
        [migration.id],
      );
      if (applied.length > 0) continue;

      await query(client, migration.sql);
      await query(client, "INSERT INTO collab_migrations (id, name) VALUES ($1, $2)", [
        migration.id,
        migration.name,
      ]);
    }
  });
}
