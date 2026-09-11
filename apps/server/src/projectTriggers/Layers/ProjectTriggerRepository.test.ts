import { MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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
    "claims due triggers, schedules a run, recovers an expired run claim, and marks dispatch",
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
          targetThreadId: null,
          createdBy: null,
          disabledReason: null,
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
        assert.strictEqual(
          run.messageId,
          MessageId.make("project-trigger:trigger-nightly-checks:2026-03-24T00:00:00.000Z:message"),
        );

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
        assert.strictEqual(claimedRuns[0]?.status, "claimed");

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

        const dispatched = yield* repository.markRunDispatched({
          runId: run.runId,
          dispatchedAt: "2026-03-24T00:00:06.000Z",
          resultSequence: 42,
        });
        assert.strictEqual(dispatched, true);

        const dispatchedRun = yield* repository.getRunById({ runId: run.runId });
        assert.strictEqual(Option.getOrThrow(dispatchedRun).status, "dispatched");
        assert.strictEqual(Option.getOrThrow(dispatchedRun).resultSequence, 42);
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
          targetThreadId: null,
          createdBy: null,
          disabledReason: null,
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

  it.effect("disables thread schedules when their thread is settled or otherwise inactive", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectTriggerRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-thread-lifecycle");
      const activeThreadId = ThreadId.make("thread-active");
      const settledThreadId = ThreadId.make("thread-settled");
      const autoSettledThreadId = ThreadId.make("thread-auto-settled");
      const archivedThreadId = ThreadId.make("thread-archived");
      const deletedThreadId = ThreadId.make("thread-deleted");
      const missingThreadId = ThreadId.make("thread-missing");

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, created_at, updated_at,
          deleted_at, archived_at, settled_override, settled_at
        ) VALUES
          (${activeThreadId}, ${projectId}, 'Active', NULL, '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', NULL, NULL, NULL, NULL),
          (${settledThreadId}, ${projectId}, 'Settled', NULL, '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', NULL, NULL, 'settled', '2026-09-11T10:00:00.000Z'),
          (${autoSettledThreadId}, ${projectId}, 'Auto settled', NULL, '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', NULL, NULL, NULL, '2026-09-11T10:00:00.000Z'),
          (${archivedThreadId}, ${projectId}, 'Archived', NULL, '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', NULL, '2026-09-11T10:00:00.000Z', NULL, NULL),
          (${deletedThreadId}, ${projectId}, 'Deleted', NULL, '2026-09-11T09:00:00.000Z', '2026-09-11T09:00:00.000Z', '2026-09-11T10:00:00.000Z', NULL, NULL, NULL)
      `;

      const makeTrigger = (name: string, targetThreadId: ThreadId) => ({
        triggerId: ProjectTriggerId.make(`trigger-${name}`),
        projectId,
        name,
        description: null,
        enabled: true,
        scheduleKind: "cron" as const,
        scheduleCron: "0 9 * * *",
        scheduleOnceAt: null,
        timezone: "UTC",
        runtimeTarget: "local" as const,
        targetThreadId,
        createdBy: null,
        disabledReason: null,
        nextFireAt: "2026-09-12T09:00:00.000Z",
        lastFireAt: null,
        prompt: "Run the recurring message.",
        attachments: [],
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        dispatchPolicy: "queue" as const,
        titleSeed: null,
        bootstrap: null,
        createdAt: "2026-09-11T09:00:00.000Z",
        updatedAt: "2026-09-11T09:00:00.000Z",
        deletedAt: null,
        scheduleClaimedAt: null,
        scheduleClaimExpiresAt: null,
        failureDetail: null,
      });

      for (const [name, threadId] of [
        ["active", activeThreadId],
        ["settled", settledThreadId],
        ["auto-settled", autoSettledThreadId],
        ["archived", archivedThreadId],
        ["deleted", deletedThreadId],
        ["missing", missingThreadId],
      ] as const) {
        yield* repository.upsertTrigger(makeTrigger(name, threadId));
      }
      yield* repository.upsertTrigger({
        ...makeTrigger("paused-before-settlement", settledThreadId),
        enabled: false,
        nextFireAt: null,
      });

      const disabled = yield* repository.disableInactiveThreadTargetTriggers({
        now: "2026-09-11T10:00:01.000Z",
      });
      assert.strictEqual(disabled, 6);

      const rows = yield* repository.listTriggersByProjectId({ projectId });
      const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
      assert.strictEqual(byName.active?.enabled, true);
      assert.strictEqual(byName.active?.disabledReason, null);
      assert.strictEqual(byName.settled?.enabled, false);
      assert.strictEqual(byName.settled?.disabledReason, "thread-settled");
      assert.strictEqual(byName["paused-before-settlement"]?.disabledReason, "thread-settled");
      assert.strictEqual(byName["auto-settled"]?.disabledReason, "thread-settled");
      assert.strictEqual(byName.archived?.disabledReason, "thread-archived");
      assert.strictEqual(byName.deleted?.disabledReason, "thread-deleted");
      assert.strictEqual(byName.missing?.disabledReason, "thread-missing");
      assert.strictEqual(byName.settled?.nextFireAt, null);
    }),
  );
});
