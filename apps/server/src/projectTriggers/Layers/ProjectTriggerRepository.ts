import {
  ChatAttachment,
  ModelSelection,
  ProjectId,
  ThreadId,
  ThreadTurnStartCommand,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  ClaimDueProjectTriggerRunsInput,
  ClaimDueProjectTriggersInput,
  DeleteProjectTriggerInput,
  ListActiveProjectTriggerRunsInput,
  ListProjectTriggerRunsByTriggerInput,
  ListProjectTriggersByProjectInput,
  MarkProjectTriggerRunCancelledInput,
  MarkProjectTriggerRunFailedInput,
  MarkProjectTriggerRunRunningInput,
  MarkProjectTriggerRunStartingInput,
  MarkProjectTriggerRunSucceededInput,
  MarkProjectTriggerScheduleFailedInput,
  ProjectTriggerBootstrap,
  ProjectTriggerIdInput,
  ProjectTriggerPublicIdInput,
  ProjectTriggerRepository,
  ProjectTriggerRow,
  ProjectTriggerRunIdInput,
  ProjectTriggerRunRow,
  RecoverExpiredProjectTriggerClaimsInput,
  ScheduleProjectTriggerRunInput,
  RotateProjectTriggerWebhookSecretVersionInput,
  SettleProjectTriggerRunByThreadInput,
  UpsertProjectTriggerInput,
  type AcceptProjectTriggerWebhookRunInput,
  type RecordProjectTriggerWebhookOperationInput,
  type ProjectTriggerRepositoryChange,
  type ProjectTriggerRepositoryShape,
} from "../Services/ProjectTriggerRepository.ts";

const ProjectTriggerDbRow = ProjectTriggerRow.mapFields(
  Struct.assign({
    enabled: Schema.Number,
    attachments: Schema.fromJsonString(Schema.Array(ChatAttachment)),
    modelSelection: Schema.fromJsonString(ModelSelection),
    bootstrap: Schema.NullOr(Schema.fromJsonString(ProjectTriggerBootstrap)),
  }),
);

const ProjectTriggerRunDbRow = ProjectTriggerRunRow.mapFields(
  Struct.assign({
    eventPayload: Schema.NullOr(Schema.fromJsonString(Schema.Json)),
    command: Schema.fromJsonString(ThreadTurnStartCommand),
  }),
);

const TriggerIdRow = Schema.Struct({ triggerId: ProjectTriggerRow.fields.triggerId });
const WebhookSecretVersionRow = Schema.Struct({ version: Schema.Number });
const RunIdRow = Schema.Struct({ runId: ProjectTriggerRunRow.fields.runId });
const TriggerDeleteRow = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
  projectId: ProjectId,
});
const RunProjectRefRow = Schema.Struct({
  runId: ProjectTriggerRunRow.fields.runId,
  triggerId: ProjectTriggerRow.fields.triggerId,
  projectId: ProjectId,
});
const ThreadIdInput = Schema.Struct({ threadId: ThreadId });
const RunIdempotencyInput = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
  idempotencyKey: TrimmedNonEmptyString,
});
const WebhookReceiptLookupInput = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
  value: TrimmedNonEmptyString,
});
const WebhookReceiptRow = Schema.Struct({
  runId: ProjectTriggerRunRow.fields.runId,
  requestDigest: TrimmedNonEmptyString,
});
const WebhookReceiptInsertInput = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
  idempotencyKey: TrimmedNonEmptyString,
  nonce: TrimmedNonEmptyString,
  requestDigest: TrimmedNonEmptyString,
  runId: ProjectTriggerRunRow.fields.runId,
  receivedAt: ProjectTriggerRunRow.fields.queuedAt,
  expiresAt: ProjectTriggerRunRow.fields.queuedAt,
});
const WebhookReceiptCleanupInput = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
  now: ProjectTriggerRunRow.fields.queuedAt,
});

function toProjectTriggerRow(
  row: Schema.Schema.Type<typeof ProjectTriggerDbRow>,
): ProjectTriggerRow {
  return { ...row, enabled: row.enabled === 1 };
}

function toProjectTriggerRunRow(
  row: Schema.Schema.Type<typeof ProjectTriggerRunDbRow>,
): ProjectTriggerRunRow {
  return row;
}

const makeProjectTriggerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<ProjectTriggerRepositoryChange>();

  const upsertTriggerRow = SqlSchema.void({
    Request: UpsertProjectTriggerInput,
    execute: (row) => sql`
      INSERT INTO project_triggers (
        trigger_id, project_id, name, description, enabled, schedule_kind,
        schedule_cron, schedule_once_at, timezone, runtime_target,
        webhook_public_id, webhook_secret_version, next_fire_at, last_fire_at,
        prompt, attachments_json, model_selection_json, runtime_mode,
        interaction_mode, dispatch_policy, title_seed, bootstrap_json,
        created_at, updated_at, deleted_at, schedule_claimed_at,
        schedule_claim_expires_at, failure_detail
      ) VALUES (
        ${row.triggerId}, ${row.projectId}, ${row.name}, ${row.description},
        ${row.enabled ? 1 : 0}, ${row.scheduleKind}, ${row.scheduleCron},
        ${row.scheduleOnceAt}, ${row.timezone}, ${row.runtimeTarget},
        ${row.webhookPublicId}, ${row.webhookSecretVersion}, ${row.nextFireAt},
        ${row.lastFireAt}, ${row.prompt}, ${JSON.stringify(row.attachments)},
        ${JSON.stringify(row.modelSelection)}, ${row.runtimeMode},
        ${row.interactionMode}, ${row.dispatchPolicy}, ${row.titleSeed},
        ${row.bootstrap === null ? null : JSON.stringify(row.bootstrap)},
        ${row.createdAt}, ${row.updatedAt}, ${row.deletedAt},
        ${row.scheduleClaimedAt}, ${row.scheduleClaimExpiresAt}, ${row.failureDetail}
      )
      ON CONFLICT (trigger_id) DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        description = excluded.description,
        enabled = excluded.enabled,
        schedule_kind = excluded.schedule_kind,
        schedule_cron = excluded.schedule_cron,
        schedule_once_at = excluded.schedule_once_at,
        timezone = excluded.timezone,
        runtime_target = excluded.runtime_target,
        webhook_public_id = excluded.webhook_public_id,
        webhook_secret_version = excluded.webhook_secret_version,
        next_fire_at = excluded.next_fire_at,
        last_fire_at = excluded.last_fire_at,
        prompt = excluded.prompt,
        attachments_json = excluded.attachments_json,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        interaction_mode = excluded.interaction_mode,
        dispatch_policy = excluded.dispatch_policy,
        title_seed = excluded.title_seed,
        bootstrap_json = excluded.bootstrap_json,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        schedule_claimed_at = excluded.schedule_claimed_at,
        schedule_claim_expires_at = excluded.schedule_claim_expires_at,
        failure_detail = excluded.failure_detail
    `,
  });

  const triggerSelectColumns = sql`
    trigger_id AS "triggerId", project_id AS "projectId", name, description,
    enabled, schedule_kind AS "scheduleKind", schedule_cron AS "scheduleCron",
    schedule_once_at AS "scheduleOnceAt", timezone,
    runtime_target AS "runtimeTarget", webhook_public_id AS "webhookPublicId",
    webhook_secret_version AS "webhookSecretVersion",
    next_fire_at AS "nextFireAt", last_fire_at AS "lastFireAt", prompt,
    attachments_json AS "attachments", model_selection_json AS "modelSelection",
    runtime_mode AS "runtimeMode", interaction_mode AS "interactionMode",
    dispatch_policy AS "dispatchPolicy", title_seed AS "titleSeed",
    bootstrap_json AS "bootstrap", created_at AS "createdAt",
    updated_at AS "updatedAt", deleted_at AS "deletedAt",
    schedule_claimed_at AS "scheduleClaimedAt",
    schedule_claim_expires_at AS "scheduleClaimExpiresAt", failure_detail AS "failureDetail"
  `;
  const getTriggerRowById = SqlSchema.findOneOption({
    Request: ProjectTriggerIdInput,
    Result: ProjectTriggerDbRow,
    execute: ({ triggerId }) => sql`
      SELECT ${triggerSelectColumns} FROM project_triggers WHERE trigger_id = ${triggerId} LIMIT 1
    `,
  });
  const getTriggerRowByPublicId = SqlSchema.findOneOption({
    Request: ProjectTriggerPublicIdInput,
    Result: ProjectTriggerDbRow,
    execute: ({ publicId }) => sql`
      SELECT ${triggerSelectColumns} FROM project_triggers
      WHERE webhook_public_id = ${publicId} LIMIT 1
    `,
  });
  const listTriggerRowsByProject = SqlSchema.findAll({
    Request: ListProjectTriggersByProjectInput,
    Result: ProjectTriggerDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${triggerSelectColumns} FROM project_triggers
      WHERE project_id = ${projectId} AND deleted_at IS NULL
      ORDER BY name ASC, trigger_id ASC
    `,
  });

  const deleteTriggerRow = SqlSchema.findOneOption({
    Request: DeleteProjectTriggerInput,
    Result: TriggerDeleteRow,
    execute: ({ triggerId, deletedAt }) => sql`
      UPDATE project_triggers
      SET enabled = 0, next_fire_at = NULL, schedule_claimed_at = NULL,
          schedule_claim_expires_at = NULL, deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      WHERE trigger_id = ${triggerId} AND deleted_at IS NULL
      RETURNING trigger_id AS "triggerId", project_id AS "projectId"
    `,
  });

  const recoverExpiredTriggerClaimRows = SqlSchema.findAll({
    Request: RecoverExpiredProjectTriggerClaimsInput,
    Result: TriggerIdRow,
    execute: ({ now }) => sql`
      UPDATE project_triggers
      SET schedule_claimed_at = NULL, schedule_claim_expires_at = NULL
      WHERE schedule_claim_expires_at IS NOT NULL AND schedule_claim_expires_at <= ${now}
      RETURNING trigger_id AS "triggerId"
    `,
  });

  const claimDueTriggerRows = SqlSchema.findAll({
    Request: ClaimDueProjectTriggersInput,
    Result: ProjectTriggerDbRow,
    execute: ({ now, claimExpiresAt, limit }) => sql`
      UPDATE project_triggers
      SET schedule_claimed_at = ${now}, schedule_claim_expires_at = ${claimExpiresAt}
      WHERE trigger_id IN (
        SELECT trigger_id FROM project_triggers
        WHERE enabled = 1 AND deleted_at IS NULL AND next_fire_at IS NOT NULL
          AND next_fire_at <= ${now}
          AND (schedule_claim_expires_at IS NULL OR schedule_claim_expires_at <= ${now})
        ORDER BY next_fire_at ASC, trigger_id ASC LIMIT ${limit}
      )
      RETURNING
        trigger_id AS "triggerId", project_id AS "projectId", name, description,
        enabled, schedule_kind AS "scheduleKind", schedule_cron AS "scheduleCron",
        schedule_once_at AS "scheduleOnceAt", timezone,
        runtime_target AS "runtimeTarget", webhook_public_id AS "webhookPublicId",
        webhook_secret_version AS "webhookSecretVersion",
        next_fire_at AS "nextFireAt", last_fire_at AS "lastFireAt", prompt,
        attachments_json AS "attachments", model_selection_json AS "modelSelection",
        runtime_mode AS "runtimeMode", interaction_mode AS "interactionMode",
        dispatch_policy AS "dispatchPolicy", title_seed AS "titleSeed",
        bootstrap_json AS "bootstrap", created_at AS "createdAt",
        updated_at AS "updatedAt", deleted_at AS "deletedAt",
        schedule_claimed_at AS "scheduleClaimedAt",
        schedule_claim_expires_at AS "scheduleClaimExpiresAt",
        failure_detail AS "failureDetail"
    `,
  });

  const insertRunRow = SqlSchema.findOneOption({
    Request: ProjectTriggerRunRow,
    Result: RunIdRow,
    execute: (row) => sql`
      INSERT INTO project_trigger_runs (
        run_id, trigger_id, initiator, status, event_kind, event_payload_json,
        idempotency_key, request_digest, retry_of_run_id, fire_at, queued_at,
        claimed_at, claim_expires_at, dispatched_at, started_at, completed_at,
        command_id, thread_id, message_id, command_json, result_sequence,
        failure_detail, cancellation_reason
      ) VALUES (
        ${row.runId}, ${row.triggerId}, ${row.initiator}, ${row.status}, ${row.eventKind},
        ${row.eventPayload === null ? null : JSON.stringify(row.eventPayload)},
        ${row.idempotencyKey}, ${row.requestDigest}, ${row.retryOfRunId}, ${row.fireAt},
        ${row.queuedAt}, ${row.claimedAt}, ${row.claimExpiresAt}, ${row.dispatchedAt},
        ${row.startedAt}, ${row.completedAt}, ${row.commandId}, ${row.threadId},
        ${row.messageId}, ${JSON.stringify(row.command)}, ${row.resultSequence},
        ${row.failureDetail}, ${row.cancellationReason}
      )
      ON CONFLICT (run_id) DO NOTHING
      RETURNING run_id AS "runId"
    `,
  });

  const runSelectColumns = sql`
    run_id AS "runId", trigger_id AS "triggerId", initiator, status,
    event_kind AS "eventKind", event_payload_json AS "eventPayload",
    idempotency_key AS "idempotencyKey", request_digest AS "requestDigest",
    retry_of_run_id AS "retryOfRunId", fire_at AS "fireAt", queued_at AS "queuedAt",
    claimed_at AS "claimedAt", claim_expires_at AS "claimExpiresAt",
    dispatched_at AS "dispatchedAt", started_at AS "startedAt",
    completed_at AS "completedAt", command_id AS "commandId", thread_id AS "threadId",
    message_id AS "messageId", command_json AS "command", result_sequence AS "resultSequence",
    failure_detail AS "failureDetail", cancellation_reason AS "cancellationReason"
  `;

  const getRunRowById = SqlSchema.findOneOption({
    Request: ProjectTriggerRunIdInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ runId }) =>
      sql`SELECT ${runSelectColumns} FROM project_trigger_runs WHERE run_id = ${runId} LIMIT 1`,
  });
  const getRunRowByThreadId = SqlSchema.findOneOption({
    Request: ThreadIdInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ threadId }) =>
      sql`SELECT ${runSelectColumns} FROM project_trigger_runs WHERE thread_id = ${threadId} LIMIT 1`,
  });
  const getRunRowByIdempotency = SqlSchema.findOneOption({
    Request: RunIdempotencyInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ triggerId, idempotencyKey }) => sql`
      SELECT ${runSelectColumns} FROM project_trigger_runs
      WHERE trigger_id = ${triggerId} AND idempotency_key = ${idempotencyKey} LIMIT 1
    `,
  });
  const listRunRowsByTrigger = SqlSchema.findAll({
    Request: ListProjectTriggerRunsByTriggerInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ triggerId, limit }) => sql`
      SELECT ${runSelectColumns} FROM project_trigger_runs
      WHERE trigger_id = ${triggerId} ORDER BY fire_at DESC, run_id DESC LIMIT ${limit}
    `,
  });
  const listActiveRunRows = SqlSchema.findAll({
    Request: ListActiveProjectTriggerRunsInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ limit }) => sql`
      SELECT ${runSelectColumns} FROM project_trigger_runs
      WHERE status IN ('queued', 'starting', 'running')
      ORDER BY queued_at ASC, run_id ASC LIMIT ${limit}
    `,
  });

  const markTriggerScheduledRow = SqlSchema.findOneOption({
    Request: ScheduleProjectTriggerRunInput,
    Result: TriggerIdRow,
    execute: ({ triggerId, claimedAt, fireAt, scheduledAt, nextFireAt }) => sql`
      UPDATE project_triggers
      SET last_fire_at = ${fireAt}, next_fire_at = ${nextFireAt}, schedule_claimed_at = NULL,
          schedule_claim_expires_at = NULL, failure_detail = NULL, updated_at = ${scheduledAt}
      WHERE trigger_id = ${triggerId} AND schedule_claimed_at = ${claimedAt}
      RETURNING trigger_id AS "triggerId"
    `,
  });
  const markTriggerScheduleFailedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerScheduleFailedInput,
    Result: TriggerIdRow,
    execute: ({ triggerId, claimedAt, failedAt, failureDetail }) => sql`
      UPDATE project_triggers
      SET next_fire_at = NULL, schedule_claimed_at = NULL, schedule_claim_expires_at = NULL,
          failure_detail = ${failureDetail}, updated_at = ${failedAt}
      WHERE trigger_id = ${triggerId} AND schedule_claimed_at = ${claimedAt}
      RETURNING trigger_id AS "triggerId"
    `,
  });
  const recoverExpiredRunClaimRows = SqlSchema.findAll({
    Request: RecoverExpiredProjectTriggerClaimsInput,
    Result: RunIdRow,
    execute: ({ now }) => sql`
      UPDATE project_trigger_runs
      SET status = 'queued', claimed_at = NULL, claim_expires_at = NULL
      WHERE status = 'starting' AND dispatched_at IS NULL
        AND claim_expires_at IS NOT NULL AND claim_expires_at <= ${now}
      RETURNING run_id AS "runId"
    `,
  });
  const claimDueRunRows = SqlSchema.findAll({
    Request: ClaimDueProjectTriggerRunsInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ now, claimExpiresAt, limit }) => sql`
      UPDATE project_trigger_runs
      SET status = 'starting', claimed_at = ${now}, claim_expires_at = ${claimExpiresAt}
      WHERE run_id IN (
        SELECT run_id FROM project_trigger_runs WHERE status = 'queued' AND fire_at <= ${now}
        ORDER BY fire_at ASC, run_id ASC LIMIT ${limit}
      ) AND status = 'queued'
      RETURNING ${runSelectColumns}
    `,
  });
  const markRunStartingRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunStartingInput,
    Result: RunIdRow,
    execute: ({ runId, dispatchedAt, resultSequence }) => sql`
      UPDATE project_trigger_runs
      SET dispatched_at = ${dispatchedAt}, claim_expires_at = NULL,
          result_sequence = ${resultSequence}, failure_detail = NULL,
          cancellation_reason = NULL
      WHERE run_id = ${runId} AND status = 'starting'
      RETURNING run_id AS "runId"
    `,
  });
  const markRunRunningRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunRunningInput,
    Result: RunIdRow,
    execute: ({ threadId, startedAt }) => sql`
      UPDATE project_trigger_runs
      SET status = 'running', started_at = COALESCE(started_at, ${startedAt}),
          claim_expires_at = NULL
      WHERE thread_id = ${threadId} AND status = 'starting'
      RETURNING run_id AS "runId"
    `,
  });
  const markRunSucceededRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunSucceededInput,
    Result: RunIdRow,
    execute: ({ threadId, completedAt }) => sql`
      UPDATE project_trigger_runs
      SET status = 'succeeded', completed_at = ${completedAt}, failure_detail = NULL,
          cancellation_reason = NULL, claim_expires_at = NULL
      WHERE thread_id = ${threadId} AND status = 'running'
      RETURNING run_id AS "runId"
    `,
  });
  const markRunFailedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunFailedInput,
    Result: RunIdRow,
    execute: ({ runId, failedAt, failureDetail }) => sql`
      UPDATE project_trigger_runs
      SET status = 'failed', completed_at = ${failedAt}, failure_detail = ${failureDetail},
          cancellation_reason = NULL, claim_expires_at = NULL
      WHERE run_id = ${runId} AND status IN ('starting', 'running')
      RETURNING run_id AS "runId"
    `,
  });
  const markRunCancelledRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunCancelledInput,
    Result: RunIdRow,
    execute: ({ runId, cancelledAt, cancellationReason }) => sql`
      UPDATE project_trigger_runs
      SET status = 'cancelled', completed_at = ${cancelledAt},
          cancellation_reason = ${cancellationReason}, failure_detail = NULL,
          claim_expires_at = NULL
      WHERE run_id = ${runId} AND status IN ('queued', 'starting', 'running')
      RETURNING run_id AS "runId"
    `,
  });
  const settleRunByThreadRow = SqlSchema.findOneOption({
    Request: SettleProjectTriggerRunByThreadInput,
    Result: RunIdRow,
    execute: ({ threadId, completedAt, status, detail }) => sql`
      UPDATE project_trigger_runs
      SET status = ${status}, completed_at = ${completedAt},
          failure_detail = CASE WHEN ${status} = 'failed' THEN ${detail} ELSE NULL END,
          cancellation_reason = CASE WHEN ${status} = 'cancelled' THEN ${detail} ELSE NULL END,
          claim_expires_at = NULL
      WHERE thread_id = ${threadId} AND status IN ('starting', 'running')
      RETURNING run_id AS "runId"
    `,
  });
  const rotateWebhookSecretVersionRow = SqlSchema.findOneOption({
    Request: RotateProjectTriggerWebhookSecretVersionInput,
    Result: WebhookSecretVersionRow,
    execute: ({ triggerId, updatedAt }) => sql`
      UPDATE project_triggers
      SET webhook_secret_version = webhook_secret_version + 1, updated_at = ${updatedAt}
      WHERE trigger_id = ${triggerId} AND deleted_at IS NULL
      RETURNING webhook_secret_version AS "version"
    `,
  });

  const getRunProjectRefRow = SqlSchema.findOneOption({
    Request: ProjectTriggerRunIdInput,
    Result: RunProjectRefRow,
    execute: ({ runId }) => sql`
      SELECT r.run_id AS "runId", r.trigger_id AS "triggerId", t.project_id AS "projectId"
      FROM project_trigger_runs r JOIN project_triggers t ON t.trigger_id = r.trigger_id
      WHERE r.run_id = ${runId} LIMIT 1
    `,
  });

  const cleanupWebhookReceipts = SqlSchema.void({
    Request: WebhookReceiptCleanupInput,
    execute: ({ triggerId, now }) => sql`
      DELETE FROM project_trigger_webhook_receipts
      WHERE trigger_id = ${triggerId} AND expires_at <= ${now}
    `,
  });
  const getWebhookReceiptByIdempotency = SqlSchema.findOneOption({
    Request: WebhookReceiptLookupInput,
    Result: WebhookReceiptRow,
    execute: ({ triggerId, value }) => sql`
      SELECT run_id AS "runId", request_digest AS "requestDigest"
      FROM project_trigger_webhook_receipts
      WHERE trigger_id = ${triggerId} AND idempotency_key = ${value} LIMIT 1
    `,
  });
  const getWebhookReceiptByNonce = SqlSchema.findOneOption({
    Request: WebhookReceiptLookupInput,
    Result: WebhookReceiptRow,
    execute: ({ triggerId, value }) => sql`
      SELECT run_id AS "runId", request_digest AS "requestDigest"
      FROM project_trigger_webhook_receipts
      WHERE trigger_id = ${triggerId} AND nonce = ${value} LIMIT 1
    `,
  });
  const insertWebhookReceipt = SqlSchema.void({
    Request: WebhookReceiptInsertInput,
    execute: (row) => sql`
      INSERT INTO project_trigger_webhook_receipts (
        trigger_id, idempotency_key, nonce, request_digest, run_id, received_at, expires_at
      ) VALUES (
        ${row.triggerId}, ${row.idempotencyKey}, ${row.nonce}, ${row.requestDigest},
        ${row.runId}, ${row.receivedAt}, ${row.expiresAt}
      )
    `,
  });

  const emitTrigger = (row: ProjectTriggerRow) =>
    PubSub.publish(changes, {
      type: "triggerUpserted",
      triggerId: row.triggerId,
      projectId: row.projectId,
    }).pipe(Effect.asVoid);
  const emitTriggerById = (triggerId: ProjectTriggerRow["triggerId"]) =>
    getTriggerRowById({ triggerId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (row) => emitTrigger(toProjectTriggerRow(row)),
        }),
      ),
      Effect.ignoreCause({ log: true }),
    );
  const emitRunById = (runId: ProjectTriggerRunRow["runId"]) =>
    getRunProjectRefRow({ runId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (row) =>
            PubSub.publish(changes, { type: "runUpserted" as const, ...row }).pipe(Effect.asVoid),
        }),
      ),
      Effect.ignoreCause({ log: true }),
    );

  const upsertTrigger: ProjectTriggerRepositoryShape["upsertTrigger"] = (row) =>
    upsertTriggerRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.upsertTrigger:query")),
      Effect.tap(() => emitTrigger(row)),
    );
  const getTriggerById: ProjectTriggerRepositoryShape["getTriggerById"] = (input) =>
    getTriggerRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.getTriggerById:query")),
      Effect.map(Option.map(toProjectTriggerRow)),
    );
  const getTriggerByPublicId: ProjectTriggerRepositoryShape["getTriggerByPublicId"] = (input) =>
    getTriggerRowByPublicId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.getTriggerByPublicId:query")),
      Effect.map(Option.map(toProjectTriggerRow)),
    );
  const listTriggersByProjectId: ProjectTriggerRepositoryShape["listTriggersByProjectId"] = (
    input,
  ) =>
    listTriggerRowsByProject(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.listTriggersByProjectId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectTriggerRow)),
    );
  const deleteTrigger: ProjectTriggerRepositoryShape["deleteTrigger"] = (input) =>
    deleteTriggerRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.deleteTrigger:query")),
      Effect.tap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (row) =>
            PubSub.publish(changes, {
              type: "triggerDeleted",
              ...row,
              deletedAt: input.deletedAt,
            }).pipe(Effect.asVoid),
        }),
      ),
      Effect.map(Option.isSome),
    );
  const recoverExpiredTriggerClaims: ProjectTriggerRepositoryShape["recoverExpiredTriggerClaims"] =
    (input) =>
      recoverExpiredTriggerClaimRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectTriggerRepository.recoverExpiredTriggerClaims:query"),
        ),
        Effect.map((rows) => rows.length),
      );
  const claimDueTriggers: ProjectTriggerRepositoryShape["claimDueTriggers"] = (input) =>
    claimDueTriggerRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.claimDueTriggers:query")),
      Effect.map((rows) => rows.map(toProjectTriggerRow)),
    );
  const scheduleRunForClaimedTrigger: ProjectTriggerRepositoryShape["scheduleRunForClaimedTrigger"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const claimed = yield* markTriggerScheduledRow(input);
            if (Option.isNone(claimed)) return false;
            yield* insertRunRow(input.run);
            return true;
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "ProjectTriggerRepository.scheduleRunForClaimedTrigger:transaction",
            ),
          ),
          Effect.tap((scheduled) =>
            scheduled
              ? Effect.all([emitTriggerById(input.triggerId), emitRunById(input.run.runId)], {
                  discard: true,
                }).pipe(Effect.ignore)
              : Effect.void,
          ),
        );
  const insertRun: ProjectTriggerRepositoryShape["insertRun"] = (row) =>
    insertRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.insertRun:query")),
      Effect.tap((inserted) => (Option.isSome(inserted) ? emitRunById(row.runId) : Effect.void)),
      Effect.map(Option.isSome),
    );
  const markTriggerScheduleFailed: ProjectTriggerRepositoryShape["markTriggerScheduleFailed"] = (
    input,
  ) =>
    markTriggerScheduleFailedRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.markTriggerScheduleFailed:query"),
      ),
      Effect.map(Option.isSome),
    );
  const getRunById: ProjectTriggerRepositoryShape["getRunById"] = (input) =>
    getRunRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.getRunById:query")),
      Effect.map(Option.map(toProjectTriggerRunRow)),
    );
  const getRunByThreadId: ProjectTriggerRepositoryShape["getRunByThreadId"] = (input) =>
    getRunRowByThreadId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.getRunByThreadId:query")),
      Effect.map(Option.map(toProjectTriggerRunRow)),
    );
  const getRunByIdempotencyKey: ProjectTriggerRepositoryShape["getRunByIdempotencyKey"] = (input) =>
    getRunRowByIdempotency(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.getRunByIdempotencyKey:query"),
      ),
      Effect.map(Option.map(toProjectTriggerRunRow)),
    );
  const listRunsByTriggerId: ProjectTriggerRepositoryShape["listRunsByTriggerId"] = (input) =>
    listRunRowsByTrigger(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.listRunsByTriggerId:query")),
      Effect.map((rows) => rows.map(toProjectTriggerRunRow)),
    );
  const listActiveRuns: ProjectTriggerRepositoryShape["listActiveRuns"] = (input) =>
    listActiveRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.listActiveRuns:query")),
      Effect.map((rows) => rows.map(toProjectTriggerRunRow)),
    );
  const recoverExpiredRunClaims: ProjectTriggerRepositoryShape["recoverExpiredRunClaims"] = (
    input,
  ) =>
    recoverExpiredRunClaimRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.recoverExpiredRunClaims:query"),
      ),
      Effect.tap((rows) =>
        Effect.forEach(rows, (row) => emitRunById(row.runId), { discard: true }),
      ),
      Effect.map((rows) => rows.length),
    );
  const claimDueRuns: ProjectTriggerRepositoryShape["claimDueRuns"] = (input) =>
    claimDueRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.claimDueRuns:query")),
      Effect.tap((rows) =>
        Effect.forEach(rows, (row) => emitRunById(row.runId), { discard: true }),
      ),
      Effect.map((rows) => rows.map(toProjectTriggerRunRow)),
    );
  const booleanRunMutation = <A>(
    effect: Effect.Effect<Option.Option<{ readonly runId: ProjectTriggerRunRow["runId"] }>, A>,
    context: string,
  ) =>
    effect.pipe(
      Effect.mapError(toPersistenceSqlError(context)),
      Effect.tap((row) => (Option.isSome(row) ? emitRunById(row.value.runId) : Effect.void)),
      Effect.map(Option.isSome),
    );
  const markRunStarting: ProjectTriggerRepositoryShape["markRunStarting"] = (input) =>
    booleanRunMutation(markRunStartingRow(input), "ProjectTriggerRepository.markRunStarting:query");
  const markRunRunning: ProjectTriggerRepositoryShape["markRunRunning"] = (input) =>
    booleanRunMutation(markRunRunningRow(input), "ProjectTriggerRepository.markRunRunning:query");
  const markRunSucceeded: ProjectTriggerRepositoryShape["markRunSucceeded"] = (input) =>
    booleanRunMutation(
      markRunSucceededRow(input),
      "ProjectTriggerRepository.markRunSucceeded:query",
    );
  const markRunFailed: ProjectTriggerRepositoryShape["markRunFailed"] = (input) =>
    booleanRunMutation(markRunFailedRow(input), "ProjectTriggerRepository.markRunFailed:query");
  const markRunCancelled: ProjectTriggerRepositoryShape["markRunCancelled"] = (input) =>
    booleanRunMutation(
      markRunCancelledRow(input),
      "ProjectTriggerRepository.markRunCancelled:query",
    );
  const settleRunByThread: ProjectTriggerRepositoryShape["settleRunByThread"] = (input) =>
    booleanRunMutation(
      settleRunByThreadRow(input),
      "ProjectTriggerRepository.settleRunByThread:query",
    );
  const rotateWebhookSecretVersion: ProjectTriggerRepositoryShape["rotateWebhookSecretVersion"] = (
    input,
  ) =>
    rotateWebhookSecretVersionRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.rotateWebhookSecretVersion:query"),
      ),
      Effect.tap((updated) =>
        Option.isSome(updated) ? emitTriggerById(input.triggerId) : Effect.void,
      ),
      Effect.map(Option.map((row) => row.version)),
    );
  const acceptWebhookRun: ProjectTriggerRepositoryShape["acceptWebhookRun"] = (
    input: AcceptProjectTriggerWebhookRunInput,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* cleanupWebhookReceipts({ triggerId: input.run.triggerId, now: input.receivedAt });
          const existingReceipt = yield* getWebhookReceiptByIdempotency({
            triggerId: input.run.triggerId,
            value: input.run.idempotencyKey,
          });
          if (Option.isSome(existingReceipt)) {
            if (existingReceipt.value.requestDigest !== input.requestDigest) {
              return { outcome: "idempotency-conflict" as const };
            }
            const existingRun = yield* getRunRowById({ runId: existingReceipt.value.runId });
            return Option.isSome(existingRun)
              ? { outcome: "existing" as const, run: toProjectTriggerRunRow(existingRun.value) }
              : { outcome: "idempotency-conflict" as const };
          }
          const existingRun = yield* getRunRowByIdempotency({
            triggerId: input.run.triggerId,
            idempotencyKey: input.run.idempotencyKey,
          });
          if (
            Option.isSome(existingRun) &&
            existingRun.value.requestDigest !== input.requestDigest
          ) {
            return { outcome: "idempotency-conflict" as const };
          }
          const nonceReceipt = yield* getWebhookReceiptByNonce({
            triggerId: input.run.triggerId,
            value: input.nonce,
          });
          if (Option.isSome(nonceReceipt)) return { outcome: "replay" as const };
          if (Option.isSome(existingRun)) {
            yield* insertWebhookReceipt({
              triggerId: input.run.triggerId,
              idempotencyKey: input.run.idempotencyKey,
              nonce: input.nonce,
              requestDigest: input.requestDigest,
              runId: existingRun.value.runId,
              receivedAt: input.receivedAt,
              expiresAt: input.expiresAt,
            });
            return { outcome: "existing" as const, run: toProjectTriggerRunRow(existingRun.value) };
          }
          const inserted = yield* insertRunRow(input.run);
          if (Option.isNone(inserted)) return { outcome: "idempotency-conflict" as const };
          yield* insertWebhookReceipt({
            triggerId: input.run.triggerId,
            idempotencyKey: input.run.idempotencyKey,
            nonce: input.nonce,
            requestDigest: input.requestDigest,
            runId: input.run.runId,
            receivedAt: input.receivedAt,
            expiresAt: input.expiresAt,
          });
          return { outcome: "inserted" as const, run: input.run };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectTriggerRepository.acceptWebhookRun:transaction"),
        ),
        Effect.tap((result) =>
          result.outcome === "inserted" ? emitRunById(result.run.runId) : Effect.void,
        ),
      );

  const recordWebhookOperation: ProjectTriggerRepositoryShape["recordWebhookOperation"] = (
    input: RecordProjectTriggerWebhookOperationInput,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* cleanupWebhookReceipts({ triggerId: input.triggerId, now: input.receivedAt });
          const existingReceipt = yield* getWebhookReceiptByIdempotency({
            triggerId: input.triggerId,
            value: input.idempotencyKey,
          });
          if (Option.isSome(existingReceipt)) {
            return existingReceipt.value.requestDigest === input.requestDigest
              ? ({ outcome: "existing" } as const)
              : ({ outcome: "idempotency-conflict" } as const);
          }
          const nonceReceipt = yield* getWebhookReceiptByNonce({
            triggerId: input.triggerId,
            value: input.nonce,
          });
          if (Option.isSome(nonceReceipt)) return { outcome: "replay" as const };
          yield* insertWebhookReceipt(input);
          return { outcome: "inserted" as const };
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectTriggerRepository.recordWebhookOperation:transaction"),
        ),
      );

  return {
    upsertTrigger,
    getTriggerById,
    getTriggerByPublicId,
    listTriggersByProjectId,
    deleteTrigger,
    recoverExpiredTriggerClaims,
    claimDueTriggers,
    scheduleRunForClaimedTrigger,
    insertRun,
    markTriggerScheduleFailed,
    getRunById,
    getRunByThreadId,
    getRunByIdempotencyKey,
    listRunsByTriggerId,
    listActiveRuns,
    recoverExpiredRunClaims,
    claimDueRuns,
    markRunStarting,
    markRunRunning,
    markRunSucceeded,
    markRunFailed,
    markRunCancelled,
    settleRunByThread,
    rotateWebhookSecretVersion,
    acceptWebhookRun,
    recordWebhookOperation,
    subscribeChanges: PubSub.subscribe(changes),
  } satisfies ProjectTriggerRepositoryShape;
});

export const ProjectTriggerRepositoryLive = Layer.effect(
  ProjectTriggerRepository,
  makeProjectTriggerRepository,
);
