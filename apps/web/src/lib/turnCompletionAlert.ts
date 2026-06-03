import type { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";

import type { AppState, EnvironmentState } from "../store";
import type { ThreadSession } from "../types";

export const TURN_COMPLETION_ALERT_DURATION_MS = 10_000;
export const TURN_COMPLETION_ALERT_INITIAL_VOLUME = 0.35;
export const TURN_COMPLETION_ALERT_MAX_VOLUME = 0.85;

export interface CompletedTurnAlert {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly completedAt: string;
}

interface CollectSettledCompletedTurnOptions {
  readonly completedAfterEpochMs?: number;
}

type ComparableLatestTurn = {
  readonly turnId: TurnId;
  readonly state: "running" | "interrupted" | "completed" | "error";
  readonly completedAt: string | null;
} | null;

type ComparableThreadSession = Pick<
  ThreadSession,
  "status" | "orchestrationStatus" | "activeTurnId"
> | null;

function getComparableLatestTurn(
  environmentState: EnvironmentState | undefined,
  threadId: ThreadId,
): ComparableLatestTurn {
  const latestTurn = environmentState?.threadTurnStateById[threadId]?.latestTurn;
  if (!latestTurn) {
    return null;
  }
  return {
    turnId: latestTurn.turnId,
    state: latestTurn.state,
    completedAt: latestTurn.completedAt,
  };
}

function getComparableThreadSession(
  environmentState: EnvironmentState | undefined,
  threadId: ThreadId,
): ComparableThreadSession {
  const session = environmentState?.threadSessionById[threadId] ?? null;
  if (!session) {
    return null;
  }
  return {
    status: session.status,
    orchestrationStatus: session.orchestrationStatus,
    activeTurnId: session.activeTurnId,
  };
}

function isCompletedLatestTurn(
  turn: ComparableLatestTurn,
): turn is NonNullable<ComparableLatestTurn> & {
  readonly state: "completed";
  readonly completedAt: string;
} {
  return turn?.state === "completed" && typeof turn.completedAt === "string";
}

function isThreadSessionWorking(session: ComparableThreadSession): boolean {
  if (!session) {
    return false;
  }
  return (
    session.activeTurnId !== undefined ||
    session.status === "connecting" ||
    session.status === "running" ||
    session.orchestrationStatus === "starting" ||
    session.orchestrationStatus === "running"
  );
}

function getSettledCompletedLatestTurn(
  environmentState: EnvironmentState | undefined,
  threadId: ThreadId,
) {
  const turn = getComparableLatestTurn(environmentState, threadId);
  if (!isCompletedLatestTurn(turn)) {
    return null;
  }
  if (isThreadSessionWorking(getComparableThreadSession(environmentState, threadId))) {
    return null;
  }
  return turn;
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
  state: AppState,
  options: CollectSettledCompletedTurnOptions = {},
): CompletedTurnAlert[] {
  const alerts: CompletedTurnAlert[] = [];
  for (const [environmentId, environmentState] of Object.entries(state.environmentStateById)) {
    for (const threadId of Object.keys(environmentState.threadTurnStateById) as ThreadId[]) {
      const turn = getSettledCompletedLatestTurn(environmentState, threadId);
      if (!turn) {
        continue;
      }
      if (!isCompletedAfterThreshold(turn.completedAt, options.completedAfterEpochMs)) {
        continue;
      }

      alerts.push({
        environmentId: environmentId as EnvironmentId,
        threadId,
        turnId: turn.turnId,
        completedAt: turn.completedAt,
      });
    }
  }
  return alerts;
}

export function isApplicationInFocus(
  input: Pick<Document, "visibilityState" | "hasFocus">,
): boolean {
  return input.visibilityState === "visible" && input.hasFocus();
}

export function getTurnCompletionAlertVolume(elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return TURN_COMPLETION_ALERT_INITIAL_VOLUME;
  }
  if (elapsedMs >= TURN_COMPLETION_ALERT_DURATION_MS) {
    return TURN_COMPLETION_ALERT_MAX_VOLUME;
  }

  const progress = elapsedMs / TURN_COMPLETION_ALERT_DURATION_MS;
  return (
    TURN_COMPLETION_ALERT_INITIAL_VOLUME +
    (TURN_COMPLETION_ALERT_MAX_VOLUME - TURN_COMPLETION_ALERT_INITIAL_VOLUME) * progress
  );
}
