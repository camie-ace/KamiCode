import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionTurnQueueRepositoryLive } from "./ProjectionTurnQueue.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionTurnQueueRepository } from "../Services/ProjectionTurnQueue.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionTurnQueueRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        defaultThreadEnvMode: null,
        scripts: [],
        testEnvironments: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_projects row to exist.");
      }

      assert.strictEqual(
        row.defaultModelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_threads row to exist.");
      }

      assert.strictEqual(
        row.modelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("does not allow cancellation after a queued turn starts dispatching", () =>
    Effect.gen(function* () {
      const queue = yield* ProjectionTurnQueueRepository;
      const sql = yield* SqlClient.SqlClient;
      const queueId = "queue:event-cancel-dispatching";
      const threadId = ThreadId.make("thread-queue-cancel-dispatching");

      yield* queue.upsert({
        queueId,
        threadId,
        eventId: EventId.make("event-cancel-dispatching"),
        commandId: null,
        messageId: MessageId.make("message-cancel-dispatching"),
        status: "queued",
        requestedAt: "2026-03-24T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        turnId: null,
        modelSelection: null,
        runtimeMode: "full-access",
        interactionMode: "default",
        titleSeed: null,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        failureDetail: null,
      });

      const dispatching = yield* queue.markDispatching({
        queueId,
        startedAt: "2026-03-24T00:00:01.000Z",
      });
      assert.strictEqual(dispatching, true);

      const cancelled = yield* queue.markCancelled({
        queueId,
        cancelledAt: "2026-03-24T00:00:02.000Z",
      });
      assert.strictEqual(cancelled, false);

      const started = yield* queue.markStarted({
        queueId,
        turnId: TurnId.make("turn-cancel-dispatching"),
        startedAt: "2026-03-24T00:00:03.000Z",
      });
      assert.strictEqual(started, true);

      const rows = yield* sql<{ readonly status: string }>`
        SELECT status
        FROM projection_turn_queue
        WHERE queue_id = ${queueId}
      `;
      assert.strictEqual(rows[0]?.status, "started");
    }),
  );

  it.effect("recovers abandoned queue rows and terminalizes archived work", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const queue = yield* ProjectionTurnQueueRepository;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-03-24T01:00:00.000Z";
      const makeThread = (threadId: ThreadId, archivedAt: string | null = null) =>
        threads.upsert({
          threadId,
          projectId: ProjectId.make("project-queue-recovery"),
          title: String(threadId),
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurnId: null,
          createdAt: now,
          updatedAt: now,
          archivedAt,
          pinnedAt: null,
          settledOverride: null,
          settledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          latestUserMessageAt: null,
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          hasActionableProposedPlan: 0,
          deletedAt: null,
        });
      const activeThreadId = ThreadId.make("thread-queue-recovery-active");
      const runningThreadId = ThreadId.make("thread-queue-recovery-running");
      const archivedThreadId = ThreadId.make("thread-queue-recovery-archived");
      yield* makeThread(activeThreadId);
      yield* makeThread(runningThreadId);
      yield* makeThread(archivedThreadId, now);

      const upsertQueue = (
        queueId: string,
        threadId: ThreadId,
        status: "queued" | "dispatching" | "started",
        turnId: TurnId | null = null,
        requestedAt = now,
      ) =>
        queue.upsert({
          queueId,
          threadId,
          eventId: EventId.make(`event:${queueId}`),
          commandId: null,
          messageId: MessageId.make(`message:${queueId}`),
          status,
          requestedAt,
          startedAt: status === "queued" ? null : now,
          completedAt: null,
          turnId,
          modelSelection: null,
          runtimeMode: "full-access",
          interactionMode: "default",
          titleSeed: null,
          sourceProposedPlanThreadId: null,
          sourceProposedPlanId: null,
          failureDetail: null,
        });
      yield* upsertQueue("queue:recover-dispatching", activeThreadId, "dispatching");
      yield* upsertQueue(
        "queue:recover-started",
        activeThreadId,
        "started",
        TurnId.make("turn-recover-started"),
      );
      yield* upsertQueue("queue:recover-running", runningThreadId, "dispatching");
      yield* upsertQueue("queue:recover-archived", archivedThreadId, "queued");
      yield* upsertQueue(
        "queue:recover-stale",
        activeThreadId,
        "queued",
        null,
        "2026-03-01T00:00:00.000Z",
      );

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          runtime_mode,
          active_turn_id,
          updated_at
        ) VALUES (
          ${runningThreadId},
          'running',
          'full-access',
          ${TurnId.make("turn-recovered-running")},
          ${now}
        )
      `;

      yield* queue.recoverAbandoned({
        recoveredAt: "2026-03-24T01:05:00.000Z",
        staleBefore: "2026-03-17T01:05:00.000Z",
      });

      const rows = yield* sql<{
        readonly queueId: string;
        readonly status: string;
        readonly turnId: string | null;
      }>`
        SELECT
          queue_id AS "queueId",
          status,
          turn_id AS "turnId"
        FROM projection_turn_queue
        WHERE queue_id LIKE 'queue:recover-%'
        ORDER BY queue_id ASC
      `;
      assert.deepStrictEqual(rows, [
        { queueId: "queue:recover-archived", status: "cancelled", turnId: null },
        { queueId: "queue:recover-dispatching", status: "queued", turnId: null },
        {
          queueId: "queue:recover-running",
          status: "started",
          turnId: "turn-recovered-running",
        },
        { queueId: "queue:recover-stale", status: "cancelled", turnId: null },
        {
          queueId: "queue:recover-started",
          status: "completed",
          turnId: "turn-recover-started",
        },
      ]);
    }),
  );

  it.effect("round-trips non-null settlement values through the thread row", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-settled"),
        projectId: ProjectId.make("project-1"),
        title: "Settled thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        archivedAt: null,
        settledOverride: "settled",
        settledAt: "2026-03-25T00:00:00.000Z",
        snoozedUntil: "2026-03-26T09:00:00.000Z",
        snoozedAt: "2026-03-25T00:00:00.000Z",
        pinnedAt: "2026-03-25T00:00:00.000Z",
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const row = Option.getOrNull(persisted);
      if (!row) {
        return yield* Effect.die("Expected settled projection_threads row to exist.");
      }
      assert.strictEqual(row.settledOverride, "settled");
      assert.strictEqual(row.settledAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.snoozedUntil, "2026-03-26T09:00:00.000Z");
      assert.strictEqual(row.snoozedAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.pinnedAt, "2026-03-25T00:00:00.000Z");

      yield* threads.upsert({
        ...row,
        settledOverride: "active",
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
      });
      const repersisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const updated = Option.getOrNull(repersisted);
      assert.strictEqual(updated?.settledOverride, "active");
      assert.strictEqual(updated?.settledAt, null);
      assert.strictEqual(updated?.snoozedUntil, null);
      assert.strictEqual(updated?.snoozedAt, null);
      assert.strictEqual(updated?.pinnedAt, null);
    }),
  );
});
