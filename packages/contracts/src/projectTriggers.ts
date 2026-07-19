import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProjectTriggerId,
  ProjectTriggerRunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  TriggerEventKind,
} from "./orchestration.ts";

const PROJECT_TRIGGER_NAME_MAX_LENGTH = 160;
const PROJECT_TRIGGER_DESCRIPTION_MAX_LENGTH = 2_000;
const PROJECT_TRIGGER_CRON_EXPRESSION_MAX_LENGTH = 256;
const PROJECT_TRIGGER_TIMEZONE_MAX_LENGTH = 128;
const PROJECT_TRIGGER_PROMPT_MAX_LENGTH = 120_000;
const PROJECT_TRIGGER_LIST_RUNS_MAX_LIMIT = 100;
const PROJECT_TRIGGER_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const PROJECT_TRIGGER_CANCELLATION_REASON_MAX_LENGTH = 2_000;

export const PROJECT_TRIGGER_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export const ProjectTriggerRuntimeTarget = Schema.Literals(["local", "remote"]);
export type ProjectTriggerRuntimeTarget = typeof ProjectTriggerRuntimeTarget.Type;

/**
 * Cron timing is owned by the selected runtime. Browser clients may create or
 * update this record, but they must not schedule cron timers themselves. A
 * local cron runs on the local runtime; a remote cron runs on the remote runtime.
 */
export const ProjectTriggerCronSchedule = Schema.Struct({
  kind: Schema.Literal("cron"),
  expression: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_TRIGGER_CRON_EXPRESSION_MAX_LENGTH),
  ),
  timezone: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_TIMEZONE_MAX_LENGTH)),
  ),
  runtime: ProjectTriggerRuntimeTarget,
});
export type ProjectTriggerCronSchedule = typeof ProjectTriggerCronSchedule.Type;

export const ProjectTriggerSchedule = Schema.Union([ProjectTriggerCronSchedule]);
export type ProjectTriggerSchedule = typeof ProjectTriggerSchedule.Type;

/**
 * Template used by the runtime to create a fresh thread for every trigger fire.
 */
export const ProjectTriggerThreadTemplate = Schema.Struct({
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_PROMPT_MAX_LENGTH)),
  titleSeed: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_NAME_MAX_LENGTH)),
  ),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
  branch: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProjectTriggerThreadTemplate = typeof ProjectTriggerThreadTemplate.Type;

export const ProjectTriggerRunStatus = Schema.Literals([
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type ProjectTriggerRunStatus = typeof ProjectTriggerRunStatus.Type;

export const ProjectTriggerWebhookDescriptor = Schema.Struct({
  publicId: TrimmedNonEmptyString,
  configured: Schema.Boolean,
  endpointPath: TrimmedNonEmptyString,
  secretVersion: NonNegativeInt,
});
export type ProjectTriggerWebhookDescriptor = typeof ProjectTriggerWebhookDescriptor.Type;

export const ProjectTriggerRecord = Schema.Struct({
  id: ProjectTriggerId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_NAME_MAX_LENGTH)),
  description: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_DESCRIPTION_MAX_LENGTH)),
  ),
  enabled: Schema.Boolean,
  schedule: ProjectTriggerSchedule,
  threadTemplate: ProjectTriggerThreadTemplate,
  webhook: ProjectTriggerWebhookDescriptor,
  lastRunId: Schema.NullOr(ProjectTriggerRunId),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastRunStatus: Schema.NullOr(ProjectTriggerRunStatus),
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectTriggerRecord = typeof ProjectTriggerRecord.Type;

export const ProjectTriggerRunInitiator = Schema.Literals(["manual", "cron", "webhook", "retry"]);
export type ProjectTriggerRunInitiator = typeof ProjectTriggerRunInitiator.Type;

export const ProjectTriggerRunErrorPayload = Schema.Struct({
  message: TrimmedNonEmptyString,
  code: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectTriggerRunErrorPayload = typeof ProjectTriggerRunErrorPayload.Type;

export const ProjectTriggerRunRecord = Schema.Struct({
  id: ProjectTriggerRunId,
  triggerId: ProjectTriggerId,
  projectId: ProjectId,
  initiator: ProjectTriggerRunInitiator,
  status: ProjectTriggerRunStatus,
  commandId: CommandId,
  threadId: Schema.NullOr(ThreadId),
  eventKind: Schema.NullOr(TriggerEventKind),
  idempotencyKey: Schema.NullOr(TrimmedNonEmptyString),
  retryOfRunId: Schema.NullOr(ProjectTriggerRunId),
  scheduledFor: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  failureReason: Schema.NullOr(TrimmedNonEmptyString),
  cancellationReason: Schema.NullOr(TrimmedNonEmptyString),
  error: Schema.NullOr(ProjectTriggerRunErrorPayload),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectTriggerRunRecord = typeof ProjectTriggerRunRecord.Type;

export const ProjectTriggerListInput = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectTriggerListInput = typeof ProjectTriggerListInput.Type;

export const ProjectTriggerListResult = Schema.Struct({
  triggers: Schema.Array(ProjectTriggerRecord),
});
export type ProjectTriggerListResult = typeof ProjectTriggerListResult.Type;

export const ProjectTriggerGetInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});
export type ProjectTriggerGetInput = typeof ProjectTriggerGetInput.Type;

export const ProjectTriggerGetResult = Schema.Struct({
  trigger: ProjectTriggerRecord,
});
export type ProjectTriggerGetResult = typeof ProjectTriggerGetResult.Type;

export const ProjectTriggerCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_NAME_MAX_LENGTH)),
  description: Schema.optionalKey(
    Schema.NullOr(
      TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_DESCRIPTION_MAX_LENGTH)),
    ),
  ),
  enabled: Schema.optionalKey(Schema.Boolean),
  schedule: ProjectTriggerSchedule,
  threadTemplate: ProjectTriggerThreadTemplate,
});
export type ProjectTriggerCreateInput = typeof ProjectTriggerCreateInput.Type;

