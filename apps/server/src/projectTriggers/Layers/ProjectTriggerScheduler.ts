import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import { ServerOrchestrationDispatcher } from "../../orchestration/Services/ServerOrchestrationDispatcher.ts";
import { makeProjectTriggerRunRow } from "../commands.ts";
import { ProjectTriggerRepository } from "../Services/ProjectTriggerRepository.ts";
import type {
  ProjectTriggerRow,
  ProjectTriggerRunRow,
} from "../Services/ProjectTriggerRepository.ts";
import {
  ProjectTriggerScheduler,
  type ProjectTriggerSchedulerShape,
  type ProjectTriggerSchedulerTickResult,
} from "../Services/ProjectTriggerScheduler.ts";
import { computeProjectTriggerNextFireAt } from "../schedule.ts";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_CLAIM_TTL_MS = 5 * 60_000;
const DEFAULT_TRIGGER_BATCH_SIZE = 50;
const DEFAULT_RUN_BATCH_SIZE = 20;
const DEFAULT_DISPATCH_CONCURRENCY = 4;

export interface ProjectTriggerSchedulerLiveOptions {
  readonly pollIntervalMs?: number;
  readonly claimTtlMs?: number;
  readonly triggerBatchSize?: number;
  readonly runBatchSize?: number;
  readonly dispatchConcurrency?: number;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function addMillisIso(iso: string, millis: number): string {
  return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(iso), { milliseconds: millis }));
}

function countValues<T extends string>(values: ReadonlyArray<T>, target: T): number {
  return values.filter((value) => value === target).length;
}

function failureDetail(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : fallback;
  const trimmed = raw.trim();
  return (trimmed.length > 0 ? trimmed : fallback).slice(0, 2_000);
}

