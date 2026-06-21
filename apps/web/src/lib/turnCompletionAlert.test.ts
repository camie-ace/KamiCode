import { describe, expect, it } from "vite-plus/test";

import {
  collectSettledCompletedTurns,
  type CompletionAlertThread,
  getTurnCompletionAlertVolume,
  isApplicationInFocus,
  TURN_COMPLETION_ALERT_DURATION_MS,
  TURN_COMPLETION_ALERT_INITIAL_VOLUME,
  TURN_COMPLETION_ALERT_MAX_VOLUME,
  turnCompletionAlertKey,
} from "./turnCompletionAlert";

function makeThread(input: {
  threadId: string;
  turn: {
    turnId: string;
    state: "running" | "interrupted" | "completed" | "error";
    completedAt: string | null;
  } | null;
  session?: {
    status?: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
    activeTurnId?: string | undefined;
  } | null;
}): CompletionAlertThread {
  const threadId = input.threadId as CompletionAlertThread["id"];
  const session =
    input.session === undefined
      ? {
          status: "ready" as const,
          activeTurnId: undefined,
        }
      : input.session;

  return {
    environmentId: "env-1" as CompletionAlertThread["environmentId"],
    id: threadId,
    latestTurn: input.turn
      ? {
          turnId: input.turn.turnId as never,
          state: input.turn.state,
          requestedAt: "2026-06-03T10:00:00.000Z",
          startedAt: "2026-06-03T10:00:01.000Z",
          completedAt: input.turn.completedAt,
          assistantMessageId: null,
        }
      : null,
    session: session
      ? {
          threadId,
          status: session.status ?? "ready",
          providerName: "codex",
          providerInstanceId: "codex" as never,
          runtimeMode: "full-access",
          activeTurnId: session.activeTurnId as never,
          lastError: null,
          updatedAt: "2026-06-03T10:01:00.000Z",
        }
      : null,
  };
}

describe("collectSettledCompletedTurns", () => {
  it("detects a settled completed turn from the current snapshot", () => {
    const threads = [
      makeThread({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    ];

    expect(collectSettledCompletedTurns(threads)).toEqual([
      {
        environmentId: "env-1",
        threadId: "thread-1",
        turnId: "turn-1",
        completedAt: "2026-06-03T10:01:00.000Z",
      },
    ]);
  });

  it("does not report a completed turn while its session is still working", () => {
    const threads = [
      makeThread({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
        session: {
          status: "running",
          activeTurnId: "turn-1",
        },
      }),
    ];

    expect(collectSettledCompletedTurns(threads)).toEqual([]);
  });

  it("can filter out historical completions by completion timestamp", () => {
    const threads = [
      makeThread({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    ];

    expect(
      collectSettledCompletedTurns(threads, {
        completedAfterEpochMs: Date.parse("2026-06-03T10:01:01.000Z"),
      }),
    ).toEqual([]);
    expect(
      collectSettledCompletedTurns(threads, {
        completedAfterEpochMs: Date.parse("2026-06-03T10:01:00.000Z"),
      }),
    ).toEqual([
      {
        environmentId: "env-1",
        threadId: "thread-1",
        turnId: "turn-1",
        completedAt: "2026-06-03T10:01:00.000Z",
      },
    ]);
  });
});

describe("turn completion alert helpers", () => {
  it("builds a stable alert key from the environment, thread, turn, and completion time", () => {
    expect(
      turnCompletionAlertKey({
        environmentId: "env-1" as never,
        threadId: "thread-1" as never,
        turnId: "turn-1" as never,
        completedAt: "2026-06-03T10:01:00.000Z",
      }),
    ).toBe("env-1:thread-1:turn-1:2026-06-03T10:01:00.000Z");
  });

  it("reports application focus only when the document is visible and focused", () => {
    expect(
      isApplicationInFocus({
        visibilityState: "visible",
        hasFocus: () => true,
      }),
    ).toBe(true);
    expect(
      isApplicationInFocus({
        visibilityState: "hidden",
        hasFocus: () => true,
      }),
    ).toBe(false);
    expect(
      isApplicationInFocus({
        visibilityState: "visible",
        hasFocus: () => false,
      }),
    ).toBe(false);
  });

  it("ramps the volume from the initial value to the max value across the alert window", () => {
    expect(getTurnCompletionAlertVolume(0)).toBe(TURN_COMPLETION_ALERT_INITIAL_VOLUME);
    expect(getTurnCompletionAlertVolume(TURN_COMPLETION_ALERT_DURATION_MS)).toBe(
      TURN_COMPLETION_ALERT_MAX_VOLUME,
    );
    expect(getTurnCompletionAlertVolume(TURN_COMPLETION_ALERT_DURATION_MS / 2)).toBeCloseTo(
      (TURN_COMPLETION_ALERT_INITIAL_VOLUME + TURN_COMPLETION_ALERT_MAX_VOLUME) / 2,
      5,
    );
  });
});
