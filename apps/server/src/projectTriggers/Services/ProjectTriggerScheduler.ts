import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ProjectTriggerSchedulerTickResult {
  readonly recoveredTriggerClaims: number;
  readonly recoveredRunClaims: number;
  readonly claimedTriggers: number;
  readonly scheduledRuns: number;
  readonly scheduleFailures: number;
  readonly claimedRuns: number;
  readonly dispatchedRuns: number;
  readonly failedRuns: number;
  readonly skippedRuns: number;
}

export interface ProjectTriggerSchedulerShape {
  readonly tick: Effect.Effect<ProjectTriggerSchedulerTickResult>;
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ProjectTriggerScheduler extends Context.Service<
  ProjectTriggerScheduler,
  ProjectTriggerSchedulerShape
>()("t3/projectTriggers/Services/ProjectTriggerScheduler") {}
