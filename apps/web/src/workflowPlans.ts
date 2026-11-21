import type { PlanId, RunId, OrchestrationV2PlanArtifact } from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import * as DateTime from "effect/DateTime";
export interface ActivePlanState {
  readonly createdAt: string;
  readonly runId: RunId | null;
  readonly explanation?: string | null;
  readonly steps: Array<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
    readonly durationMs?: number;
  }>;
}

export interface LatestProposedPlanState {
  readonly id: PlanId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId: RunId | null;
  readonly planMarkdown: string;
  readonly status: OrchestrationV2PlanArtifact["status"];
}

export function deriveActivePlanState(
  projection: ThreadStructure | null,
  latestRunId: RunId | undefined,
): ActivePlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "todo_list");
  const plan =
    [...plans].toReversed().find((candidate) => candidate.runId === latestRunId) ??
    plans.at(-1) ??
    null;
  if (plan === null || plan.steps.length === 0) return null;
  return {
    createdAt: planItemTime(projection, plan.id),
    runId: plan.runId,
    explanation: plan.explanation ?? null,
    steps: plan.steps.map(({ text, status, durationMs }) => ({
      step: text,
      status: status === "running" ? "inProgress" : status,
      ...(durationMs === undefined ? {} : { durationMs }),
    })),
  };
}

function planItemTime(projection: ThreadStructure, planId: PlanId): string {
  const item = projection.turnItems.findLast(
    (candidate) =>
      (candidate.type === "proposed_plan" || candidate.type === "todo_list") &&
      candidate.planId === planId,
  );
  return DateTime.formatIso(
    item && "updatedAt" in item ? item.updatedAt : projection.thread.createdAt,
  );
}

function toLatestProposedPlanState(
  projection: ThreadStructure,
  plan: Extract<OrchestrationV2PlanArtifact, { readonly kind: "proposed_plan" }>,
): LatestProposedPlanState {
  const updatedAt = planItemTime(projection, plan.id);
  return {
    id: plan.id,
    createdAt: updatedAt,
    updatedAt,
    runId: plan.runId,
    planMarkdown: plan.markdown,
    status: plan.status,
  };
}

export function findLatestProposedPlan(
  projection: ThreadStructure | null,
  latestRunId: RunId | string | null | undefined,
): LatestProposedPlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "proposed_plan");
  const candidates = latestRunId ? plans.filter((plan) => plan.runId === latestRunId) : plans;
  const plan = [...(candidates.length > 0 ? candidates : plans)]
    .toSorted(
      (left, right) =>
        planItemTime(projection, left.id).localeCompare(planItemTime(projection, right.id)) ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  return plan === undefined ? null : toLatestProposedPlanState(projection, plan);
}
