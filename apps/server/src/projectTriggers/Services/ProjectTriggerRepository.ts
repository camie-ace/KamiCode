import {
  ChatAttachment,
  CommandId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  ProjectId,
  ProjectTriggerRuntimeTarget,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  ThreadTurnStartCommand,
  TrimmedNonEmptyString,
  TurnDispatchPolicy,
  PositiveInt,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const ProjectTriggerId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTriggerId"));
export type ProjectTriggerId = typeof ProjectTriggerId.Type;

export const ProjectTriggerRunId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTriggerRunId"));
export type ProjectTriggerRunId = typeof ProjectTriggerRunId.Type;

export const ProjectTriggerScheduleKind = Schema.Literals(["cron", "once", "manual"]);
export type ProjectTriggerScheduleKind = typeof ProjectTriggerScheduleKind.Type;

export const ProjectTriggerRunStatus = Schema.Literals([
  "queued",
  "claimed",
  "dispatched",
  "failed",
  "skipped",
]);
export type ProjectTriggerRunStatus = typeof ProjectTriggerRunStatus.Type;

export const ProjectTriggerBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ProjectTriggerBootstrapCreateThread = typeof ProjectTriggerBootstrapCreateThread.Type;

export const ProjectTriggerBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectTriggerBootstrapPrepareWorktree =
  typeof ProjectTriggerBootstrapPrepareWorktree.Type;

export const ProjectTriggerBootstrap = Schema.Struct({
  createThread: Schema.optional(ProjectTriggerBootstrapCreateThread),
  prepareWorktree: Schema.optional(ProjectTriggerBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});
export type ProjectTriggerBootstrap = typeof ProjectTriggerBootstrap.Type;

export type ProjectTriggerTurnStartCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;

export const ProjectTriggerRow = Schema.Struct({
  triggerId: ProjectTriggerId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  scheduleKind: ProjectTriggerScheduleKind,
  scheduleCron: Schema.NullOr(TrimmedNonEmptyString),
  scheduleOnceAt: Schema.NullOr(IsoDateTime),
  timezone: TrimmedNonEmptyString,
  runtimeTarget: ProjectTriggerRuntimeTarget,
  nextFireAt: Schema.NullOr(IsoDateTime),
  lastFireAt: Schema.NullOr(IsoDateTime),
  prompt: TrimmedNonEmptyString,
  attachments: Schema.Array(ChatAttachment),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  dispatchPolicy: Schema.NullOr(TurnDispatchPolicy),
  titleSeed: Schema.NullOr(TrimmedNonEmptyString),
  bootstrap: Schema.NullOr(ProjectTriggerBootstrap),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
  scheduleClaimedAt: Schema.NullOr(IsoDateTime),
  scheduleClaimExpiresAt: Schema.NullOr(IsoDateTime),
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectTriggerRow = typeof ProjectTriggerRow.Type;

export const ProjectTriggerRunRow = Schema.Struct({
  runId: ProjectTriggerRunId,
  triggerId: ProjectTriggerId,
  status: ProjectTriggerRunStatus,
  fireAt: IsoDateTime,
  queuedAt: IsoDateTime,
  claimedAt: Schema.NullOr(IsoDateTime),
  claimExpiresAt: Schema.NullOr(IsoDateTime),
  dispatchedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  command: ThreadTurnStartCommand,
  resultSequence: Schema.NullOr(Schema.Number),
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
  skipReason: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectTriggerRunRow = typeof ProjectTriggerRunRow.Type;

export const UpsertProjectTriggerInput = ProjectTriggerRow;
export type UpsertProjectTriggerInput = typeof UpsertProjectTriggerInput.Type;

export const ProjectTriggerIdInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});
export type ProjectTriggerIdInput = typeof ProjectTriggerIdInput.Type;

export const ProjectTriggerRunIdInput = Schema.Struct({
  runId: ProjectTriggerRunId,
});
export type ProjectTriggerRunIdInput = typeof ProjectTriggerRunIdInput.Type;

export const ListProjectTriggerRunsByTriggerInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  limit: PositiveInt,
});
export type ListProjectTriggerRunsByTriggerInput = typeof ListProjectTriggerRunsByTriggerInput.Type;

export const ListProjectTriggersByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectTriggersByProjectInput = typeof ListProjectTriggersByProjectInput.Type;

export const DeleteProjectTriggerInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  deletedAt: IsoDateTime,
});
export type DeleteProjectTriggerInput = typeof DeleteProjectTriggerInput.Type;

