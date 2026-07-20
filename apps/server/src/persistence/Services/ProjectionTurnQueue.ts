import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationProposedPlanId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTurnQueueStatus = Schema.Literals([
  "queued",
  "dispatching",
  "started",
  "completed",
  "failed",
  "cancelled",
]);
export type ProjectionTurnQueueStatus = typeof ProjectionTurnQueueStatus.Type;

export const ProjectionTurnQueueRow = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  threadId: ThreadId,
  eventId: EventId,
  commandId: Schema.NullOr(CommandId),
  messageId: MessageId,
  status: ProjectionTurnQueueStatus,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  turnId: Schema.NullOr(TurnId),
  modelSelection: Schema.NullOr(ModelSelection),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  titleSeed: Schema.NullOr(TrimmedNonEmptyString),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectionTurnQueueRow = typeof ProjectionTurnQueueRow.Type;

export const UpsertProjectionTurnQueueInput = ProjectionTurnQueueRow;
export type UpsertProjectionTurnQueueInput = typeof UpsertProjectionTurnQueueInput.Type;

export const ThreadQueueInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadQueueInput = typeof ThreadQueueInput.Type;

export const ProjectionTurnQueueIdentityInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  messageId: MessageId,
});
export type ProjectionTurnQueueIdentityInput = typeof ProjectionTurnQueueIdentityInput.Type;

export const ProjectionTurnQueueIdInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
});
export type ProjectionTurnQueueIdInput = typeof ProjectionTurnQueueIdInput.Type;

export const MarkProjectionTurnQueueDispatchingInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
});
export type MarkProjectionTurnQueueDispatchingInput =
  typeof MarkProjectionTurnQueueDispatchingInput.Type;

export const MarkProjectionTurnQueueStartedInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  turnId: TurnId,
  startedAt: IsoDateTime,
});
export type MarkProjectionTurnQueueStartedInput = typeof MarkProjectionTurnQueueStartedInput.Type;

export const MarkProjectionTurnQueueFailedInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  failureDetail: TrimmedNonEmptyString,
});
export type MarkProjectionTurnQueueFailedInput = typeof MarkProjectionTurnQueueFailedInput.Type;

export const MarkProjectionTurnQueueCancelledInput = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  cancelledAt: IsoDateTime,
});
export type MarkProjectionTurnQueueCancelledInput =
  typeof MarkProjectionTurnQueueCancelledInput.Type;

export const CompleteProjectionTurnQueueForThreadInput = Schema.Struct({
  threadId: ThreadId,
  completedAt: IsoDateTime,
});
export type CompleteProjectionTurnQueueForThreadInput =
  typeof CompleteProjectionTurnQueueForThreadInput.Type;

export const CancelProjectionTurnQueueForThreadInput = Schema.Struct({
  threadId: ThreadId,
  cancelledAt: IsoDateTime,
});
export type CancelProjectionTurnQueueForThreadInput =
  typeof CancelProjectionTurnQueueForThreadInput.Type;

export const RecoverProjectionTurnQueueInput = Schema.Struct({
  recoveredAt: IsoDateTime,
  staleBefore: IsoDateTime,
});
export type RecoverProjectionTurnQueueInput = typeof RecoverProjectionTurnQueueInput.Type;

export interface ProjectionTurnQueueRepositoryShape {
  readonly upsert: (
    row: UpsertProjectionTurnQueueInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByQueueId: (
    input: ProjectionTurnQueueIdInput,
  ) => Effect.Effect<Option.Option<ProjectionTurnQueueRow>, ProjectionRepositoryError>;
  readonly isQueued: (
    input: ProjectionTurnQueueIdentityInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly markDispatching: (
    input: MarkProjectionTurnQueueDispatchingInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly markStarted: (
    input: MarkProjectionTurnQueueStartedInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly markFailed: (
    input: MarkProjectionTurnQueueFailedInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly markCancelled: (
    input: MarkProjectionTurnQueueCancelledInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly listActiveByThreadId: (
    input: ThreadQueueInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurnQueueRow>, ProjectionRepositoryError>;
  readonly countQueuedByThreadId: (
    input: ThreadQueueInput,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly listQueuedThreadIds: Effect.Effect<ReadonlyArray<ThreadId>, ProjectionRepositoryError>;
  readonly completeStartedByThreadId: (
    input: CompleteProjectionTurnQueueForThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly cancelActiveByThreadId: (
    input: CancelProjectionTurnQueueForThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recoverAbandoned: (
    input: RecoverProjectionTurnQueueInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTurnQueueRepository extends Context.Service<
  ProjectionTurnQueueRepository,
  ProjectionTurnQueueRepositoryShape
>()("t3/persistence/Services/ProjectionTurnQueue/ProjectionTurnQueueRepository") {}
