import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Replaces dispatch-only trigger bookkeeping with durable run lifecycle and
 * webhook intake state. Webhook secrets are derived from the server secret
 * store; the database keeps only a public id and a rotation version.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN webhook_public_id TEXT
  `;
  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN webhook_secret_version INTEGER NOT NULL DEFAULT 0
    CHECK (webhook_secret_version >= 0)
  `;
  yield* sql`
    UPDATE project_triggers
    SET webhook_public_id = lower(hex(randomblob(16)))
    WHERE webhook_public_id IS NULL
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_triggers_webhook_public_id
    ON project_triggers(webhook_public_id)
  `;

  // SQLite cannot alter CHECK constraints in place, so rebuild the run table.
  yield* sql`DROP INDEX IF EXISTS idx_project_trigger_runs_due`;
  yield* sql`DROP INDEX IF EXISTS idx_project_trigger_runs_trigger_fire`;
  yield* sql`ALTER TABLE project_trigger_runs RENAME TO project_trigger_runs_legacy_045`;

  yield* sql`
    CREATE TABLE project_trigger_runs (
      run_id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL,
      initiator TEXT NOT NULL CHECK (initiator IN ('manual', 'cron', 'webhook', 'retry')),
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled')
      ),
      event_kind TEXT,
      event_payload_json TEXT,
      idempotency_key TEXT,
      request_digest TEXT,
      retry_of_run_id TEXT,
      fire_at TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      claimed_at TEXT,
      claim_expires_at TEXT,
      dispatched_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      command_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_sequence INTEGER,
      failure_detail TEXT,
      cancellation_reason TEXT,
      UNIQUE (trigger_id, idempotency_key),
      FOREIGN KEY (trigger_id) REFERENCES project_triggers(trigger_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    INSERT INTO project_trigger_runs (
      run_id,
      trigger_id,
      initiator,
      status,
      event_kind,
      fire_at,
      queued_at,
      claimed_at,
      claim_expires_at,
      dispatched_at,
      started_at,
      completed_at,
      command_id,
      thread_id,
      message_id,
      command_json,
      result_sequence,
      failure_detail,
      cancellation_reason
    )
    SELECT
      run_id,
      trigger_id,
      CASE WHEN fire_at = queued_at THEN 'manual' ELSE 'cron' END,
      CASE status
        WHEN 'queued' THEN 'queued'
        WHEN 'claimed' THEN 'starting'
        WHEN 'dispatched' THEN 'starting'
        WHEN 'failed' THEN 'failed'
        WHEN 'skipped' THEN 'cancelled'
      END,
      CASE WHEN fire_at = queued_at THEN 'manual' ELSE 'cron' END,
      fire_at,
      queued_at,
      claimed_at,
      claim_expires_at,
      dispatched_at,
      NULL,
      CASE WHEN status IN ('failed', 'skipped') THEN completed_at ELSE NULL END,
      command_id,
      thread_id,
      message_id,
      command_json,
      result_sequence,
      failure_detail,
      CASE WHEN status = 'skipped' THEN skip_reason ELSE NULL END
    FROM project_trigger_runs_legacy_045
  `;
  yield* sql`DROP TABLE project_trigger_runs_legacy_045`;

  yield* sql`
    CREATE INDEX idx_project_trigger_runs_due
    ON project_trigger_runs(status, fire_at, claim_expires_at)
  `;
  yield* sql`
    CREATE INDEX idx_project_trigger_runs_trigger_fire
    ON project_trigger_runs(trigger_id, fire_at)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_project_trigger_runs_thread
    ON project_trigger_runs(thread_id)
  `;

  yield* sql`
    CREATE TABLE project_trigger_webhook_receipts (
      trigger_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      nonce TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (trigger_id, idempotency_key),
      UNIQUE (trigger_id, nonce),
      FOREIGN KEY (trigger_id) REFERENCES project_triggers(trigger_id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES project_trigger_runs(run_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX idx_project_trigger_webhook_receipts_expiry
    ON project_trigger_webhook_receipts(expires_at)
  `;
});
