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

  it("does not wrap back to the beginning or select an unconfigured failure", () => {
    const first = provider("codex_first", "codex");
    const last = provider("claude_last", "claudeAgent");
    const sequence = [first.instanceId, last.instanceId];

    expect(
      selectNextWaterfallProvider({
        sequence,
        failedInstanceId: last.instanceId,
        providers: [first, last],
      }),
    ).toBeUndefined();
    expect(
      selectNextWaterfallProvider({
        sequence,
        failedInstanceId: ProviderInstanceId.make("outside_waterfall"),
        providers: [first, last],
      }),
    ).toBeUndefined();
  });
});
