import { CommandId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
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
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

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
        .markRunCancelled({
          runId: run.runId,
          cancelledAt: skippedAt,
          cancellationReason: skipReason,
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
              .markRunStarting({
                runId: run.runId,
                dispatchedAt,
                resultSequence: result.sequence,
              })
              .pipe(
                Effect.flatMap((marked) => {
                  if (marked) return Effect.succeed("dispatched" as const);
                  return repository.getRunById({ runId: run.runId }).pipe(
                    Effect.flatMap((current) => {
                      if (Option.isNone(current) || current.value.status === "queued") {
                        return Effect.succeed("lost-claim" as const);
                      }
                      if (current.value.status !== "cancelled") {
                        return Effect.succeed(
                          current.value.status === "starting" || current.value.status === "running"
                            ? ("dispatched" as const)
                            : ("lost-claim" as const),
                        );
                      }
                      // Cancellation can win while dispatch is in flight. Once
                      // the start command has been accepted, interrupt the same
                      // thread so a cancelled run never keeps executing unseen.
                      return dispatcher
                        .dispatch({
                          type: "thread.turn.interrupt",
                          commandId: CommandId.make(
                            `project-trigger:${run.runId}:cancel-after-dispatch`,
                          ),
                          threadId: run.threadId,
                          createdAt: dispatchedAt,
                        })
                        .pipe(Effect.ignoreCause({ log: true }), Effect.as("skipped" as const));
                    }),
                  );
                }),
              ),
        }),
      );
    });

    const applyThreadSessionLifecycle = (input: {
      readonly threadId: ProjectTriggerRunRow["threadId"];
      readonly status:
        | "idle"
        | "starting"
        | "running"
        | "ready"
        | "interrupted"
        | "stopped"
        | "error";
      readonly activeTurnId: string | null;
      readonly lastError: string | null;
      readonly updatedAt: string;
    }) => {
      switch (input.status) {
        case "running":
          return input.activeTurnId === null
            ? Effect.void
            : repository
                .markRunRunning({
                  threadId: input.threadId,
                  startedAt: input.updatedAt,
                })
                .pipe(Effect.asVoid);
        case "ready":
          return repository
            .markRunSucceeded({
              threadId: input.threadId,
              completedAt: input.updatedAt,
            })
            .pipe(Effect.asVoid);
        case "error":
          return repository
            .settleRunByThread({
              threadId: input.threadId,
              completedAt: input.updatedAt,
              status: "failed",
              detail: failureDetail(input.lastError, "Trigger turn failed."),
            })
            .pipe(Effect.asVoid);
        case "interrupted":
        case "stopped":
          return repository
            .settleRunByThread({
              threadId: input.threadId,
              completedAt: input.updatedAt,
              status: "cancelled",
              detail:
                input.status === "interrupted"
                  ? "Trigger turn was interrupted."
                  : "Trigger session stopped.",
            })
            .pipe(Effect.asVoid);
        case "idle":
        case "starting":
          return Effect.void;
      }
    };

    const reconcileActiveRuns = (now: string) =>
      repository.listActiveRuns({ limit: 200 }).pipe(
        Effect.flatMap((runs) =>
          Effect.forEach(
            runs,
            (run) => {
              if (run.status === "queued") return Effect.void;
              return projectionSnapshotQuery.getThreadDetailById(run.threadId).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => {
                      if (
                        run.dispatchedAt !== null &&
                        Date.parse(run.dispatchedAt) + claimTtlMs <= Date.parse(now)
                      ) {
                        return repository
                          .markRunFailed({
                            runId: run.runId,
                            failedAt: now,
                            failureDetail: "Trigger thread was not found after dispatch.",
                          })
                          .pipe(Effect.asVoid);
                      }
                      return Effect.void;
                    },
                    onSome: (thread) => {
                      const latestTurn = thread.latestTurn;
                      if (latestTurn?.state === "running") {
                        return repository
                          .markRunRunning({
                            threadId: run.threadId,
                            startedAt: latestTurn.startedAt ?? thread.updatedAt,
                          })
                          .pipe(Effect.asVoid);
                      }
                      if (latestTurn?.state === "completed") {
                        return repository
                          .markRunRunning({
                            threadId: run.threadId,
                            startedAt: latestTurn.startedAt ?? thread.updatedAt,
                          })
                          .pipe(
                            Effect.flatMap(() =>
                              repository.markRunSucceeded({
                                threadId: run.threadId,
                                completedAt: latestTurn.completedAt ?? thread.updatedAt,
                              }),
                            ),
                            Effect.asVoid,
                          );
                      }
                      if (latestTurn?.state === "error") {
                        return repository
                          .settleRunByThread({
                            threadId: run.threadId,
                            completedAt: latestTurn.completedAt ?? thread.updatedAt,
                            status: "failed",
                            detail: failureDetail(
                              thread.session?.lastError,
                              "Trigger turn failed.",
                            ),
                          })
                          .pipe(Effect.asVoid);
                      }
                      if (latestTurn?.state === "interrupted") {
                        return repository
                          .settleRunByThread({
                            threadId: run.threadId,
                            completedAt: latestTurn.completedAt ?? thread.updatedAt,
                            status: "cancelled",
                            detail: "Trigger turn was interrupted.",
                          })
                          .pipe(Effect.asVoid);
                      }
                      return thread.session === null
                        ? Effect.void
                        : applyThreadSessionLifecycle(thread.session);
                    },
                  }),
                ),
              );
            },
            { concurrency: dispatchConcurrency, discard: true },
          ),
        ),
      );

    const lifecycleConsumer = orchestrationEngine.streamDomainEvents.pipe(
      Stream.filter((event) => event.type === "thread.session-set"),
      Stream.runForEach((event) =>
        event.type === "thread.session-set"
          ? applyThreadSessionLifecycle(event.payload.session).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("project trigger lifecycle update failed", {
                  threadId: event.payload.threadId,
                  cause,
                }),
              ),
            )
          : Effect.void,
      ),
    );

    const runTick = Effect.gen(function* () {
      const now = yield* nowIso;
      const claimExpiresAt = addMillisIso(now, claimTtlMs);

      yield* reconcileActiveRuns(now);

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
      Effect.all(
        [
          tick.pipe(
            Effect.repeat(Schedule.spaced(Duration.millis(pollIntervalMs))),
            Effect.asVoid,
            Effect.forkScoped,
          ),
          lifecycleConsumer.pipe(Effect.forkScoped),
        ],
        { discard: true },
      );

    return {
      tick,
      start,
    } satisfies ProjectTriggerSchedulerShape;
  });

export const ProjectTriggerSchedulerLive = (options?: ProjectTriggerSchedulerLiveOptions) =>
  Layer.effect(ProjectTriggerScheduler, makeProjectTriggerScheduler(options));
