import { describe, expect, it } from "vitest";

import type { AppState, EnvironmentState } from "../store";
import {
  collectNewlyCompletedTurns,
  getTurnCompletionAlertVolume,
  isApplicationInFocus,
  TURN_COMPLETION_ALERT_DURATION_MS,
  TURN_COMPLETION_ALERT_INITIAL_VOLUME,
  TURN_COMPLETION_ALERT_MAX_VOLUME,
} from "./turnCompletionAlert";

function makeEnvironmentState(input: {
  threadId: string;
  turn: {
    turnId: string;
    state: "running" | "interrupted" | "completed" | "error";
    completedAt: string | null;
  } | null;
}): EnvironmentState {
  return {
    projectIds: [],
    projectById: {},
    threadIds: [input.threadId as never],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {
      [input.threadId]: {
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
      },
    },
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: {},
    bootstrapComplete: true,
  };
}

function makeState(environmentState: EnvironmentState): AppState {
  return {
    activeEnvironmentId: "env-1" as never,
    environmentStateById: {
      "env-1": environmentState,
    },
  };
}

describe("collectNewlyCompletedTurns", () => {
  it("detects when the same turn transitions to completed", () => {
    const previousState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "running",
          completedAt: null,
        },
      }),
    );
    const nextState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    );

    expect(collectNewlyCompletedTurns(previousState, nextState)).toEqual([
      {
        environmentId: "env-1",
        threadId: "thread-1",
        turnId: "turn-1",
        completedAt: "2026-06-03T10:01:00.000Z",
      },
    ]);
  });

  it("ignores duplicate completed snapshots for the same turn", () => {
    const previousState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    );
    const nextState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    );

    expect(collectNewlyCompletedTurns(previousState, nextState)).toEqual([]);
  });

  it("ignores threads that were not present in the previous snapshot", () => {
    const previousState: AppState = {
      activeEnvironmentId: "env-1" as never,
      environmentStateById: {},
    };
    const nextState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
      }),
    );

    expect(collectNewlyCompletedTurns(previousState, nextState)).toEqual([]);
  });
});

describe("turn completion alert helpers", () => {
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
