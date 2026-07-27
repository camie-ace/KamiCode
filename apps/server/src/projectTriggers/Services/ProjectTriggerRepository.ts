import {
  ChatAttachment,
  CommandId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  ProjectId,
  ProjectTriggerRunInitiator,
  ProjectTriggerRuntimeTarget,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  ThreadTurnStartCommand,
  TriggerEventKind,
  TrimmedNonEmptyString,
  TurnDispatchPolicy,
  PositiveInt,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const ProjectTriggerId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTriggerId"));
export type ProjectTriggerId = typeof ProjectTriggerId.Type;

export const ProjectTriggerRunId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTriggerRunId"));
export type ProjectTriggerRunId = typeof ProjectTriggerRunId.Type;

export const ProjectTriggerScheduleKind = Schema.Literals(["cron", "once", "manual"]);
export type ProjectTriggerScheduleKind = typeof ProjectTriggerScheduleKind.Type;

export const ProjectTriggerRunStatus = Schema.Literals([
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
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
  webhookPublicId: TrimmedNonEmptyString,
  webhookSecretVersion: NonNegativeInt,
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
  initiator: ProjectTriggerRunInitiator,
  status: ProjectTriggerRunStatus,
  eventKind: Schema.NullOr(TriggerEventKind),
  eventPayload: Schema.NullOr(Schema.Json),
  idempotencyKey: Schema.NullOr(TrimmedNonEmptyString),
  requestDigest: Schema.NullOr(TrimmedNonEmptyString),
  retryOfRunId: Schema.NullOr(ProjectTriggerRunId),
  fireAt: IsoDateTime,
  queuedAt: IsoDateTime,
  claimedAt: Schema.NullOr(IsoDateTime),
  claimExpiresAt: Schema.NullOr(IsoDateTime),
  dispatchedAt: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  command: ThreadTurnStartCommand,
  resultSequence: Schema.NullOr(Schema.Number),
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
  cancellationReason: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectTriggerRunRow = typeof ProjectTriggerRunRow.Type;

export const UpsertProjectTriggerInput = ProjectTriggerRow;
export type UpsertProjectTriggerInput = typeof UpsertProjectTriggerInput.Type;

export const ProjectTriggerIdInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});
export type ProjectTriggerIdInput = typeof ProjectTriggerIdInput.Type;

export const ProjectTriggerPublicIdInput = Schema.Struct({
  publicId: TrimmedNonEmptyString,
});
export type ProjectTriggerPublicIdInput = typeof ProjectTriggerPublicIdInput.Type;

export const ProjectTriggerRunIdInput = Schema.Struct({
  runId: ProjectTriggerRunId,
});
export type ProjectTriggerRunIdInput = typeof ProjectTriggerRunIdInput.Type;

export const ListProjectTriggerRunsByTriggerInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  limit: PositiveInt,
});
export type ListProjectTriggerRunsByTriggerInput = typeof ListProjectTriggerRunsByTriggerInput.Type;

export const ListActiveProjectTriggerRunsInput = Schema.Struct({
  limit: PositiveInt,
});
export type ListActiveProjectTriggerRunsInput = typeof ListActiveProjectTriggerRunsInput.Type;

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

export const MarkProjectTriggerRunStartingInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  dispatchedAt: IsoDateTime,
  resultSequence: Schema.Number,
});
export type MarkProjectTriggerRunStartingInput = typeof MarkProjectTriggerRunStartingInput.Type;

export const MarkProjectTriggerRunRunningInput = Schema.Struct({
  threadId: ThreadId,
  startedAt: IsoDateTime,
});
export type MarkProjectTriggerRunRunningInput = typeof MarkProjectTriggerRunRunningInput.Type;

export const MarkProjectTriggerRunFailedInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  failedAt: IsoDateTime,
  failureDetail: TrimmedNonEmptyString,
});
export type MarkProjectTriggerRunFailedInput = typeof MarkProjectTriggerRunFailedInput.Type;

export const MarkProjectTriggerRunSucceededInput = Schema.Struct({
  threadId: ThreadId,
  completedAt: IsoDateTime,
});
export type MarkProjectTriggerRunSucceededInput = typeof MarkProjectTriggerRunSucceededInput.Type;

export const MarkProjectTriggerRunCancelledInput = Schema.Struct({
  runId: ProjectTriggerRunId,
  cancelledAt: IsoDateTime,
  cancellationReason: TrimmedNonEmptyString,
});
export type MarkProjectTriggerRunCancelledInput = typeof MarkProjectTriggerRunCancelledInput.Type;

export const SettleProjectTriggerRunByThreadInput = Schema.Struct({
  threadId: ThreadId,
  completedAt: IsoDateTime,
  status: Schema.Literals(["failed", "cancelled"]),
  detail: TrimmedNonEmptyString,
});
export type SettleProjectTriggerRunByThreadInput = typeof SettleProjectTriggerRunByThreadInput.Type;

