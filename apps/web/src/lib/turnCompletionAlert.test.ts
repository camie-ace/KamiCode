import { describe, expect, it } from "vitest";

import type { AppState, EnvironmentState } from "../store";
import type { ThreadSession } from "../types";
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
  session?: {
    status?: "disconnected" | "connecting" | "ready" | "running" | "error" | "closed";
    orchestrationStatus?:
      | "idle"
      | "starting"
      | "running"
      | "ready"
      | "interrupted"
      | "stopped"
      | "error";
    activeTurnId?: string | undefined;
  } | null;
}): EnvironmentState {
  const threadId = input.threadId as never;
  const session =
    input.session === undefined
      ? {
          status: "ready" as const,
          orchestrationStatus: "idle" as const,
          activeTurnId: undefined,
        }
      : input.session;

  return {
    projectIds: [],
    projectById: {},
    threadIds: [threadId],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: session
      ? {
          [threadId]: {
            provider: "codex" as ThreadSession["provider"],
            status: session.status ?? "ready",
            orchestrationStatus: session.orchestrationStatus ?? "idle",
            activeTurnId: session.activeTurnId as never,
            createdAt: "2026-06-03T10:00:00.000Z",
            updatedAt: "2026-06-03T10:01:00.000Z",
          } satisfies ThreadSession,
        }
      : {},
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
  it("detects when the same turn transitions to completed after the session is idle", () => {
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

  it("does not alert when the turn diff completes while the session is still running", () => {
    const previousState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "running",
          completedAt: null,
        },
        session: {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: "turn-1",
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
        session: {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: "turn-1",
        },
      }),
    );

    expect(collectNewlyCompletedTurns(previousState, nextState)).toEqual([]);
  });

  it("alerts when an already-completed turn becomes settled after the session stops running", () => {
    const previousState = makeState(
      makeEnvironmentState({
        threadId: "thread-1",
        turn: {
          turnId: "turn-1",
          state: "completed",
          completedAt: "2026-06-03T10:01:00.000Z",
        },
        session: {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: "turn-1",
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
        session: {
          status: "ready",
          orchestrationStatus: "idle",
          activeTurnId: undefined,
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