export const RecoverExpiredProjectTriggerClaimsInput = Schema.Struct({
  now: IsoDateTime,
});
export type RecoverExpiredProjectTriggerClaimsInput =
  typeof RecoverExpiredProjectTriggerClaimsInput.Type;

export const ClaimDueProjectTriggersInput = Schema.Struct({
  now: IsoDateTime,
  claimExpiresAt: IsoDateTime,
  limit: PositiveInt,
});
export type ClaimDueProjectTriggersInput = typeof ClaimDueProjectTriggersInput.Type;

export const ScheduleProjectTriggerRunInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  claimedAt: IsoDateTime,
  fireAt: IsoDateTime,
  scheduledAt: IsoDateTime,
  nextFireAt: Schema.NullOr(IsoDateTime),
  run: ProjectTriggerRunRow,
});
export type ScheduleProjectTriggerRunInput = typeof ScheduleProjectTriggerRunInput.Type;

export const MarkProjectTriggerScheduleFailedInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  claimedAt: IsoDateTime,
  failedAt: IsoDateTime,
  failureDetail: TrimmedNonEmptyString,
});
export type MarkProjectTriggerScheduleFailedInput =
  typeof MarkProjectTriggerScheduleFailedInput.Type;

export const ClaimDueProjectTriggerRunsInput = Schema.Struct({
  now: IsoDateTime,
  claimExpiresAt: IsoDateTime,
  limit: PositiveInt,
});
export type ClaimDueProjectTriggerRunsInput = typeof ClaimDueProjectTriggerRunsInput.Type;

export const MarkProjectTriggerRunDispatchedInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  dispatchedAt: IsoDateTime,
  resultSequence: Schema.Number,
});
export type MarkProjectTriggerRunDispatchedInput = typeof MarkProjectTriggerRunDispatchedInput.Type;

export const MarkProjectTriggerRunFailedInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  failedAt: IsoDateTime,
  failureDetail: TrimmedNonEmptyString,
});
export type MarkProjectTriggerRunFailedInput = typeof MarkProjectTriggerRunFailedInput.Type;

export const MarkProjectTriggerRunSkippedInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  skippedAt: IsoDateTime,
  skipReason: TrimmedNonEmptyString,
});
export type MarkProjectTriggerRunSkippedInput = typeof MarkProjectTriggerRunSkippedInput.Type;

export type ProjectTriggerRepositoryError = ProjectionRepositoryError;

export interface ProjectTriggerRepositoryShape {
  readonly upsertTrigger: (
    row: UpsertProjectTriggerInput,
  ) => Effect.Effect<void, ProjectTriggerRepositoryError>;
  readonly getTriggerById: (
    input: ProjectTriggerIdInput,
  ) => Effect.Effect<Option.Option<ProjectTriggerRow>, ProjectTriggerRepositoryError>;
  readonly listTriggersByProjectId: (
    input: ListProjectTriggersByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRow>, ProjectTriggerRepositoryError>;
  readonly deleteTrigger: (
    input: DeleteProjectTriggerInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly recoverExpiredTriggerClaims: (
    input: RecoverExpiredProjectTriggerClaimsInput,
  ) => Effect.Effect<number, ProjectTriggerRepositoryError>;
  readonly claimDueTriggers: (
    input: ClaimDueProjectTriggersInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRow>, ProjectTriggerRepositoryError>;
  readonly scheduleRunForClaimedTrigger: (
    input: ScheduleProjectTriggerRunInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly insertRun: (
    row: ProjectTriggerRunRow,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markTriggerScheduleFailed: (
    input: MarkProjectTriggerScheduleFailedInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly getRunById: (
    input: ProjectTriggerRunIdInput,
  ) => Effect.Effect<Option.Option<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly listRunsByTriggerId: (
    input: ListProjectTriggerRunsByTriggerInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly recoverExpiredRunClaims: (
    input: RecoverExpiredProjectTriggerClaimsInput,
  ) => Effect.Effect<number, ProjectTriggerRepositoryError>;
  readonly claimDueRuns: (
    input: ClaimDueProjectTriggerRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly markRunDispatched: (
    input: MarkProjectTriggerRunDispatchedInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunFailed: (
    input: MarkProjectTriggerRunFailedInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunSkipped: (
    input: MarkProjectTriggerRunSkippedInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
}

export class ProjectTriggerRepository extends Context.Service<
  ProjectTriggerRepository,
  ProjectTriggerRepositoryShape
>()("t3/projectTriggers/Services/ProjectTriggerRepository") {}
