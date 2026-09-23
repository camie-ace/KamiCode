import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { selectNextWaterfallProvider } from "./ProviderRuntimeIngestion.ts";

const provider = (
  instanceId: string,
  driver: string,
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-19T00:00:00.000Z",
  models: [
    {
      slug: `${driver}-default`,
      name: `${driver} default`,
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});

describe("selectNextWaterfallProvider", () => {
  it("selects the next healthy instance across provider drivers", () => {
    const codex = provider("codex_work", "codex");
    const unavailable = provider("codex_spare", "codex", {
      enabled: false,
      installed: false,
      availability: "unavailable",
    });
    const claude = provider("claude_team", "claudeAgent");

    expect(
      selectNextWaterfallProvider({
        sequence: [codex.instanceId, unavailable.instanceId, claude.instanceId],
        failedInstanceId: codex.instanceId,
        providers: [codex, unavailable, claude],
      })?.instanceId,
    ).toBe(claude.instanceId);
  });

  it("wraps to earlier instances whose limits may have reset", () => {
    const first = provider("codex_first", "codex");
    const last = provider("claude_last", "claudeAgent");

    expect(
      selectNextWaterfallProvider({
        sequence: [first.instanceId, last.instanceId],
        failedInstanceId: last.instanceId,
        providers: [first, last],
      })?.instanceId,
    ).toBe(first.instanceId);
  });

  it("starts from the top when the failed instance is outside the sequence", () => {
    const first = provider("codex_first", "codex");
    const last = provider("claude_last", "claudeAgent");

    expect(
      selectNextWaterfallProvider({
        sequence: [first.instanceId, last.instanceId],
        failedInstanceId: ProviderInstanceId.make("outside_waterfall"),
        providers: [first, last],
      })?.instanceId,
    ).toBe(first.instanceId);
  });

  it("never returns to an instance the request already tried, even when repeated", () => {
    const first = provider("codex_first", "codex");
    const second = provider("codex_second", "codex");
    const sequence = [first.instanceId, second.instanceId, first.instanceId];

    expect(
      selectNextWaterfallProvider({
        sequence,
        failedInstanceId: second.instanceId,
        providers: [first, second],
        attemptedInstanceIds: new Set([first.instanceId, second.instanceId]),
      }),
    ).toBeUndefined();
    expect(
      selectNextWaterfallProvider({
        sequence,
        failedInstanceId: first.instanceId,
        providers: [first, second],
      })?.instanceId,
    ).toBe(second.instanceId);
  });
});
