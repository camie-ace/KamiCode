import { ChatAttachment, ModelSelection, ThreadTurnStartCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  ClaimDueProjectTriggerRunsInput,
  ClaimDueProjectTriggersInput,
  DeleteProjectTriggerInput,
  ListProjectTriggerRunsByTriggerInput,
  ListProjectTriggersByProjectInput,
  MarkProjectTriggerRunDispatchedInput,
  MarkProjectTriggerRunFailedInput,
  MarkProjectTriggerRunSkippedInput,
  MarkProjectTriggerScheduleFailedInput,
  ProjectTriggerBootstrap,
  ProjectTriggerIdInput,
  ProjectTriggerRepository,
  ProjectTriggerRow,
  ProjectTriggerRunIdInput,
  ProjectTriggerRunRow,
  RecoverExpiredProjectTriggerClaimsInput,
  ScheduleProjectTriggerRunInput,
  UpsertProjectTriggerInput,
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
    command: Schema.fromJsonString(ThreadTurnStartCommand),
  }),
);

const TriggerIdRow = Schema.Struct({
  triggerId: ProjectTriggerRow.fields.triggerId,
});

const RunIdRow = Schema.Struct({
  runId: ProjectTriggerRunRow.fields.runId,
});

function toProjectTriggerRow(
  row: Schema.Schema.Type<typeof ProjectTriggerDbRow>,
): ProjectTriggerRow {
  return {
    ...row,
    enabled: row.enabled === 1,
  };
}

function toProjectTriggerRunRow(
  row: Schema.Schema.Type<typeof ProjectTriggerRunDbRow>,
): ProjectTriggerRunRow {
  return row;
}

const makeProjectTriggerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertTriggerRow = SqlSchema.void({
    Request: UpsertProjectTriggerInput,
    execute: (row) =>
      sql`
        INSERT INTO project_triggers (
          trigger_id,
          project_id,
          name,
          enabled,
          schedule_kind,
          schedule_cron,
          schedule_once_at,
          timezone,
          next_fire_at,
          last_fire_at,
          prompt,
          attachments_json,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          dispatch_policy,
          title_seed,
          bootstrap_json,
          created_at,
          updated_at,
          deleted_at,
          schedule_claimed_at,
          schedule_claim_expires_at,
          failure_detail
        )
        VALUES (
          ${row.triggerId},
          ${row.projectId},
          ${row.name},
          ${row.enabled ? 1 : 0},
          ${row.scheduleKind},
          ${row.scheduleCron},
          ${row.scheduleOnceAt},
          ${row.timezone},
          ${row.nextFireAt},
          ${row.lastFireAt},
          ${row.prompt},
          ${JSON.stringify(row.attachments)},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.dispatchPolicy},
          ${row.titleSeed},
          ${row.bootstrap === null ? null : JSON.stringify(row.bootstrap)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt},
          ${row.scheduleClaimedAt},
          ${row.scheduleClaimExpiresAt},
          ${row.failureDetail}
        )
        ON CONFLICT (trigger_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          enabled = excluded.enabled,
          schedule_kind = excluded.schedule_kind,
          schedule_cron = excluded.schedule_cron,
          schedule_once_at = excluded.schedule_once_at,
          timezone = excluded.timezone,
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

  const getTriggerRowById = SqlSchema.findOneOption({
    Request: ProjectTriggerIdInput,
    Result: ProjectTriggerDbRow,
    execute: ({ triggerId }) =>
      sql`
        SELECT
          trigger_id AS "triggerId",
          project_id AS "projectId",
          name,
          enabled,
          schedule_kind AS "scheduleKind",
          schedule_cron AS "scheduleCron",
          schedule_once_at AS "scheduleOnceAt",
          timezone,
          next_fire_at AS "nextFireAt",
          last_fire_at AS "lastFireAt",
          prompt,
          attachments_json AS "attachments",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          dispatch_policy AS "dispatchPolicy",
          title_seed AS "titleSeed",
          bootstrap_json AS "bootstrap",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          schedule_claimed_at AS "scheduleClaimedAt",
          schedule_claim_expires_at AS "scheduleClaimExpiresAt",
          failure_detail AS "failureDetail"
        FROM project_triggers
        WHERE trigger_id = ${triggerId}
        LIMIT 1
      `,
  });

  const listTriggerRowsByProject = SqlSchema.findAll({
    Request: ListProjectTriggersByProjectInput,
    Result: ProjectTriggerDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          trigger_id AS "triggerId",
          project_id AS "projectId",
          name,
          enabled,
          schedule_kind AS "scheduleKind",
          schedule_cron AS "scheduleCron",
          schedule_once_at AS "scheduleOnceAt",
          timezone,
          next_fire_at AS "nextFireAt",
          last_fire_at AS "lastFireAt",
          prompt,
          attachments_json AS "attachments",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          dispatch_policy AS "dispatchPolicy",
          title_seed AS "titleSeed",
          bootstrap_json AS "bootstrap",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          schedule_claimed_at AS "scheduleClaimedAt",
          schedule_claim_expires_at AS "scheduleClaimExpiresAt",
          failure_detail AS "failureDetail"
        FROM project_triggers
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY name ASC, trigger_id ASC
      `,
  });

  const deleteTriggerRow = SqlSchema.findOneOption({
    Request: DeleteProjectTriggerInput,
    Result: TriggerIdRow,
    execute: ({ triggerId, deletedAt }) =>
      sql`
        UPDATE project_triggers
        SET enabled = 0,
            next_fire_at = NULL,
            schedule_claimed_at = NULL,
            schedule_claim_expires_at = NULL,
            deleted_at = ${deletedAt},
            updated_at = ${deletedAt}
        WHERE trigger_id = ${triggerId}
          AND deleted_at IS NULL
        RETURNING trigger_id AS "triggerId"
      `,
  });

  const recoverExpiredTriggerClaimRows = SqlSchema.findAll({
    Request: RecoverExpiredProjectTriggerClaimsInput,
    Result: TriggerIdRow,
    execute: ({ now }) =>
      sql`
        UPDATE project_triggers
        SET schedule_claimed_at = NULL,
            schedule_claim_expires_at = NULL
        WHERE schedule_claim_expires_at IS NOT NULL
          AND schedule_claim_expires_at <= ${now}
        RETURNING trigger_id AS "triggerId"
      `,
  });

  const claimDueTriggerRows = SqlSchema.findAll({
    Request: ClaimDueProjectTriggersInput,
    Result: ProjectTriggerDbRow,
    execute: ({ now, claimExpiresAt, limit }) =>
      sql`
        UPDATE project_triggers
        SET schedule_claimed_at = ${now},
            schedule_claim_expires_at = ${claimExpiresAt}
        WHERE trigger_id IN (
          SELECT trigger_id
          FROM project_triggers
          WHERE enabled = 1
            AND deleted_at IS NULL
            AND next_fire_at IS NOT NULL
            AND next_fire_at <= ${now}
            AND (
              schedule_claim_expires_at IS NULL
              OR schedule_claim_expires_at <= ${now}
            )
          ORDER BY next_fire_at ASC, trigger_id ASC
          LIMIT ${limit}
        )
        RETURNING
          trigger_id AS "triggerId",
          project_id AS "projectId",
          name,
          enabled,
          schedule_kind AS "scheduleKind",
          schedule_cron AS "scheduleCron",
          schedule_once_at AS "scheduleOnceAt",
          timezone,
          next_fire_at AS "nextFireAt",
          last_fire_at AS "lastFireAt",
          prompt,
          attachments_json AS "attachments",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          dispatch_policy AS "dispatchPolicy",
          title_seed AS "titleSeed",
          bootstrap_json AS "bootstrap",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          schedule_claimed_at AS "scheduleClaimedAt",
          schedule_claim_expires_at AS "scheduleClaimExpiresAt",
          failure_detail AS "failureDetail"
      `,
  });

  const insertRunRow = SqlSchema.findOneOption({
    Request: ProjectTriggerRunRow,
    Result: RunIdRow,
    execute: (row) =>
      sql`
        INSERT INTO project_trigger_runs (
          run_id,
          trigger_id,
          status,
          fire_at,
          queued_at,
          claimed_at,
          claim_expires_at,
          dispatched_at,
          completed_at,
          command_id,
          thread_id,
          message_id,
          command_json,
          result_sequence,
          failure_detail,
          skip_reason
        )
        VALUES (
          ${row.runId},
          ${row.triggerId},
          ${row.status},
          ${row.fireAt},
          ${row.queuedAt},
          ${row.claimedAt},
          ${row.claimExpiresAt},
          ${row.dispatchedAt},
          ${row.completedAt},
          ${row.commandId},
          ${row.threadId},
          ${row.messageId},
          ${JSON.stringify(row.command)},
          ${row.resultSequence},
          ${row.failureDetail},
          ${row.skipReason}
        )
        ON CONFLICT (run_id)
        DO NOTHING
        RETURNING run_id AS "runId"
      `,
  });

  const markTriggerScheduledRow = SqlSchema.findOneOption({
    Request: ScheduleProjectTriggerRunInput,
    Result: TriggerIdRow,
    execute: ({ triggerId, claimedAt, fireAt, scheduledAt, nextFireAt }) =>
      sql`
        UPDATE project_triggers
        SET last_fire_at = ${fireAt},
            next_fire_at = ${nextFireAt},
            schedule_claimed_at = NULL,
            schedule_claim_expires_at = NULL,
            failure_detail = NULL,
            updated_at = ${scheduledAt}
        WHERE trigger_id = ${triggerId}
          AND schedule_claimed_at = ${claimedAt}
        RETURNING trigger_id AS "triggerId"
      `,
  });

  const markTriggerScheduleFailedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerScheduleFailedInput,
    Result: TriggerIdRow,
    execute: ({ triggerId, claimedAt, failedAt, failureDetail }) =>
      sql`
        UPDATE project_triggers
        SET next_fire_at = NULL,
            schedule_claimed_at = NULL,
            schedule_claim_expires_at = NULL,
            failure_detail = ${failureDetail},
            updated_at = ${failedAt}
        WHERE trigger_id = ${triggerId}
          AND schedule_claimed_at = ${claimedAt}
        RETURNING trigger_id AS "triggerId"
      `,
  });

  const getRunRowById = SqlSchema.findOneOption({
    Request: ProjectTriggerRunIdInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          trigger_id AS "triggerId",
          status,
          fire_at AS "fireAt",
          queued_at AS "queuedAt",
          claimed_at AS "claimedAt",
          claim_expires_at AS "claimExpiresAt",
          dispatched_at AS "dispatchedAt",
          completed_at AS "completedAt",
          command_id AS "commandId",
          thread_id AS "threadId",
          message_id AS "messageId",
          command_json AS "command",
          result_sequence AS "resultSequence",
          failure_detail AS "failureDetail",
          skip_reason AS "skipReason"
        FROM project_trigger_runs
        WHERE run_id = ${runId}
        LIMIT 1
      `,
  });

  const listRunRowsByTrigger = SqlSchema.findAll({
    Request: ListProjectTriggerRunsByTriggerInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ triggerId, limit }) =>
      sql`
        SELECT
          run_id AS "runId",
          trigger_id AS "triggerId",
          status,
          fire_at AS "fireAt",
          queued_at AS "queuedAt",
          claimed_at AS "claimedAt",
          claim_expires_at AS "claimExpiresAt",
          dispatched_at AS "dispatchedAt",
          completed_at AS "completedAt",
          command_id AS "commandId",
          thread_id AS "threadId",
          message_id AS "messageId",
          command_json AS "command",
          result_sequence AS "resultSequence",
          failure_detail AS "failureDetail",
          skip_reason AS "skipReason"
        FROM project_trigger_runs
        WHERE trigger_id = ${triggerId}
        ORDER BY fire_at DESC, run_id DESC
        LIMIT ${limit}
      `,
  });

  const recoverExpiredRunClaimRows = SqlSchema.findAll({
    Request: RecoverExpiredProjectTriggerClaimsInput,
    Result: RunIdRow,
    execute: ({ now }) =>
      sql`
        UPDATE project_trigger_runs
        SET status = 'queued',
            claimed_at = NULL,
            claim_expires_at = NULL
        WHERE status = 'claimed'
          AND claim_expires_at IS NOT NULL
          AND claim_expires_at <= ${now}
        RETURNING run_id AS "runId"
      `,
  });

  const claimDueRunRows = SqlSchema.findAll({
    Request: ClaimDueProjectTriggerRunsInput,
    Result: ProjectTriggerRunDbRow,
    execute: ({ now, claimExpiresAt, limit }) =>
      sql`
        UPDATE project_trigger_runs
        SET status = 'claimed',
            claimed_at = ${now},
            claim_expires_at = ${claimExpiresAt}
        WHERE run_id IN (
          SELECT run_id
          FROM project_trigger_runs
          WHERE status = 'queued'
            AND fire_at <= ${now}
          ORDER BY fire_at ASC, run_id ASC
          LIMIT ${limit}
        )
          AND status = 'queued'
        RETURNING
          run_id AS "runId",
          trigger_id AS "triggerId",
          status,
          fire_at AS "fireAt",
          queued_at AS "queuedAt",
          claimed_at AS "claimedAt",
          claim_expires_at AS "claimExpiresAt",
          dispatched_at AS "dispatchedAt",
          completed_at AS "completedAt",
          command_id AS "commandId",
          thread_id AS "threadId",
          message_id AS "messageId",
          command_json AS "command",
          result_sequence AS "resultSequence",
          failure_detail AS "failureDetail",
          skip_reason AS "skipReason"
      `,
  });

  const markRunDispatchedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunDispatchedInput,
    Result: RunIdRow,
    execute: ({ runId, dispatchedAt, resultSequence }) =>
      sql`
        UPDATE project_trigger_runs
        SET status = 'dispatched',
            dispatched_at = ${dispatchedAt},
            completed_at = ${dispatchedAt},
            result_sequence = ${resultSequence},
            failure_detail = NULL,
            skip_reason = NULL
        WHERE run_id = ${runId}
          AND status = 'claimed'
        RETURNING run_id AS "runId"
      `,
  });

  const markRunFailedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunFailedInput,
    Result: RunIdRow,
    execute: ({ runId, failedAt, failureDetail }) =>
      sql`
        UPDATE project_trigger_runs
        SET status = 'failed',
            completed_at = ${failedAt},
            failure_detail = ${failureDetail}
        WHERE run_id = ${runId}
          AND status = 'claimed'
        RETURNING run_id AS "runId"
      `,
  });

  const markRunSkippedRow = SqlSchema.findOneOption({
    Request: MarkProjectTriggerRunSkippedInput,
    Result: RunIdRow,
    execute: ({ runId, skippedAt, skipReason }) =>
      sql`
        UPDATE project_trigger_runs
        SET status = 'skipped',
            completed_at = ${skippedAt},
            skip_reason = ${skipReason}
        WHERE run_id = ${runId}
          AND status = 'claimed'
        RETURNING run_id AS "runId"
      `,
  });

  const upsertTrigger: ProjectTriggerRepositoryShape["upsertTrigger"] = (row) =>
    upsertTriggerRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.upsertTrigger:query")),
    );

  const getTriggerById: ProjectTriggerRepositoryShape["getTriggerById"] = (input) =>
    getTriggerRowById(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.getTriggerById:query")),
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
            if (Option.isNone(claimed)) {
              return false;
            }
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
        );

  const insertRun: ProjectTriggerRepositoryShape["insertRun"] = (row) =>
    insertRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.insertRun:query")),
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

  const listRunsByTriggerId: ProjectTriggerRepositoryShape["listRunsByTriggerId"] = (input) =>
    listRunRowsByTrigger(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.listRunsByTriggerId:query")),
      Effect.map((rows) => rows.map(toProjectTriggerRunRow)),
    );

  const recoverExpiredRunClaims: ProjectTriggerRepositoryShape["recoverExpiredRunClaims"] = (
    input,
  ) =>
    recoverExpiredRunClaimRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectTriggerRepository.recoverExpiredRunClaims:query"),
      ),
      Effect.map((rows) => rows.length),
    );

  const claimDueRuns: ProjectTriggerRepositoryShape["claimDueRuns"] = (input) =>
    claimDueRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.claimDueRuns:query")),
      Effect.map((rows) => rows.map(toProjectTriggerRunRow)),
    );

  const markRunDispatched: ProjectTriggerRepositoryShape["markRunDispatched"] = (input) =>
    markRunDispatchedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.markRunDispatched:query")),
      Effect.map(Option.isSome),
    );

  const markRunFailed: ProjectTriggerRepositoryShape["markRunFailed"] = (input) =>
    markRunFailedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.markRunFailed:query")),
      Effect.map(Option.isSome),
    );

  const markRunSkipped: ProjectTriggerRepositoryShape["markRunSkipped"] = (input) =>
    markRunSkippedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectTriggerRepository.markRunSkipped:query")),
      Effect.map(Option.isSome),
    );

  return {
    upsertTrigger,
    getTriggerById,
    listTriggersByProjectId,
    deleteTrigger,
    recoverExpiredTriggerClaims,
    claimDueTriggers,
    scheduleRunForClaimedTrigger,
    insertRun,
    markTriggerScheduleFailed,
    getRunById,
    listRunsByTriggerId,
    recoverExpiredRunClaims,
    claimDueRuns,
    markRunDispatched,
    markRunFailed,
    markRunSkipped,
  } satisfies ProjectTriggerRepositoryShape;
});

export const ProjectTriggerRepositoryLive = Layer.effect(
  ProjectTriggerRepository,
  makeProjectTriggerRepository,
);
