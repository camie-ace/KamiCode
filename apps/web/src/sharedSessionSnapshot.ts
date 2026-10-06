import type {
  ScopedThreadRef,
  RunId,
  OrchestrationV2ThreadProjection,
  SharedRepositoryState,
  SharedSessionSnapshot,
  SharedSessionSnapshotMessage,
  SharedThreadMessage,
} from "@t3tools/contracts";
import { OrchestrationV2RunJson } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { threadEnvironment } from "./state/threads";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadShell } from "./state/entities";
import type { ChatMessage } from "./types";
import { workflowActivities, workflowMessages } from "./workflowProjection";

export type ThreadForSharing = EnvironmentThreadShell & {
  readonly projection: OrchestrationV2ThreadProjection;
};

function suggestedSharedSessionBranch(thread: ThreadForSharing): string | null {
  const titleSegment = thread.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 36);
  const idSegment = String(thread.id)
    .replace(/[^a-zA-Z0-9]/gu, "")
    .slice(-8)
    .toLowerCase();
  const branch = `shared/${titleSegment || "session"}-${idSegment || "import"}`;
  return branch.length > 0 ? branch : null;
}

/** Fetch the complete projection instead of exporting the currently paginated UI history. */
export async function loadThreadDetailForSharing(
  threadRef: ScopedThreadRef,
): Promise<ThreadForSharing> {
  const shell = readThreadShell(threadRef);
  if (!shell) throw new Error("Session was not found. Refresh and try sharing again.");
  const result = await runAtomCommand(appAtomRegistry, threadEnvironment.loadFullSnapshot, {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  if (!AsyncResult.isSuccess(result)) {
    throw new Error("Could not load the complete session. Try sharing again.");
  }
  return { ...shell, projection: result.value.projection };
}

function sharingMessages(thread: ThreadForSharing) {
  const messages = new Map(
    workflowMessages(thread.projection).map((message) => [message.id, message]),
  );
  return thread.projection.visibleTurnItems.flatMap<{
    id: SharedSessionSnapshotMessage["id"];
    role: "user" | "assistant" | "system";
    text: string;
    runId?: RunId | null | undefined;
    createdAt: string;
    attachments?: ChatMessage["attachments"];
  }>(({ item }) => {
    if (item.type === "kami_activity" && item.activity.kind === "shared.system_message") {
      const payload = item.activity.payload;
      const text =
        typeof payload === "object" &&
        payload !== null &&
        "text" in payload &&
        typeof payload.text === "string"
          ? payload.text
          : item.activity.summary;
      return [
        {
          id: item.activity.id as unknown as SharedSessionSnapshotMessage["id"],
          role: "system" as const,
          text,
          runId: null,
          createdAt: item.activity.createdAt,
          attachments: [],
        },
      ];
    }
    if (item.type !== "user_message" && item.type !== "assistant_message") return [];
    const message = messages.get(item.messageId);
    return message
      ? [{ ...message, id: message.id as unknown as SharedSessionSnapshotMessage["id"] }]
      : [];
  });
}

export function toSharedThreadMessages(thread: ThreadForSharing): SharedThreadMessage[] {
  return sharingMessages(thread).map((message) => ({
    id: message.id as unknown as SharedThreadMessage["id"],
    role: message.role,
    text: message.text,
    authorGithubLogin: null,
    createdAt: message.createdAt as SharedThreadMessage["createdAt"],
  }));
}

function toSharedSessionSnapshotMessages(thread: ThreadForSharing): SharedSessionSnapshotMessage[] {
  return sharingMessages(thread).map((message) => ({
    id: message.id as unknown as SharedSessionSnapshotMessage["id"],
    role: message.role,
    text: message.text,
    authorGithubLogin: null,
    turnId:
      message.runId === null || message.runId === undefined
        ? null
        : (message.runId as unknown as SharedSessionSnapshotMessage["turnId"]),
    createdAt: message.createdAt as SharedSessionSnapshotMessage["createdAt"],
    completedAt: null,
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id as SharedSessionSnapshotMessage["attachments"][number]["id"],
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
  }));
}

export function toSharedSessionSnapshot(
  thread: ThreadForSharing,
  repository: SharedRepositoryState,
): SharedSessionSnapshot {
  const messages = toSharedSessionSnapshotMessages(thread);
  return {
    version: 1,
    capturedAt: new Date().toISOString() as SharedSessionSnapshot["capturedAt"],
    sourceEnvironmentId: thread.environmentId,
    sourceThreadId: thread.id,
    sourceProjectId: thread.projectId,
    title: thread.title,
    threadCreatedAt: thread.createdAt as SharedSessionSnapshot["threadCreatedAt"],
    threadUpdatedAt:
      thread.updatedAt === undefined
        ? null
        : (thread.updatedAt as SharedSessionSnapshot["threadUpdatedAt"]),
    threadArchivedAt:
      thread.archivedAt === null
        ? null
        : (thread.archivedAt as SharedSessionSnapshot["threadArchivedAt"]),
    error: thread.runtime?.lastError ?? null,
    repository,
    branch: thread.branch,
    suggestedBranch: suggestedSharedSessionBranch(thread),
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    messages,
    activities: workflowActivities(thread.projection)
      .filter((activity) => activity.kind !== "shared.system_message")
      .map((activity) => ({
        id: activity.id as unknown as SharedSessionSnapshot["activities"][number]["id"],
        tone: activity.tone,
        kind: activity.kind,
        summary: activity.summary,
        payload: activity.payload,
        turnId:
          activity.turnId === null
            ? null
            : (activity.turnId as unknown as SharedSessionSnapshot["activities"][number]["turnId"]),
        ...(activity.sequence !== undefined ? { sequence: activity.sequence } : {}),
        createdAt: activity.createdAt as SharedSessionSnapshot["activities"][number]["createdAt"],
      })),
    proposedPlans: thread.projection.plans.flatMap((plan) =>
      plan.kind === "proposed_plan"
        ? [
            {
              id: plan.id,
              turnId: plan.runId,
              planMarkdown: plan.markdown,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
              implementedAt: plan.status === "completed" ? thread.updatedAt : null,
              implementationThreadId: null,
            },
          ]
        : [],
    ),
    checkpoints: thread.projection.checkpoints.map((checkpoint) => ({
      turnId: (checkpoint.runId ??
        checkpoint.id) as unknown as SharedSessionSnapshot["checkpoints"][number]["turnId"],
      checkpointTurnCount: checkpoint.appRunOrdinal ?? checkpoint.ordinalWithinScope,
      checkpointRef: checkpoint.ref,
      status: checkpoint.status ?? "unknown",
      files: checkpoint.files,
      assistantMessageId: null,
      completedAt: DateTime.formatIso(checkpoint.capturedAt),
    })),
    latestTurn: thread.latestRun,
    queuedTurns: thread.projection.runs
      .filter((run) => run.status === "queued")
      .map((run) => Schema.encodeSync(OrchestrationV2RunJson)(run)),
    session: thread.runtime,

    excludedCategories: [
      "codebase files",
      "project folder archive",
      "node_modules",
      "raw .env contents",
      "secret values",
      "private keys",
      "auth state",
      "provider credentials",
    ],
  };
}
