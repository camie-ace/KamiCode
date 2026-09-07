import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  RecordUserThreadAttributionInput,
  RecordUserTurnCompletionInput,
  RecordUserTurnRequestInput,
  RecordUserTurnStartedInput,
  UserActivityAttributionRepository,
  type UserActivityAttributionRepositoryShape,
} from "../Services/UserActivityAttribution.ts";

const makeUserActivityAttributionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const recordThreadCreatedRow = SqlSchema.void({
    Request: RecordUserThreadAttributionInput,
    execute: (input) =>
      sql`
        INSERT INTO user_thread_attribution (
          thread_id,
          project_id,
          user_id,
          github_login,
          display_name,
          avatar_url,
          created_at
        )
        VALUES (
          ${input.threadId},
          ${input.projectId},
          ${input.user.userId},
          ${input.user.githubLogin},
          ${input.user.displayName},
          ${input.user.avatarUrl},
          ${input.createdAt}
        )
        ON CONFLICT(thread_id) DO NOTHING
      `,
  });

  const recordTurnRequestedRow = SqlSchema.void({
    Request: RecordUserTurnRequestInput,
    execute: (input) =>
      sql`
        INSERT INTO user_turn_attribution (
          request_event_id,
          command_id,
          message_id,
          thread_id,
          project_id,
          user_id,
          github_login,
          display_name,
          avatar_url,
          requested_at,
          provider_instance_id,
          model
        )
        VALUES (
          ${input.requestEventId},
          ${input.commandId},
          ${input.messageId},
          ${input.threadId},
          ${input.projectId},
          ${input.user.userId},
          ${input.user.githubLogin},
          ${input.user.displayName},
          ${input.user.avatarUrl},
          ${input.requestedAt},
          ${input.providerInstanceId},
          ${input.model}
        )
        ON CONFLICT(request_event_id) DO NOTHING
      `,
  });

  const recordTurnStartedRow = SqlSchema.void({
    Request: RecordUserTurnStartedInput,
    execute: (input) =>
      sql`
        UPDATE user_turn_attribution
        SET turn_id = COALESCE(turn_id, ${input.turnId}),
            started_at = COALESCE(started_at, ${input.startedAt}),
            provider = COALESCE(${input.provider}, provider),
            provider_instance_id = COALESCE(${input.providerInstanceId}, provider_instance_id),
            model = COALESCE(${input.model}, model),
            effort = COALESCE(${input.effort}, effort)
        WHERE request_event_id = COALESCE(
          (
            SELECT request_event_id
            FROM user_turn_attribution
            WHERE thread_id = ${input.threadId}
              AND turn_id = ${input.turnId}
            LIMIT 1
          ),
          (
            SELECT request_event_id
            FROM user_turn_attribution
            WHERE thread_id = ${input.threadId}
              AND message_id = ${input.requestMessageId}
              AND turn_id IS NULL
            ORDER BY requested_at ASC, request_event_id ASC
            LIMIT 1
          ),
          (
            SELECT request_event_id
            FROM user_turn_attribution
            WHERE thread_id = ${input.threadId}
              AND turn_id IS NULL
            ORDER BY requested_at ASC, request_event_id ASC
            LIMIT 1
          )
        )
      `,
  });

  const recordTurnCompletedRow = SqlSchema.void({
    Request: RecordUserTurnCompletionInput,
    execute: (input) =>
      sql`
        UPDATE user_turn_attribution
        SET turn_id = COALESCE(turn_id, ${input.turnId}),
            completed_at = ${input.completedAt},
            terminal_status = ${input.terminalStatus},
            provider = COALESCE(${input.provider}, provider),
            provider_instance_id = COALESCE(${input.providerInstanceId}, provider_instance_id),
            usage_status = ${input.usageStatus},
            usage_scope = COALESCE(${input.usageScope}, usage_scope),
            has_subagents = COALESCE(${
              input.hasSubagents === null ? null : Number(input.hasSubagents)
            }, has_subagents),
            input_tokens = COALESCE(${input.inputTokens}, input_tokens),
            cached_input_tokens = COALESCE(${input.cachedInputTokens}, cached_input_tokens),
            cache_creation_tokens = COALESCE(${input.cacheCreationTokens}, cache_creation_tokens),
            output_tokens = COALESCE(${input.outputTokens}, output_tokens),
            reasoning_tokens = COALESCE(${input.reasoningTokens}, reasoning_tokens),
            total_cost_usd = COALESCE(${input.totalCostUsd}, total_cost_usd)
        WHERE request_event_id = COALESCE(
          (
            SELECT request_event_id
            FROM user_turn_attribution
            WHERE thread_id = ${input.threadId}
              AND turn_id = ${input.turnId}
            LIMIT 1
          ),
          (
            SELECT request_event_id
            FROM user_turn_attribution
            WHERE thread_id = ${input.threadId}
              AND turn_id IS NULL
            ORDER BY requested_at ASC, request_event_id ASC
            LIMIT 1
          )
        )
      `,
  });

  const recordThreadCreated: UserActivityAttributionRepositoryShape["recordThreadCreated"] = (
    input,
  ) =>
    recordThreadCreatedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("UserActivityAttribution.recordThreadCreated")),
    );

  const recordTurnRequested: UserActivityAttributionRepositoryShape["recordTurnRequested"] = (
    input,
  ) =>
    recordTurnRequestedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("UserActivityAttribution.recordTurnRequested")),
    );

  const recordTurnStarted: UserActivityAttributionRepositoryShape["recordTurnStarted"] = (input) =>
    recordTurnStartedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("UserActivityAttribution.recordTurnStarted")),
    );

  const recordTurnCompleted: UserActivityAttributionRepositoryShape["recordTurnCompleted"] = (
    input,
  ) =>
    recordTurnCompletedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("UserActivityAttribution.recordTurnCompleted")),
    );

  return UserActivityAttributionRepository.of({
    recordThreadCreated,
    recordTurnRequested,
    recordTurnStarted,
    recordTurnCompleted,
  });
});

export const UserActivityAttributionRepositoryLive = Layer.effect(
  UserActivityAttributionRepository,
  makeUserActivityAttributionRepository,
);
