import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_triggers (
      trigger_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron', 'once', 'manual')),
      schedule_cron TEXT,
      schedule_once_at TEXT,
      timezone TEXT NOT NULL,
      next_fire_at TEXT,
      last_fire_at TEXT,
      prompt TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      dispatch_policy TEXT,
      title_seed TEXT,
      bootstrap_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      schedule_claimed_at TEXT,
      schedule_claim_expires_at TEXT,
      failure_detail TEXT,
      CHECK (
        (schedule_kind = 'cron' AND schedule_cron IS NOT NULL AND schedule_once_at IS NULL)
        OR (schedule_kind = 'once' AND schedule_cron IS NULL AND schedule_once_at IS NOT NULL)
        OR (schedule_kind = 'manual' AND schedule_cron IS NULL AND schedule_once_at IS NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_triggers_project_deleted
    ON project_triggers(project_id, deleted_at, name)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_triggers_due
    ON project_triggers(enabled, deleted_at, next_fire_at, schedule_claim_expires_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_trigger_runs (
      run_id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'dispatched', 'failed', 'skipped')),
      fire_at TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      claimed_at TEXT,
      claim_expires_at TEXT,
      dispatched_at TEXT,
      completed_at TEXT,
      command_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_sequence INTEGER,
      failure_detail TEXT,
      skip_reason TEXT,
      UNIQUE (trigger_id, fire_at),
      FOREIGN KEY (trigger_id) REFERENCES project_triggers(trigger_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_trigger_runs_due
    ON project_trigger_runs(status, fire_at, claim_expires_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_trigger_runs_trigger_fire
    ON project_trigger_runs(trigger_id, fire_at)
  `;
});
