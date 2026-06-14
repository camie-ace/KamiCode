import type {
  ScopedThreadRef,
  SharedRepositoryState,
  SharedSessionSnapshot,
  SharedSessionSnapshotMessage,
  SharedThreadMessage,
} from "@t3tools/contracts";

import { selectThreadByRef, useStore } from "./store";
import type { Thread } from "./types";
import { retainThreadDetailSubscription } from "./environments/runtime/service";

const THREAD_DETAIL_SHARE_WAIT_MS = 4_000;
const THREAD_DETAIL_SHARE_POLL_MS = 100;

function waitForThreadSharePoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export async function loadThreadDetailForSharing(threadRef: ScopedThreadRef): Promise<Thread> {
  const readThread = () => selectThreadByRef(useStore.getState(), threadRef) ?? null;
  const existing = readThread();
  if (existing) {
    return existing;
  }

  const release = retainThreadDetailSubscription(threadRef.environmentId, threadRef.threadId);
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < THREAD_DETAIL_SHARE_WAIT_MS) {
      const thread = readThread();
      if (thread) {
        return thread;
      }
      await waitForThreadSharePoll(THREAD_DETAIL_SHARE_POLL_MS);
    }
  } finally {
    release();
  }

  throw new Error("Session details are still loading. Try sharing again in a moment.");
}

export function toSharedThreadMessages(thread: Thread): SharedThreadMessage[] {
  return thread.messages.map((message) => ({
    id: message.id as unknown as SharedThreadMessage["id"],
    role: message.role,
    text: message.text,
    authorGithubLogin: null,
    createdAt: message.createdAt as SharedThreadMessage["createdAt"],
  }));
}

function toSharedSessionSnapshotMessages(thread: Thread): SharedSessionSnapshotMessage[] {
  return thread.messages.map((message) => ({
    id: message.id as unknown as SharedSessionSnapshotMessage["id"],
    role: message.role,
    text: message.text,
    authorGithubLogin: null,
    turnId:
      message.turnId === null || message.turnId === undefined
        ? null
        : (message.turnId as unknown as SharedSessionSnapshotMessage["turnId"]),
    createdAt: message.createdAt as SharedSessionSnapshotMessage["createdAt"],
    completedAt:
      message.completedAt === undefined
        ? null
        : (message.completedAt as SharedSessionSnapshotMessage["completedAt"]),
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
  thread: Thread,
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
    error: thread.error,
    repository,
    branch: thread.branch,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    messages,
    activities: thread.activities.map((activity) => ({
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
    proposedPlans: thread.proposedPlans,
    checkpoints: thread.turnDiffSummaries.map((checkpoint) => ({
      turnId:
        checkpoint.turnId as unknown as SharedSessionSnapshot["checkpoints"][number]["turnId"],
      checkpointTurnCount: checkpoint.checkpointTurnCount ?? 0,
      checkpointRef: checkpoint.checkpointRef ?? null,
      status: checkpoint.status ?? "unknown",
      files: checkpoint.files,
      assistantMessageId:
        checkpoint.assistantMessageId === undefined
          ? null
          : (checkpoint.assistantMessageId as unknown as SharedSessionSnapshot["checkpoints"][number]["assistantMessageId"]),
      completedAt:
        checkpoint.completedAt === null || checkpoint.completedAt === undefined
          ? null
          : (checkpoint.completedAt as SharedSessionSnapshot["checkpoints"][number]["completedAt"]),
    })),
    latestTurn: thread.latestTurn,
    queuedTurns: thread.queuedTurns ?? [],
    session: thread.session,
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
