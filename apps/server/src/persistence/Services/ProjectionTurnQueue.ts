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

export interface ProjectionTurnQueueRepositoryShape {
  readonly upsert: (
    row: UpsertProjectionTurnQueueInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly claimNextQueuedByThreadId: (
    input: ThreadQueueInput,
    claimedAt: IsoDateTime,
  ) => Effect.Effect<Option.Option<ProjectionTurnQueueRow>, ProjectionRepositoryError>;
  readonly markStarted: (
    input: MarkProjectionTurnQueueStartedInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly markFailed: (
    input: MarkProjectionTurnQueueFailedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markCancelled: (
    input: MarkProjectionTurnQueueCancelledInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly listActiveByThreadId: (
    input: ThreadQueueInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurnQueueRow>, ProjectionRepositoryError>;
  readonly countQueuedByThreadId: (
    input: ThreadQueueInput,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class ProjectionTurnQueueRepository extends Context.Service<
  ProjectionTurnQueueRepository,
  ProjectionTurnQueueRepositoryShape
>()("t3/persistence/Services/ProjectionTurnQueue/ProjectionTurnQueueRepository") {}
