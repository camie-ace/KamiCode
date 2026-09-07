import {
  CommandId,
  EventId,
  KamiUserId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { UserActivityAttributionRepository } from "../Services/UserActivityAttribution.ts";
import { UserActivityAttributionRepositoryLive } from "./UserActivityAttribution.ts";

const TestLayer = UserActivityAttributionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("UserActivityAttributionRepository", (it) => {
  it.effect("attributes a completed turn's token usage to its user and project", () =>
    Effect.gen(function* () {
      const repository = yield* UserActivityAttributionRepository;
      const sql = yield* SqlClient.SqlClient;
      const user = {
        userId: KamiUserId.make("user-1"),
        githubId: "123",
        githubLogin: "julius",
        displayName: "Julius",
        avatarUrl: null,
      };
      const threadId = ThreadId.make("thread-1");
      const projectId = ProjectId.make("project-1");
      const messageId = MessageId.make("message-1");
      const turnId = TurnId.make("turn-1");

      yield* repository.recordThreadCreated({
        threadId,
        projectId,
        user,
        createdAt: "2026-09-07T08:00:00.000Z",
      });
      yield* repository.recordTurnRequested({
        requestEventId: EventId.make("event-request-decoy"),
        commandId: CommandId.make("command-request-decoy"),
        messageId: MessageId.make("message-decoy"),
        threadId,
        projectId,
        user,
        requestedAt: "2026-09-07T08:00:30.000Z",
        providerInstanceId: ProviderInstanceId.make("codex"),
        model: "gpt-6-astra",
      });
      yield* repository.recordTurnRequested({
        requestEventId: EventId.make("event-request-1"),
        commandId: CommandId.make("command-request-1"),
        messageId,
        threadId,
        projectId,
        user,
        requestedAt: "2026-09-07T08:01:00.000Z",
        providerInstanceId: ProviderInstanceId.make("codex"),
        model: "gpt-6-astra",
      });
      yield* repository.recordTurnStarted({
        threadId,
        turnId,
        requestMessageId: messageId,
        startedAt: "2026-09-07T08:01:01.000Z",
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        model: "gpt-6-astra",
        effort: "high",
      });
      yield* repository.recordTurnCompleted({
        threadId,
        turnId,
        completedAt: "2026-09-07T08:02:00.000Z",
        terminalStatus: "completed",
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        usageStatus: "complete",
        usageScope: "main_agent",
        hasSubagents: true,
        inputTokens: 1200,
        cachedInputTokens: 300,
        cacheCreationTokens: null,
        outputTokens: 450,
        reasoningTokens: 125,
        totalCostUsd: 0.42,
      });

      const rows = yield* sql<{
        readonly githubLogin: string;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly projectId: string;
        readonly reasoningTokens: number;
        readonly threadId: string;
        readonly totalCostUsd: number;
        readonly turnId: string;
        readonly userId: string;
      }>`
        SELECT
          github_login AS "githubLogin",
          input_tokens AS "inputTokens",
          output_tokens AS "outputTokens",
          project_id AS "projectId",
          reasoning_tokens AS "reasoningTokens",
          thread_id AS "threadId",
          total_cost_usd AS "totalCostUsd",
          turn_id AS "turnId",
          user_id AS "userId"
        FROM user_turn_attribution
        WHERE request_event_id = 'event-request-1'
      `;
      assert.deepEqual(rows, [
        {
          githubLogin: "julius",
          inputTokens: 1200,
          outputTokens: 450,
          projectId: "project-1",
          reasoningTokens: 125,
          threadId: "thread-1",
          totalCostUsd: 0.42,
          turnId: "turn-1",
          userId: "user-1",
        },
      ]);
    }),
  );
});
