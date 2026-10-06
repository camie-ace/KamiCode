import { OrchestrationV2ThreadProjection, OrchestrationV2Command } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { waterfallContinuation, selectNextWaterfallProvider } from "./ProviderWaterfall.ts";

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

it("uses durable run ancestry to stop provider cycles and rejects stale or settled threads", () => {
  const now = DateTime.makeUnsafe("2026-10-06T10:00:00.000Z");
  const projection = Schema.decodeUnknownSync(OrchestrationV2ThreadProjection)({
    thread: {
      id: "thread",
      projectId: "project",
      title: "Work",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: "first",
      modelSelection: { instanceId: "first", model: "codex-default" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread" },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [
      {
        id: "failed",
        threadId: "thread",
        ordinal: 1,
        providerInstanceId: "first",
        modelSelection: { instanceId: "first", model: "codex-default" },
        providerThreadId: null,
        userMessageId: "message",
        rootNodeId: null,
        activeAttemptId: null,
        status: "failed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    turnItems: [
      {
        id: "error",
        threadId: "thread",
        runId: "failed",
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "failed",
        title: "Limited",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "error",
        message: "Limited",
        failure: { class: "usage_limit", message: "Limited", code: null, retryable: true },
      },
    ],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  });
  const providers = [provider("first", "codex"), provider("second", "claudeAgent")];
  const sequence = providers.map((entry) => entry.instanceId);
  const first = waterfallContinuation({ projection, providers, sequence });
  expect(first?.modelSelection?.instanceId).toBe("second");
  expect(first?.manualContinuationOfRunId).toBe("failed");
  expect(Schema.is(OrchestrationV2Command)(first)).toBe(true);
  expect(waterfallContinuation({ projection, providers, sequence })).toEqual(first);
  expect(
    waterfallContinuation({
      projection: { ...projection, thread: { ...projection.thread, settledOverride: "settled" } },
      providers,
      sequence,
    }),
  ).toBeNull();
  const secondRun = {
    ...projection.runs[0]!,
    id: first!.messageId as unknown as (typeof projection.runs)[number]["id"],
    ordinal: 2,
    providerInstanceId: providers[1]!.instanceId,
    modelSelection: first!.modelSelection!,
    waterfallOfRunId: projection.runs[0]!.id,
  };
  const retried = {
    ...projection,
    thread: { ...projection.thread, providerInstanceId: providers[1]!.instanceId },
    runs: [...projection.runs, secondRun],
    turnItems: [
      ...projection.turnItems,
      { ...projection.turnItems[0]!, runId: secondRun.id, ordinal: 2 },
    ],
  };
  expect(waterfallContinuation({ projection: retried, providers, sequence })).toBeNull();
});