export const ProjectTriggerCreateResult = Schema.Struct({
  trigger: ProjectTriggerRecord,
});
export type ProjectTriggerCreateResult = typeof ProjectTriggerCreateResult.Type;

export const ProjectTriggerUpdatePatch = Schema.Struct({
  name: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_NAME_MAX_LENGTH)),
  ),
  description: Schema.optionalKey(
    Schema.NullOr(
      TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_DESCRIPTION_MAX_LENGTH)),
    ),
  ),
  enabled: Schema.optionalKey(Schema.Boolean),
  schedule: Schema.optionalKey(ProjectTriggerSchedule),
  threadTemplate: Schema.optionalKey(ProjectTriggerThreadTemplate),
});
export type ProjectTriggerUpdatePatch = typeof ProjectTriggerUpdatePatch.Type;

export const ProjectTriggerUpdateInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  patch: ProjectTriggerUpdatePatch,
});
export type ProjectTriggerUpdateInput = typeof ProjectTriggerUpdateInput.Type;

export const ProjectTriggerUpdateResult = Schema.Struct({
  trigger: ProjectTriggerRecord,
});
export type ProjectTriggerUpdateResult = typeof ProjectTriggerUpdateResult.Type;

export const ProjectTriggerDeleteInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});
export type ProjectTriggerDeleteInput = typeof ProjectTriggerDeleteInput.Type;

export const ProjectTriggerDeleteResult = Schema.Struct({
  projectId: ProjectId,
  triggerId: ProjectTriggerId,
  deletedAt: IsoDateTime,
});
export type ProjectTriggerDeleteResult = typeof ProjectTriggerDeleteResult.Type;

export const ProjectTriggerFireInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  idempotencyKey: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_IDEMPOTENCY_KEY_MAX_LENGTH)),
  ),
});
export type ProjectTriggerFireInput = typeof ProjectTriggerFireInput.Type;

export const ProjectTriggerFireResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
  threadId: ThreadId,
});
export type ProjectTriggerFireResult = typeof ProjectTriggerFireResult.Type;

export const ProjectTriggerGetRunInput = Schema.Struct({
  runId: ProjectTriggerRunId,
});
export type ProjectTriggerGetRunInput = typeof ProjectTriggerGetRunInput.Type;

export const ProjectTriggerGetRunResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
});
export type ProjectTriggerGetRunResult = typeof ProjectTriggerGetRunResult.Type;

export const ProjectTriggerCancelRunInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  reason: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_CANCELLATION_REASON_MAX_LENGTH)),
  ),
});
export type ProjectTriggerCancelRunInput = typeof ProjectTriggerCancelRunInput.Type;

export const ProjectTriggerCancelRunResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
});
export type ProjectTriggerCancelRunResult = typeof ProjectTriggerCancelRunResult.Type;

export const ProjectTriggerRetryRunInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  idempotencyKey: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TRIGGER_IDEMPOTENCY_KEY_MAX_LENGTH)),
  ),
});
export type ProjectTriggerRetryRunInput = typeof ProjectTriggerRetryRunInput.Type;

export const ProjectTriggerRetryRunResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
  threadId: ThreadId,
});
export type ProjectTriggerRetryRunResult = typeof ProjectTriggerRetryRunResult.Type;

export const ProjectTriggerRotateWebhookSecretInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});
export type ProjectTriggerRotateWebhookSecretInput =
  typeof ProjectTriggerRotateWebhookSecretInput.Type;

export const ProjectTriggerWebhookCredentials = Schema.Struct({
  triggerId: ProjectTriggerId,
  publicId: TrimmedNonEmptyString,
  endpointPath: TrimmedNonEmptyString,
  secret: TrimmedNonEmptyString,
  secretVersion: PositiveInt,
  algorithm: Schema.Literal("hmac-sha256"),
  signatureHeader: Schema.Literal("x-kamicode-signature"),
  timestampHeader: Schema.Literal("x-kamicode-timestamp"),
  nonceHeader: Schema.Literal("x-kamicode-nonce"),
  idempotencyHeader: Schema.Literal("idempotency-key"),
});
export type ProjectTriggerWebhookCredentials = typeof ProjectTriggerWebhookCredentials.Type;

