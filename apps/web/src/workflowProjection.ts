import type {
  OrchestrationThreadActivity,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { ChatMessage } from "./types";

/** Read KamiCode workflow records from the V2 timeline, including imported history. */
export function workflowActivities(
  projection: OrchestrationV2ThreadProjection | null,
): ReadonlyArray<OrchestrationThreadActivity> {
  return (
    projection?.visibleTurnItems.flatMap(({ item }) =>
      item.type === "kami_activity" ? [item.activity] : [],
    ) ?? []
  );
}

export function workflowMessages(
  projection: OrchestrationV2ThreadProjection,
): ReadonlyArray<ChatMessage> {
  return projection.visibleTurnItems.flatMap(({ item }): ChatMessage[] => {
    if (item.type !== "user_message" && item.type !== "assistant_message") return [];
    return [
      {
        id: item.messageId,
        role: item.type === "user_message" ? "user" : "assistant",
        text: item.text,
        attachments: item.attachments ?? [],
        runId: item.runId,
        streaming: item.type === "assistant_message" && item.streaming,
        createdAt: DateTime.formatIso(item.startedAt ?? item.updatedAt),
        updatedAt: DateTime.formatIso(item.updatedAt),
      },
    ];
  });
}

export function workflowAssistantResult(
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
): string | null {
  const messages = workflowMessages(projection);
  const message = messages.findLast(
    (message) => message.role === "assistant" && message.runId === runId,
  );
  return message?.text.trim() || null;
}
