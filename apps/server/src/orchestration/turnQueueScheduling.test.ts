import { describe, expect, it } from "vite-plus/test";

import { findNextDueQueuedTurn, isQueuedTurnDue } from "./turnQueueScheduling.ts";

const NOW = Date.parse("2026-09-10T18:00:00.000Z");

describe("turn queue scheduling", () => {
  it("treats ordinary queued turns and elapsed schedules as due", () => {
    expect(isQueuedTurnDue({ scheduledFor: null }, NOW)).toBe(true);
    expect(isQueuedTurnDue({ scheduledFor: "2026-09-10T17:59:59.000Z" }, NOW)).toBe(true);
    expect(isQueuedTurnDue({ scheduledFor: "2026-09-10T18:00:00.000Z" }, NOW)).toBe(true);
  });

  it("leaves future scheduled turns pending", () => {
    expect(isQueuedTurnDue({ scheduledFor: "2026-09-10T18:00:01.000Z" }, NOW)).toBe(false);
  });

  it("does not let a future schedule block a later ordinary queued turn", () => {
    const future = { id: "future", scheduledFor: "2026-09-11T18:00:00.000Z" };
    const immediate = { id: "immediate", scheduledFor: null };
    expect(findNextDueQueuedTurn([future, immediate], NOW)).toBe(immediate);
  });

  it("fails open for malformed persisted schedule values", () => {
    expect(isQueuedTurnDue({ scheduledFor: "not-a-date" }, NOW)).toBe(true);
  });
});