export const ProjectTriggerRotateWebhookSecretResult = Schema.Struct({
  credentials: ProjectTriggerWebhookCredentials,
});
export type ProjectTriggerRotateWebhookSecretResult =
  typeof ProjectTriggerRotateWebhookSecretResult.Type;

export const ProjectTriggerWebhookEventInput = Schema.Struct({
  eventKind: Schema.optionalKey(TriggerEventKind),
  occurredAt: Schema.optionalKey(IsoDateTime),
  payload: Schema.optionalKey(Schema.Json),
});
export type ProjectTriggerWebhookEventInput = typeof ProjectTriggerWebhookEventInput.Type;

export const ProjectTriggerRunCorrelation = Schema.Struct({
  runId: ProjectTriggerRunId,
  threadId: ThreadId,
  threadPath: TrimmedNonEmptyString,
  statusPath: TrimmedNonEmptyString,
});
export type ProjectTriggerRunCorrelation = typeof ProjectTriggerRunCorrelation.Type;

export const ProjectTriggerWebhookRunResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
  correlation: ProjectTriggerRunCorrelation,
  idempotentReplay: Schema.Boolean,
});
export type ProjectTriggerWebhookRunResult = typeof ProjectTriggerWebhookRunResult.Type;

export const ProjectTriggerListRunsInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  limit: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_TRIGGER_LIST_RUNS_MAX_LIMIT)),
  ),
});
export type ProjectTriggerListRunsInput = typeof ProjectTriggerListRunsInput.Type;

export const ProjectTriggerListRunsResult = Schema.Struct({
  runs: Schema.Array(ProjectTriggerRunRecord),
});
export type ProjectTriggerListRunsResult = typeof ProjectTriggerListRunsResult.Type;

export const ProjectTriggerSubscribeInput = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectTriggerSubscribeInput = typeof ProjectTriggerSubscribeInput.Type;

const ProjectTriggerStreamEventBase = {
  projectId: ProjectId,
  sequence: NonNegativeInt,
  emittedAt: IsoDateTime,
} as const;

export const ProjectTriggerStreamEvent = Schema.Union([
  Schema.Struct({
    ...ProjectTriggerStreamEventBase,
    type: Schema.Literal("snapshot"),
    triggers: Schema.Array(ProjectTriggerRecord),
    activeRuns: Schema.Array(ProjectTriggerRunRecord),
  }),
  Schema.Struct({
    ...ProjectTriggerStreamEventBase,
    type: Schema.Literal("triggerUpserted"),
    trigger: ProjectTriggerRecord,
  }),
  Schema.Struct({
    ...ProjectTriggerStreamEventBase,
    type: Schema.Literal("triggerDeleted"),
    triggerId: ProjectTriggerId,
    deletedAt: IsoDateTime,
  }),
  Schema.Struct({
    ...ProjectTriggerStreamEventBase,
    type: Schema.Literal("runUpserted"),
    run: ProjectTriggerRunRecord,
  }),
]);
export type ProjectTriggerStreamEvent = typeof ProjectTriggerStreamEvent.Type;

export class ProjectTriggerNotFoundError extends Schema.TaggedErrorClass<ProjectTriggerNotFoundError>()(
  "ProjectTriggerNotFoundError",
  {
    triggerId: ProjectTriggerId,
  },
) {
  override get message(): string {
    return `Project trigger not found: ${this.triggerId}`;
  }
}

export class ProjectTriggerValidationError extends Schema.TaggedErrorClass<ProjectTriggerValidationError>()(
  "ProjectTriggerValidationError",
  {
    message: TrimmedNonEmptyString,
    field: Schema.optionalKey(TrimmedNonEmptyString),
  },
) {}

export class ProjectTriggerStoreError extends Schema.TaggedErrorClass<ProjectTriggerStoreError>()(
  "ProjectTriggerStoreError",
  {
    operation: Schema.Literals([
      "list",
      "get",
      "create",
      "update",
      "delete",
      "fire",
      "getRun",
      "cancelRun",
      "retryRun",
      "rotateWebhookSecret",
      "listRuns",
      "subscribe",
    ]),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class ProjectTriggerFireError extends Schema.TaggedErrorClass<ProjectTriggerFireError>()(
  "ProjectTriggerFireError",
  {
    triggerId: ProjectTriggerId,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class ProjectTriggerRunNotFoundError extends Schema.TaggedErrorClass<ProjectTriggerRunNotFoundError>()(
  "ProjectTriggerRunNotFoundError",
  {
    runId: ProjectTriggerRunId,
  },
) {
  override get message(): string {
    return `Project trigger run not found: ${this.runId}`;
  }
}

export const ProjectTriggerError = Schema.Union([
  ProjectTriggerNotFoundError,
  ProjectTriggerValidationError,
  ProjectTriggerStoreError,
  ProjectTriggerFireError,
  ProjectTriggerRunNotFoundError,
]);
export type ProjectTriggerError = typeof ProjectTriggerError.Type;
