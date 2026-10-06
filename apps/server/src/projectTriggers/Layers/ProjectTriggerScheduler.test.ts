import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ServerOrchestrationDispatcher } from "../../orchestration-v2/Services/ServerOrchestrationDispatcher.ts";
import { makeProjectTriggerRunRow } from "../commands.ts";
import {
  ProjectTriggerId,
  ProjectTriggerRepository,
  type ProjectTriggerRow,
} from "../Services/ProjectTriggerRepository.ts";
import { ProjectTriggerScheduler } from "../Services/ProjectTriggerScheduler.ts";
import { ProjectTriggerSchedulerLive } from "./ProjectTriggerScheduler.ts";

it.effect("preserves same-thread queue order while a different thread can dispatch", () =>
  Effect.gen(function* () {
    const otherStarted = yield* Deferred.make<void>();
    const observed: string[] = [];
    const trigger = (name: string, thread: string): ProjectTriggerRow => ({
      triggerId: ProjectTriggerId.make(name),
      projectId: ProjectId.make("project"),
      name,
      description: null,
      enabled: true,
      scheduleKind: "once",
      scheduleCron: null,
      scheduleOnceAt: "2026-01-01T00:00:00.000Z",
      timezone: "UTC",
      runtimeTarget: "local",
      targetThreadId: ThreadId.make(thread),
      createdBy: null,
      disabledReason: null,
      nextFireAt: null,
      lastFireAt: null,
      prompt: name,
      attachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      dispatchPolicy: "queue",
      titleSeed: null,
      bootstrap: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      scheduleClaimedAt: null,
      scheduleClaimExpiresAt: null,
      failureDetail: null,
    });
    const triggers = [
      trigger("first", "same"),
      trigger("second", "same"),
      trigger("other", "different"),
    ];
    const runs = triggers.map((row) =>
      makeProjectTriggerRunRow({ trigger: row, fireAt: row.createdAt, queuedAt: row.createdAt }),
    );
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectTriggerRepository)({
        disableInactiveThreadTargetTriggers: () => Effect.succeed(0),
        recoverExpiredTriggerClaims: () => Effect.succeed(0),
        recoverExpiredRunClaims: () => Effect.succeed(0),
        claimDueTriggers: () => Effect.succeed([]),
        claimDueRuns: () => Effect.succeed(runs),
        getTriggerById: ({ triggerId }) =>
          Effect.succeed(Option.fromNullishOr(triggers.find((row) => row.triggerId === triggerId))),
        markRunDispatched: () => Effect.succeed(true),
      }),
      Layer.succeed(ServerOrchestrationDispatcher, {
        dispatch: (command) =>
          Effect.gen(function* () {
            const name = command.message.text;
            observed.push(`start:${name}`);
            if (name === "first") yield* Deferred.await(otherStarted);
            if (name === "other") yield* Deferred.succeed(otherStarted, undefined);
            observed.push(`finish:${name}`);
            return { sequence: 1 };
          }),
      }),
    );
    const result = yield* Effect.gen(function* () {
      const scheduler = yield* ProjectTriggerScheduler;
      return yield* scheduler.tick;
    }).pipe(
      Effect.provide(
        ProjectTriggerSchedulerLive({ dispatchConcurrency: 4 }).pipe(Layer.provide(dependencies)),
      ),
    );
    assert.equal(result.dispatchedRuns, 3);
    assert.isBelow(observed.indexOf("start:other"), observed.indexOf("finish:first"));
    assert.isBelow(observed.indexOf("finish:first"), observed.indexOf("start:second"));
  }),
);
