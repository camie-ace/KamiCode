import type { EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";

export const TURN_COMPLETION_ALERT_DURATION_MS = 1_500;
export const TURN_COMPLETION_ALERT_VOLUME = 0.2;

export interface CompletedTurnAlert {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId: RunId;
  readonly completedAt: string;
}

interface CollectSettledCompletedTurnOptions {
  readonly completedAfterEpochMs?: number;
}

export interface CompletionAlertThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly latestRun: ThreadRunSummary | null;
  readonly runtime: ThreadRuntimeSummary | null;
}

function getSettledCompletedLatestTurn(thread: CompletionAlertThread) {
  const run = thread.latestRun;
  if (run?.status !== "completed" || run.completedAt === null) return null;
  const runtime = thread.runtime;
  if (
    runtime &&
    (runtime.activeRunId !== null ||
      runtime.status === "preparing" ||
      runtime.status === "starting" ||
      runtime.status === "running" ||
      runtime.status === "waiting")
  )
    return null;
  return { turnId: run.runId, completedAt: run.completedAt };
}

function isCompletedAfterThreshold(
  completedAt: string,
  completedAfterEpochMs: number | undefined,
): boolean {
  if (completedAfterEpochMs === undefined) {
    return true;
  }
  const completedAtEpochMs = Date.parse(completedAt);
  return !Number.isNaN(completedAtEpochMs) && completedAtEpochMs >= completedAfterEpochMs;
}

export function turnCompletionAlertKey(alert: CompletedTurnAlert): string {
  return `${alert.environmentId}:${alert.threadId}:${alert.turnId}:${alert.completedAt}`;
}

export function collectSettledCompletedTurns(
  threads: ReadonlyArray<CompletionAlertThread>,
  options: CollectSettledCompletedTurnOptions = {},
): CompletedTurnAlert[] {
  const alerts: CompletedTurnAlert[] = [];
  for (const thread of threads) {
    const turn = getSettledCompletedLatestTurn(thread);
    if (!turn) {
      continue;
    }
    if (!isCompletedAfterThreshold(turn.completedAt, options.completedAfterEpochMs)) {
      continue;
    }

    alerts.push({
      environmentId: thread.environmentId,
      threadId: thread.id,
      turnId: turn.turnId,
      completedAt: turn.completedAt,
    });
  }
  return alerts;
}

export function isApplicationInFocus(
  input: Pick<Document, "visibilityState" | "hasFocus">,
): boolean {
  return input.visibilityState === "visible" && input.hasFocus();
}