const makeProjectTriggerScheduler = (options?: ProjectTriggerSchedulerLiveOptions) =>
  Effect.gen(function* () {
    const repository = yield* ProjectTriggerRepository;
    const dispatcher = yield* ServerOrchestrationDispatcher;

    const pollIntervalMs = Math.max(1, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const claimTtlMs = Math.max(1, options?.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS);
    const triggerBatchSize = Math.max(1, options?.triggerBatchSize ?? DEFAULT_TRIGGER_BATCH_SIZE);
    const runBatchSize = Math.max(1, options?.runBatchSize ?? DEFAULT_RUN_BATCH_SIZE);
    const dispatchConcurrency = Math.max(
      1,
      options?.dispatchConcurrency ?? DEFAULT_DISPATCH_CONCURRENCY,
    );

    const scheduleClaimedTrigger = Effect.fn("ProjectTriggerScheduler.scheduleClaimedTrigger")(
      function* (trigger: ProjectTriggerRow, scheduledAt: string) {
        if (trigger.nextFireAt === null || trigger.scheduleClaimedAt === null) {
          return "lost-claim";
        }

        const fireAt = trigger.nextFireAt;
        const nextFireAtExit = yield* Effect.exit(
          computeProjectTriggerNextFireAt(trigger, fireAt, "after-fire"),
        );
        if (Exit.isFailure(nextFireAtExit)) {
          const detail = failureDetail(
            nextFireAtExit.cause,
            "Failed to compute the next trigger fire time.",
          );
          yield* repository
            .markTriggerScheduleFailed({
              triggerId: trigger.triggerId,
              claimedAt: trigger.scheduleClaimedAt,
              failedAt: scheduledAt,
              failureDetail: detail,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          yield* Effect.logWarning("project trigger schedule failed", {
            triggerId: trigger.triggerId,
            detail,
          });
          return "schedule-failed";
        }

        const scheduled = yield* repository.scheduleRunForClaimedTrigger({
          triggerId: trigger.triggerId,
          claimedAt: trigger.scheduleClaimedAt,
          fireAt,
          scheduledAt,
          nextFireAt: nextFireAtExit.value,
          run: makeProjectTriggerRunRow({
            trigger,
            fireAt,
            queuedAt: scheduledAt,
          }),
        });
        return scheduled ? "scheduled" : "lost-claim";
      },
    );

    const skipRun = (run: ProjectTriggerRunRow, skippedAt: string, skipReason: string) =>
      repository
        .markRunSkipped({
          runId: run.runId,
          skippedAt,
          skipReason,
        })
        .pipe(Effect.map((marked) => (marked ? "skipped" : "lost-claim")));

    const dispatchClaimedRun = Effect.fn("ProjectTriggerScheduler.dispatchClaimedRun")(function* (
      run: ProjectTriggerRunRow,
      dispatchedAt: string,
    ) {
      const trigger = yield* repository.getTriggerById({ triggerId: run.triggerId });
      if (Option.isNone(trigger)) {
        return yield* skipRun(run, dispatchedAt, "Trigger no longer exists.");
      }
      if (!trigger.value.enabled || trigger.value.deletedAt !== null) {
        return yield* skipRun(run, dispatchedAt, "Trigger is disabled or deleted.");
      }

      return yield* dispatcher.dispatch(run.command, { cleanupCreatedThreadOnFailure: false }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            repository
              .markRunFailed({
                runId: run.runId,
                failedAt: dispatchedAt,
                failureDetail: failureDetail(error, "Trigger dispatch failed."),
              })
              .pipe(Effect.map((marked) => (marked ? "failed" : "lost-claim"))),
          onSuccess: (result) =>
            repository
              .markRunDispatched({
                runId: run.runId,
                dispatchedAt,
                resultSequence: result.sequence,
              })
              .pipe(Effect.map((marked) => (marked ? "dispatched" : "lost-claim"))),
        }),
      );
    });

    const runTick = Effect.gen(function* () {
      const now = yield* nowIso;
      const claimExpiresAt = addMillisIso(now, claimTtlMs);

      const recoveredTriggerClaims = yield* repository.recoverExpiredTriggerClaims({ now });
      const recoveredRunClaims = yield* repository.recoverExpiredRunClaims({ now });

      const claimedTriggers = yield* repository.claimDueTriggers({
        now,
        claimExpiresAt,
        limit: triggerBatchSize,
      });
      const scheduleOutcomes = yield* Effect.forEach(
        claimedTriggers,
        (trigger) => scheduleClaimedTrigger(trigger, now),
        { concurrency: 1 },
      );

      const claimedRuns = yield* repository.claimDueRuns({
        now,
        claimExpiresAt,
        limit: runBatchSize,
      });
      const dispatchOutcomes = yield* Effect.forEach(
        claimedRuns,
        (run) => dispatchClaimedRun(run, now),
        { concurrency: dispatchConcurrency },
      );

      return {
        recoveredTriggerClaims,
        recoveredRunClaims,
        claimedTriggers: claimedTriggers.length,
        scheduledRuns: countValues(scheduleOutcomes, "scheduled"),
        scheduleFailures: countValues(scheduleOutcomes, "schedule-failed"),
        claimedRuns: claimedRuns.length,
        dispatchedRuns: countValues(dispatchOutcomes, "dispatched"),
        failedRuns: countValues(dispatchOutcomes, "failed"),
        skippedRuns: countValues(dispatchOutcomes, "skipped"),
      } satisfies ProjectTriggerSchedulerTickResult;
    });

    const emptyTickResult: ProjectTriggerSchedulerTickResult = {
      recoveredTriggerClaims: 0,
      recoveredRunClaims: 0,
      claimedTriggers: 0,
      scheduledRuns: 0,
      scheduleFailures: 0,
      claimedRuns: 0,
      dispatchedRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    };

    const tick = runTick.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("project trigger scheduler tick failed", {
          detail: failureDetail(cause, "Unexpected scheduler failure."),
        }).pipe(Effect.as(emptyTickResult)),
      ),
    );

    const start: ProjectTriggerSchedulerShape["start"] = () =>
      tick.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(pollIntervalMs))),
        Effect.asVoid,
        Effect.forkScoped,
        Effect.asVoid,
      );

    return {
      tick,
      start,
    } satisfies ProjectTriggerSchedulerShape;
  });

export const ProjectTriggerSchedulerLive = (options?: ProjectTriggerSchedulerLiveOptions) =>
  Layer.effect(ProjectTriggerScheduler, makeProjectTriggerScheduler(options));
