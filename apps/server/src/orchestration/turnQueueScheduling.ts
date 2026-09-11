export interface SchedulableQueuedTurn {
  readonly scheduledFor: string | null;
}

export function isQueuedTurnDue(turn: SchedulableQueuedTurn, nowMs: number): boolean {
  if (turn.scheduledFor === null) return true;
  const scheduledForMs = Date.parse(turn.scheduledFor);
  // Invalid persisted data must not wedge the rest of a thread's queue.
  return !Number.isFinite(scheduledForMs) || scheduledForMs <= nowMs;
}

export function findNextDueQueuedTurn<T extends SchedulableQueuedTurn>(
  turns: ReadonlyArray<T>,
  nowMs: number,
): T | undefined {
  return turns.find((turn) => isQueuedTurnDue(turn, nowMs));
}
