import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerOrchestrationDispatcher } from "../../orchestration/Services/ServerOrchestrationDispatcher.ts";
import { makeProjectTriggerRunRow } from "../commands.ts";
import {
  ProjectTriggerId,
  ProjectTriggerRepository,
  type ProjectTriggerRow,
  type ProjectTriggerRunRow,
} from "../Services/ProjectTriggerRepository.ts";
import { ProjectTriggerScheduler } from "../Services/ProjectTriggerScheduler.ts";
import { ProjectTriggerSchedulerLive } from "./ProjectTriggerScheduler.ts";

const timestamp = "2026-07-19T19:00:00.000Z";

const trigger: ProjectTriggerRow = {
  triggerId: ProjectTriggerId.make("trigger-scheduler-test"),
  projectId: ProjectId.make("project-scheduler-test"),
  name: "Scheduler test",
  description: null,
  enabled: true,
  scheduleKind: "manual",
  scheduleCron: null,
  scheduleOnceAt: null,
  timezone: "UTC",
  runtimeTarget: "local",
  webhookPublicId: "scheduler-webhook-public",
  webhookSecretVersion: 1,
  nextFireAt: null,
  lastFireAt: null,
  prompt: "Run the scheduler test.",
  attachments: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  dispatchPolicy: null,
  titleSeed: null,
  bootstrap: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  scheduleClaimedAt: null,
  scheduleClaimExpiresAt: null,
  failureDetail: null,
};

function runFor(key: string, status: ProjectTriggerRunRow["status"]): ProjectTriggerRunRow {
  const base = makeProjectTriggerRunRow({
    trigger,
    fireAt: timestamp,
    queuedAt: timestamp,
    runKey: key,
  });
  return {
    ...base,
    status,
    claimedAt: status === "queued" ? null : timestamp,
    dispatchedAt: status === "queued" ? null : timestamp,
    startedAt: status === "running" ? timestamp : null,
  };
}

function threadFor(
  run: ProjectTriggerRunRow,
  state: "completed" | "error" | "interrupted",
): OrchestrationThread {
  return {
    id: run.threadId,
    projectId: trigger.projectId,
    title: trigger.name,
    modelSelection: trigger.modelSelection,
    runtimeMode: trigger.runtimeMode,
    interactionMode: trigger.interactionMode,
    branch: null,
    worktreePath: null,
    startedBy: null,
    workflowParentThreadId: null,
    workflowLaneId: null,
    workflowLaneRole: null,
    latestTurn: {
      turnId: TurnId.make(`turn-${state}`),
      state,
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      assistantMessageId: MessageId.make(`message-${state}`),
    },
    queuedTurns: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

const baseRepository = {
  recoverExpiredTriggerClaims: () => Effect.succeed(0),
  recoverExpiredRunClaims: () => Effect.succeed(0),
  claimDueTriggers: () => Effect.succeed([]),
  claimDueRuns: () => Effect.succeed([]),
  listActiveRuns: () => Effect.succeed([]),
};

const baseDependencies = Layer.mergeAll(
  Layer.mock(OrchestrationEngineService)({
    streamDomainEvents: Stream.empty,
  }),
  Layer.mock(ServerOrchestrationDispatcher)({
    dispatch: () => Effect.succeed({ sequence: 1 }),
  }),
);

describe("ProjectTriggerScheduler", () => {
  it.effect("settles runs from authoritative completed, failed, and interrupted turns", () => {
    const completed = runFor("completed", "running");
    const failed = runFor("failed", "running");
    const interrupted = runFor("interrupted", "running");
    const succeededThreads: Array<ThreadId> = [];
    const settled: Array<{ readonly threadId: ThreadId; readonly status: string }> = [];
    const threads = new Map([
      [completed.threadId, threadFor(completed, "completed")],
      [failed.threadId, threadFor(failed, "error")],
      [interrupted.threadId, threadFor(interrupted, "interrupted")],
    ]);
    const dependencies = Layer.mergeAll(
      baseDependencies,
      Layer.mock(ProjectTriggerRepository)({
        ...baseRepository,
        listActiveRuns: () => Effect.succeed([completed, failed, interrupted]),
        markRunRunning: () => Effect.succeed(true),
        markRunSucceeded: (input) =>
          Effect.sync(() => {
            succeededThreads.push(input.threadId);
            return true;
          }),
        settleRunByThread: (input) =>
          Effect.sync(() => {
            settled.push({ threadId: input.threadId, status: input.status });
            return true;
          }),
      }),
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadDetailById: (threadId) => {
          const thread = threads.get(threadId);
          return Effect.succeed(thread === undefined ? Option.none() : Option.some(thread));
        },
      }),
    );

    return Effect.gen(function* () {
      const scheduler = yield* ProjectTriggerScheduler;
      yield* scheduler.tick;

      assert.deepStrictEqual(succeededThreads, [completed.threadId]);
      assert.deepStrictEqual(settled, [
        { threadId: failed.threadId, status: "failed" },
        { threadId: interrupted.threadId, status: "cancelled" },
      ]);
    }).pipe(Effect.provide(ProjectTriggerSchedulerLive().pipe(Layer.provide(dependencies))));
  });

  it.effect("interrupts a thread when cancellation wins while start dispatch is in flight", () => {
    const claimed = runFor("cancel-race", "starting");
    const cancelled = {
      ...claimed,
      status: "cancelled" as const,
      completedAt: timestamp,
      cancellationReason: "controller cancellation",
    };
    const dispatched: Array<OrchestrationCommand> = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(OrchestrationEngineService)({ streamDomainEvents: Stream.empty }),
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadDetailById: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(ServerOrchestrationDispatcher)({
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
      }),
      Layer.mock(ProjectTriggerRepository)({
        ...baseRepository,
        claimDueRuns: () => Effect.succeed([claimed]),
        getTriggerById: () => Effect.succeed(Option.some(trigger)),
        markRunStarting: () => Effect.succeed(false),
        getRunById: () => Effect.succeed(Option.some(cancelled)),
      }),
    );

    return Effect.gen(function* () {
      const scheduler = yield* ProjectTriggerScheduler;
      const result = yield* scheduler.tick;

      assert.deepStrictEqual(
        dispatched.map((command) => command.type),
        ["thread.turn.start", "thread.turn.interrupt"],
      );
      const startCommand = dispatched[0];
      assert.equal(startCommand?.type, "thread.turn.start");
      if (startCommand?.type !== "thread.turn.start") {
        assert.fail("Expected the trigger scheduler to dispatch a thread turn.");
      }
      assert.deepStrictEqual(startCommand.modelSelection, trigger.modelSelection);
      assert.equal(startCommand.bootstrap?.createThread?.projectId, trigger.projectId);
      assert.deepStrictEqual(
        startCommand.bootstrap?.createThread?.modelSelection,
        trigger.modelSelection,
      );
      assert.equal(startCommand.bootstrap?.createThread?.interactionMode, trigger.interactionMode);
      assert.strictEqual(result.skippedRuns, 1);
    }).pipe(Effect.provide(ProjectTriggerSchedulerLive().pipe(Layer.provide(dependencies))));
  });
});
