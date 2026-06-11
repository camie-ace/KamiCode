import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS shared_project_ssh_credentials (
      ssh_credential_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      encrypted_secret_json TEXT NOT NULL,
      secret_updated_at TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (shared_project_id) REFERENCES shared_projects(shared_project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_project_ssh_credentials_project_idx
    ON shared_project_ssh_credentials(shared_project_id, updated_at)
  `;

  const runtimeColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(shared_runtimes)
  `;
  if (!runtimeColumns.some((column) => column.name === "ssh_credential_id")) {
    yield* sql`
      ALTER TABLE shared_runtimes
      ADD COLUMN ssh_credential_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS shared_runtimes_ssh_credential_idx
    ON shared_runtimes(ssh_credential_id)
  `;
});
