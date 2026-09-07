import {
  CommandId,
  EventId,
  IsoDateTime,
  KamiUser,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const RecordUserThreadAttributionInput = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  user: KamiUser,
  createdAt: IsoDateTime,
});
export type RecordUserThreadAttributionInput = typeof RecordUserThreadAttributionInput.Type;

export const RecordUserTurnRequestInput = Schema.Struct({
  requestEventId: EventId,
  commandId: Schema.NullOr(CommandId),
  messageId: MessageId,
  threadId: ThreadId,
  projectId: ProjectId,
  user: KamiUser,
  requestedAt: IsoDateTime,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  model: Schema.NullOr(Schema.String),
});
export type RecordUserTurnRequestInput = typeof RecordUserTurnRequestInput.Type;

export const RecordUserTurnStartedInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  requestMessageId: Schema.NullOr(MessageId),
  startedAt: IsoDateTime,
  provider: ProviderDriverKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
});
export type RecordUserTurnStartedInput = typeof RecordUserTurnStartedInput.Type;

export const RecordUserTurnCompletionInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  terminalStatus: Schema.String,
  provider: ProviderDriverKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  usageStatus: Schema.String,
  usageScope: Schema.NullOr(Schema.String),
  hasSubagents: Schema.NullOr(Schema.Boolean),
  inputTokens: Schema.NullOr(Schema.Number),
  cachedInputTokens: Schema.NullOr(Schema.Number),
  cacheCreationTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  reasoningTokens: Schema.NullOr(Schema.Number),
  totalCostUsd: Schema.NullOr(Schema.Number),
});
export type RecordUserTurnCompletionInput = typeof RecordUserTurnCompletionInput.Type;

export interface UserActivityAttributionRepositoryShape {
  readonly recordThreadCreated: (
    input: RecordUserThreadAttributionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordTurnRequested: (
    input: RecordUserTurnRequestInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordTurnStarted: (
    input: RecordUserTurnStartedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordTurnCompleted: (
    input: RecordUserTurnCompletionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class UserActivityAttributionRepository extends Context.Service<
  UserActivityAttributionRepository,
  UserActivityAttributionRepositoryShape
>()("t3/persistence/Services/UserActivityAttribution/UserActivityAttributionRepository") {}
