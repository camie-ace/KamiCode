import { EventId, MessageId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { makeThreadFixture, makeThreadProjectionFixture } from "./test-fixtures";
vi.mock("./state/threads", () => ({ threadEnvironment: {} }));
vi.mock("./rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("./state/entities", () => ({ readThreadShell: vi.fn() }));
import { toSharedSessionSnapshot } from "./sharedSessionSnapshot";

it("retains re-shared system messages and media without duplicating system activities", () => {
  const projection = makeThreadProjectionFixture();
  const now = DateTime.makeUnsafe("2026-10-06T10:00:00.000Z");
  const base = {
    threadId: projection.thread.id,
    runId: null,
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
  const items: OrchestrationV2TurnItem[] = [
    {
      ...base,
      id: TurnItemId.make("system"),
      type: "kami_activity",
      activity: {
        id: EventId.make("imported-system"),
        tone: "info",
        kind: "shared.system_message",
        summary: "System note",
        payload: { text: "Original system note" },
        turnId: null,
        createdAt: DateTime.formatIso(now),
      },
    },
    {
      ...base,
      id: TurnItemId.make("message"),
      type: "user_message",
      createdBy: "user",
      creationSource: "web",
      inputIntent: "turn_start",
      messageId: MessageId.make("message"),
      text: "See clip",
      attachments: [
        { id: "clip", type: "video", name: "clip.mp4", mimeType: "video/mp4", sizeBytes: 42 },
      ],
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
  const result = toSharedSessionSnapshot(
    { ...makeThreadFixture(), projection: detail },
    {
      canonicalKey: null,
      remoteUrl: null,
      remoteName: null,
      defaultBranch: null,
      currentBranch: null,
      headSha: null,
      dirty: false,
    },
  );
  expect(result.messages.map((message) => [message.role, message.text])).toEqual([
    ["system", "Original system note"],
    ["user", "See clip"],
  ]);
  expect(result.messages[1]?.attachments).toEqual([
    { id: "clip", type: "video", name: "clip.mp4", mimeType: "video/mp4", sizeBytes: 42 },
  ]);
  expect(result.activities).toEqual([]);
});