export const RotateProjectTriggerWebhookSecretVersionInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  updatedAt: IsoDateTime,
});
export type RotateProjectTriggerWebhookSecretVersionInput =
  typeof RotateProjectTriggerWebhookSecretVersionInput.Type;

export interface AcceptProjectTriggerWebhookRunInput {
  readonly run: ProjectTriggerRunRow & { readonly idempotencyKey: string };
  readonly nonce: string;
  readonly requestDigest: string;
  readonly receivedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export type AcceptProjectTriggerWebhookRunResult =
  | { readonly outcome: "inserted"; readonly run: ProjectTriggerRunRow }
  | { readonly outcome: "existing"; readonly run: ProjectTriggerRunRow }
  | { readonly outcome: "idempotency-conflict" }
  | { readonly outcome: "replay" };

export interface RecordProjectTriggerWebhookOperationInput {
  readonly triggerId: ProjectTriggerId;
  readonly runId: ProjectTriggerRunId;
  readonly idempotencyKey: string;
  readonly nonce: string;
  readonly requestDigest: string;
  readonly receivedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export type RecordProjectTriggerWebhookOperationResult =
  | { readonly outcome: "inserted" }
  | { readonly outcome: "existing" }
  | { readonly outcome: "idempotency-conflict" }
  | { readonly outcome: "replay" };

export type ProjectTriggerRepositoryChange =
  | {
      readonly type: "triggerUpserted";
      readonly triggerId: ProjectTriggerId;
      readonly projectId: ProjectId;
    }
  | {
      readonly type: "triggerDeleted";
      readonly triggerId: ProjectTriggerId;
      readonly projectId: ProjectId;
      readonly deletedAt: IsoDateTime;
    }
  | {
      readonly type: "runUpserted";
      readonly runId: ProjectTriggerRunId;
      readonly triggerId: ProjectTriggerId;
      readonly projectId: ProjectId;
    };

export type ProjectTriggerRepositoryError = ProjectionRepositoryError;

export interface ProjectTriggerRepositoryShape {
  readonly upsertTrigger: (
    row: UpsertProjectTriggerInput,
  ) => Effect.Effect<void, ProjectTriggerRepositoryError>;
  readonly getTriggerById: (
    input: ProjectTriggerIdInput,
  ) => Effect.Effect<Option.Option<ProjectTriggerRow>, ProjectTriggerRepositoryError>;
  readonly getTriggerByPublicId: (
    input: ProjectTriggerPublicIdInput,
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
  readonly getRunByThreadId: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<Option.Option<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly getRunByIdempotencyKey: (input: {
    readonly triggerId: ProjectTriggerId;
    readonly idempotencyKey: string;
  }) => Effect.Effect<Option.Option<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly listRunsByTriggerId: (
    input: ListProjectTriggerRunsByTriggerInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly listActiveRuns: (
    input: ListActiveProjectTriggerRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly recoverExpiredRunClaims: (
    input: RecoverExpiredProjectTriggerClaimsInput,
  ) => Effect.Effect<number, ProjectTriggerRepositoryError>;
  readonly claimDueRuns: (
    input: ClaimDueProjectTriggerRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRunRow>, ProjectTriggerRepositoryError>;
  readonly markRunStarting: (
    input: MarkProjectTriggerRunStartingInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunRunning: (
    input: MarkProjectTriggerRunRunningInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunSucceeded: (
    input: MarkProjectTriggerRunSucceededInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunFailed: (
    input: MarkProjectTriggerRunFailedInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly markRunCancelled: (
    input: MarkProjectTriggerRunCancelledInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly settleRunByThread: (
    input: SettleProjectTriggerRunByThreadInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly rotateWebhookSecretVersion: (
    input: RotateProjectTriggerWebhookSecretVersionInput,
  ) => Effect.Effect<Option.Option<number>, ProjectTriggerRepositoryError>;
  readonly acceptWebhookRun: (
    input: AcceptProjectTriggerWebhookRunInput,
  ) => Effect.Effect<AcceptProjectTriggerWebhookRunResult, ProjectTriggerRepositoryError>;
  readonly recordWebhookOperation: (
    input: RecordProjectTriggerWebhookOperationInput,
  ) => Effect.Effect<RecordProjectTriggerWebhookOperationResult, ProjectTriggerRepositoryError>;
  readonly subscribeChanges: Effect.Effect<
    PubSub.Subscription<ProjectTriggerRepositoryChange>,
    never,
    Scope.Scope
  >;
}

export class ProjectTriggerRepository extends Context.Service<
  ProjectTriggerRepository,
  ProjectTriggerRepositoryShape
>()("t3/projectTriggers/Services/ProjectTriggerRepository") {}
