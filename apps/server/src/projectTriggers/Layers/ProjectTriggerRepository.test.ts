import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { makeProjectTriggerRunRow } from "../commands.ts";
import {
  ProjectTriggerId,
  ProjectTriggerRepository,
} from "../Services/ProjectTriggerRepository.ts";
import { ProjectTriggerRepositoryLive } from "./ProjectTriggerRepository.ts";

const layer = it.layer(
  ProjectTriggerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectTriggerRepository", (it) => {
  it.effect(
    "claims a run and advances it only from dispatch through observed thread completion",
    () =>
      Effect.gen(function* () {
        const repository = yield* ProjectTriggerRepository;

        const triggerId = ProjectTriggerId.make("trigger-nightly-checks");
        yield* repository.upsertTrigger({
          triggerId,
          projectId: ProjectId.make("project-triggers"),
          name: "Nightly checks",
          description: null,
          enabled: true,
          scheduleKind: "once",
          scheduleCron: null,
          scheduleOnceAt: "2026-03-24T00:00:00.000Z",
          timezone: "UTC",
          runtimeTarget: "local",
          webhookPublicId: "webhook-nightly-checks",
          webhookSecretVersion: 0,
          nextFireAt: "2026-03-24T00:00:00.000Z",
          lastFireAt: null,
          prompt: "Run the nightly checks.",
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
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
          deletedAt: null,
          scheduleClaimedAt: null,
          scheduleClaimExpiresAt: null,
          failureDetail: null,
        });

        const claimedTriggers = yield* repository.claimDueTriggers({
          now: "2026-03-24T00:00:01.000Z",
          claimExpiresAt: "2026-03-24T00:05:01.000Z",
          limit: 10,
        });
        assert.strictEqual(claimedTriggers.length, 1);
        const claimedTrigger = claimedTriggers[0];
        if (!claimedTrigger) {
          return yield* Effect.die("Expected one claimed project trigger.");
        }
        assert.strictEqual(claimedTrigger.scheduleClaimedAt, "2026-03-24T00:00:01.000Z");

        const run = makeProjectTriggerRunRow({
          trigger: claimedTrigger,
          fireAt: "2026-03-24T00:00:00.000Z",
          queuedAt: "2026-03-24T00:00:01.000Z",
        });
        const repeatedRun = makeProjectTriggerRunRow({
          trigger: claimedTrigger,
          fireAt: "2026-03-24T00:00:00.000Z",
          queuedAt: "2026-03-24T00:00:01.000Z",
        });
        assert.strictEqual(repeatedRun.runId, run.runId);
        assert.strictEqual(repeatedRun.messageId, run.messageId);
        assert.isAtMost(run.runId.length, 100);

        const scheduled = yield* repository.scheduleRunForClaimedTrigger({
          triggerId,
          claimedAt: "2026-03-24T00:00:01.000Z",
          fireAt: "2026-03-24T00:00:00.000Z",
          scheduledAt: "2026-03-24T00:00:01.000Z",
          nextFireAt: null,
          run,
        });
        assert.strictEqual(scheduled, true);

        const queuedRun = yield* repository.getRunById({ runId: run.runId });
        assert.strictEqual(Option.getOrThrow(queuedRun).status, "queued");

        const claimedRuns = yield* repository.claimDueRuns({
          now: "2026-03-24T00:00:02.000Z",
          claimExpiresAt: "2026-03-24T00:00:03.000Z",
          limit: 10,
        });
        assert.strictEqual(claimedRuns.length, 1);
        assert.strictEqual(claimedRuns[0]?.status, "starting");

        const recovered = yield* repository.recoverExpiredRunClaims({
          now: "2026-03-24T00:00:04.000Z",
        });
        assert.strictEqual(recovered, 1);

        const reclaimedRuns = yield* repository.claimDueRuns({
          now: "2026-03-24T00:00:05.000Z",
          claimExpiresAt: "2026-03-24T00:05:05.000Z",
          limit: 10,
        });
        assert.strictEqual(reclaimedRuns.length, 1);

        const dispatched = yield* repository.markRunStarting({
          runId: run.runId,
          dispatchedAt: "2026-03-24T00:00:06.000Z",
          resultSequence: 42,
        });
        assert.strictEqual(dispatched, true);

        const dispatchedRun = yield* repository.getRunById({ runId: run.runId });
        assert.strictEqual(Option.getOrThrow(dispatchedRun).status, "starting");
        assert.strictEqual(Option.getOrThrow(dispatchedRun).resultSequence, 42);

        const running = yield* repository.markRunRunning({
          threadId: run.threadId,
          startedAt: "2026-03-24T00:00:07.000Z",
        });
        assert.strictEqual(running, true);
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getRunById({ runId: run.runId })).status,
          "running",
        );

        const succeeded = yield* repository.markRunSucceeded({
          threadId: run.threadId,
          completedAt: "2026-03-24T00:00:08.000Z",
        });
        assert.strictEqual(succeeded, true);
        assert.strictEqual(
          Option.getOrThrow(yield* repository.getRunById({ runId: run.runId })).status,
          "succeeded",
        );
      }),
  );

  it.effect("atomically enforces webhook idempotency, nonce replay, and secret rotation", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectTriggerRepository;
      const triggerId = ProjectTriggerId.make("trigger-webhook-security");
      const trigger = {
        triggerId,
        projectId: ProjectId.make("project-webhook-security"),
        name: "Webhook security",
        description: null,
        enabled: true,
        scheduleKind: "manual" as const,
        scheduleCron: null,
        scheduleOnceAt: null,
        timezone: "UTC",
        runtimeTarget: "local" as const,
        webhookPublicId: "public-webhook-security",
        webhookSecretVersion: 0,
        nextFireAt: null,
        lastFireAt: null,
        prompt: "Review the event.",
        attachments: [],
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        dispatchPolicy: null,
        titleSeed: null,
        bootstrap: null,
        createdAt: "2026-07-19T19:00:00.000Z",
        updatedAt: "2026-07-19T19:00:00.000Z",
        deletedAt: null,
        scheduleClaimedAt: null,
        scheduleClaimExpiresAt: null,
        failureDetail: null,
      };
      yield* repository.upsertTrigger(trigger);

      const firstVersion = yield* repository.rotateWebhookSecretVersion({
        triggerId,
        updatedAt: "2026-07-19T19:00:01.000Z",
      });
      const secondVersion = yield* repository.rotateWebhookSecretVersion({
        triggerId,
        updatedAt: "2026-07-19T19:00:02.000Z",
      });
      assert.strictEqual(Option.getOrThrow(firstVersion), 1);
      assert.strictEqual(Option.getOrThrow(secondVersion), 2);

      const idempotencyKey = "delivery-42";
      const run = {
        ...makeProjectTriggerRunRow({
          trigger,
          fireAt: "2026-07-19T19:01:00.000Z",
          queuedAt: "2026-07-19T19:01:00.000Z",
          initiator: "webhook",
          eventKind: "webhook",
          event: { payload: { ref: "refs/heads/main" } },
          idempotencyKey,
          requestDigest: "digest-a",
          runKey: "delivery-42",
        }),
        idempotencyKey,
      };
      const intake = {
        run,
        nonce: "nonce-0123456789abcdef",
        requestDigest: "digest-a",
        receivedAt: "2026-07-19T19:01:00.000Z",
        expiresAt: "2026-07-20T19:01:00.000Z",
      };

      const inserted = yield* repository.acceptWebhookRun(intake);
      assert.strictEqual(inserted.outcome, "inserted");
      const existing = yield* repository.acceptWebhookRun({
        ...intake,
        nonce: "nonce-fedcba9876543210",
      });
      assert.strictEqual(existing.outcome, "existing");
      if (existing.outcome === "existing") {
        assert.strictEqual(existing.run.runId, run.runId);
      }
      const conflict = yield* repository.acceptWebhookRun({
        ...intake,
        requestDigest: "digest-b",
      });
      assert.strictEqual(conflict.outcome, "idempotency-conflict");

      const replayKey = "delivery-43";
      const replayRun = {
        ...makeProjectTriggerRunRow({
          trigger,
          fireAt: "2026-07-19T19:02:00.000Z",
          queuedAt: "2026-07-19T19:02:00.000Z",
          initiator: "webhook",
          eventKind: "webhook",
          idempotencyKey: replayKey,
          requestDigest: "digest-c",
          runKey: "delivery-43",
        }),
        idempotencyKey: replayKey,
      };
      const replay = yield* repository.acceptWebhookRun({
        ...intake,
        run: replayRun,
        requestDigest: "digest-c",
      });
      assert.strictEqual(replay.outcome, "replay");

      const expiredReceiptReplay = yield* repository.acceptWebhookRun({
        ...intake,
        nonce: "nonce-after-expiry-012345",
        receivedAt: "2026-07-20T19:01:01.000Z",
        expiresAt: "2026-07-21T19:01:01.000Z",
      });
      assert.strictEqual(expiredReceiptReplay.outcome, "existing");
      if (expiredReceiptReplay.outcome === "existing") {
        assert.strictEqual(expiredReceiptReplay.run.runId, run.runId);
      }

      const operation = {
        triggerId,
        runId: run.runId,
        idempotencyKey: `cancel:${run.runId}:request-1`,
        nonce: "cancel-nonce-0123456789",
        requestDigest: "cancel-digest-a",
        receivedAt: "2026-07-19T19:03:00.000Z",
        expiresAt: "2026-07-20T19:03:00.000Z",
      };
      assert.strictEqual((yield* repository.recordWebhookOperation(operation)).outcome, "inserted");
      assert.strictEqual(
        (yield* repository.recordWebhookOperation({
          ...operation,
          nonce: "cancel-nonce-9876543210",
        })).outcome,
        "existing",
      );
      assert.strictEqual(
        (yield* repository.recordWebhookOperation({
          ...operation,
          requestDigest: "cancel-digest-b",
        })).outcome,
        "idempotency-conflict",
      );
      assert.strictEqual(
        (yield* repository.recordWebhookOperation({
          ...operation,
          idempotencyKey: `cancel:${run.runId}:request-2`,
        })).outcome,
        "replay",
      );
    }),
  );

  it.effect("claims one hundred due runs once and recovers expired claims", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectTriggerRepository;
      const projectId = ProjectId.make("project-trigger-benchmark");
      const dueAt = "2026-03-24T00:00:00.000Z";
      const claimStartedAt = "2026-03-24T00:00:01.000Z";
      const claimExpiresAt = "2026-03-24T00:05:01.000Z";

      for (let index = 0; index < 100; index += 1) {
        const suffix = String(index).padStart(3, "0");
        yield* repository.upsertTrigger({
          triggerId: ProjectTriggerId.make(`trigger-benchmark-${suffix}`),
          projectId,
          name: `Benchmark trigger ${suffix}`,
          description: null,
          enabled: true,
          scheduleKind: "once",
          scheduleCron: null,
          scheduleOnceAt: dueAt,
          timezone: "UTC",
          runtimeTarget: "local",
          webhookPublicId: `webhook-benchmark-${suffix}`,
          webhookSecretVersion: 0,
          nextFireAt: dueAt,
          lastFireAt: null,
          prompt: "Run the benchmark trigger.",
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
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
          deletedAt: null,
          scheduleClaimedAt: null,
          scheduleClaimExpiresAt: null,
          failureDetail: null,
        });
      }

      const claimedTriggers = yield* repository.claimDueTriggers({
        now: claimStartedAt,
        claimExpiresAt,
        limit: 100,
      });
      assert.strictEqual(claimedTriggers.length, 100);

      const secondTriggerClaim = yield* repository.claimDueTriggers({
        now: "2026-03-24T00:00:02.000Z",
        claimExpiresAt: "2026-03-24T00:05:02.000Z",
        limit: 100,
      });
      assert.strictEqual(secondTriggerClaim.length, 0);

      for (const trigger of claimedTriggers) {
        const run = makeProjectTriggerRunRow({
          trigger,
          fireAt: dueAt,
          queuedAt: claimStartedAt,
        });
        const scheduled = yield* repository.scheduleRunForClaimedTrigger({
          triggerId: trigger.triggerId,
          claimedAt: claimStartedAt,
          fireAt: dueAt,
          scheduledAt: claimStartedAt,
          nextFireAt: null,
          run,
        });
        assert.strictEqual(scheduled, true);

        const duplicateSchedule = yield* repository.scheduleRunForClaimedTrigger({
          triggerId: trigger.triggerId,
          claimedAt: claimStartedAt,
          fireAt: dueAt,
          scheduledAt: "2026-03-24T00:00:02.000Z",
          nextFireAt: null,
          run,
        });
        assert.strictEqual(duplicateSchedule, false);
      }

      const firstRunClaim = yield* repository.claimDueRuns({
        now: "2026-03-24T00:00:03.000Z",
        claimExpiresAt: "2026-03-24T00:00:04.000Z",
        limit: 100,
      });
      assert.strictEqual(firstRunClaim.length, 100);

      const secondRunClaim = yield* repository.claimDueRuns({
        now: "2026-03-24T00:00:03.500Z",
        claimExpiresAt: "2026-03-24T00:00:04.500Z",
        limit: 100,
      });
      assert.strictEqual(secondRunClaim.length, 0);

      const recovered = yield* repository.recoverExpiredRunClaims({
        now: "2026-03-24T00:00:05.000Z",
      });
      assert.strictEqual(recovered, 100);

      const recoveredRunClaim = yield* repository.claimDueRuns({
        now: "2026-03-24T00:00:06.000Z",
        claimExpiresAt: "2026-03-24T00:05:06.000Z",
        limit: 100,
      });
      assert.strictEqual(recoveredRunClaim.length, 100);

      const firstRun = recoveredRunClaim[0];
      if (!firstRun) {
        return yield* Effect.die("Expected recovered project trigger runs.");
      }
      const listedRuns = yield* repository.listRunsByTriggerId({
        triggerId: firstRun.triggerId,
        limit: 10,
      });
      assert.strictEqual(listedRuns.length, 1);
      assert.strictEqual(listedRuns[0]?.runId, firstRun.runId);
    }),
  );
});
