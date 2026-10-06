import {
  EventId,
  MessageId,
  RunId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { makeThreadProjectionFixture } from "./test-fixtures";
import {
  workflowActivities,
  workflowAssistantResult,
  workflowMessages,
} from "./workflowProjection";

it("reads imported workflow records and selects the child run's final answer", () => {
  const projection = makeThreadProjectionFixture();
  const runId = RunId.make("child-run");
  const now = DateTime.makeUnsafe("2026-10-06T10:00:00.000Z");
  const base = {
    threadId: projection.thread.id,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  };
  const activity = {
    id: EventId.make("workflow-started"),
    tone: "info" as const,
    kind: "workflow.lane.started",
    summary: "Verifier started",
    payload: { laneId: "verify", childThreadId: "child" },
    turnId: null,
    createdAt: DateTime.formatIso(now),
  };
  const items: OrchestrationV2TurnItem[] = [
    { ...base, id: TurnItemId.make("activity"), type: "kami_activity", activity },
    {
      ...base,
      id: TurnItemId.make("answer"),
      type: "assistant_message",
      messageId: MessageId.make("answer"),
      text: "Checks passed",
      streaming: false,
    },
    {
      ...base,
      id: TurnItemId.make("other"),
      runId: RunId.make("another-run"),
      type: "assistant_message",
      messageId: MessageId.make("other"),
      text: "Unrelated newer answer",
      streaming: false,
    },
  ];
  const detail = {
    ...projection,
    visibleTurnItems: items.map((item, position) => ({
      item,
      position,
      visibility: "local" as const,
      sourceThreadId: projection.thread.id,
      sourceItemId: item.id,
    })),
  };
  expect(workflowActivities(detail)).toEqual([activity]);
  expect(workflowAssistantResult(detail, runId)).toBe("Checks passed");
  expect(workflowAssistantResult(detail, RunId.make("missing"))).toBeNull();
  expect(workflowMessages(detail)[0]).toMatchObject({
    role: "assistant",
    text: "Checks passed",
    runId,
    streaming: false,
    createdAt: DateTime.formatIso(now),
  });
});
