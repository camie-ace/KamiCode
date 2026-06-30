import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProjectTriggerId,
  ProjectTriggerRunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";

const PROJECT_TRIGGER_NAME_MAX_LENGTH = 160;
const PROJECT_TRIGGER_DESCRIPTION_MAX_LENGTH = 2_000;
const PROJECT_TRIGGER_CRON_EXPRESSION_MAX_LENGTH = 256;
const PROJECT_TRIGGER_TIMEZONE_MAX_LENGTH = 128;
const PROJECT_TRIGGER_PROMPT_MAX_LENGTH = 120_000;
const PROJECT_TRIGGER_LIST_RUNS_MAX_LIMIT = 100;

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
  lastRunId: Schema.NullOr(ProjectTriggerRunId),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastRunStatus: Schema.NullOr(ProjectTriggerRunStatus),
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectTriggerRecord = typeof ProjectTriggerRecord.Type;

export const ProjectTriggerRunInitiator = Schema.Literals(["manual", "cron"]);
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
  threadId: Schema.NullOr(ThreadId),
  scheduledFor: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
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
});
export type ProjectTriggerFireInput = typeof ProjectTriggerFireInput.Type;

export const ProjectTriggerFireResult = Schema.Struct({
  run: ProjectTriggerRunRecord,
  threadId: ThreadId,
});
export type ProjectTriggerFireResult = typeof ProjectTriggerFireResult.Type;

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

export const ProjectTriggerError = Schema.Union([
  ProjectTriggerNotFoundError,
  ProjectTriggerValidationError,
  ProjectTriggerStoreError,
  ProjectTriggerFireError,
]);
export type ProjectTriggerError = typeof ProjectTriggerError.Type;
