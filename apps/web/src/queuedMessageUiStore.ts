import { create } from "zustand";
import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";

import type { ChatMessage } from "./types";

export const queuedMessageThreadKey = (environmentId: EnvironmentId, threadId: ThreadId): string =>
  `${environmentId}:${threadId}`;

export interface QueuedMessageUiState {
  optimisticQueuedMessagesByThreadKey: Record<string, ChatMessage[]>;
  locallyCancelledQueuedMessageIdsByThreadKey: Record<string, ReadonlySet<MessageId>>;
  addOptimisticQueuedMessage: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    message: ChatMessage,
  ) => void;
  removeOptimisticQueuedMessage: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    messageId: MessageId,
  ) => void;
  removeOptimisticQueuedMessages: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    messageIds: ReadonlySet<MessageId>,
  ) => void;
  markLocallyCancelledQueuedMessage: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    messageId: MessageId,
  ) => void;
  unmarkLocallyCancelledQueuedMessage: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    messageId: MessageId,
  ) => void;
  reset: () => void;
}

function removeKeyIfEmpty<T>(
  record: Record<string, T>,
  key: string,
  isEmpty: (value: T) => boolean,
): Record<string, T> {
  const value = record[key];
  if (value === undefined || !isEmpty(value)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}

const initialQueuedMessageUiState = {
  optimisticQueuedMessagesByThreadKey: {},
  locallyCancelledQueuedMessageIdsByThreadKey: {},
};

export const useQueuedMessageUiStore = create<QueuedMessageUiState>((set) => ({
  ...initialQueuedMessageUiState,

  addOptimisticQueuedMessage: (environmentId, threadId, message) =>
    set((state) => {
      const key = queuedMessageThreadKey(environmentId, threadId);
      const existing = state.optimisticQueuedMessagesByThreadKey[key] ?? [];
      const nextMessages = [...existing.filter((entry) => entry.id !== message.id), message];
      return {
        optimisticQueuedMessagesByThreadKey: {
          ...state.optimisticQueuedMessagesByThreadKey,
          [key]: nextMessages,
        },
      };
    }),

  removeOptimisticQueuedMessage: (environmentId, threadId, messageId) =>
    set((state) => {
      const key = queuedMessageThreadKey(environmentId, threadId);
      const existing = state.optimisticQueuedMessagesByThreadKey[key];
      if (!existing?.some((message) => message.id === messageId)) {
        return state;
      }
      const nextMessages = existing.filter((message) => message.id !== messageId);
      const nextByThreadKey = {
        ...state.optimisticQueuedMessagesByThreadKey,
        [key]: nextMessages,
      };
      return {
        optimisticQueuedMessagesByThreadKey: removeKeyIfEmpty(
          nextByThreadKey,
          key,
          (messages) => messages.length === 0,
        ),
      };
    }),

  removeOptimisticQueuedMessages: (environmentId, threadId, messageIds) =>
    set((state) => {
      if (messageIds.size === 0) {
        return state;
      }
      const key = queuedMessageThreadKey(environmentId, threadId);
      const existing = state.optimisticQueuedMessagesByThreadKey[key];
      if (!existing?.some((message) => messageIds.has(message.id))) {
        return state;
      }
      const nextMessages = existing.filter((message) => !messageIds.has(message.id));
      const nextByThreadKey = {
        ...state.optimisticQueuedMessagesByThreadKey,
        [key]: nextMessages,
      };
      return {
        optimisticQueuedMessagesByThreadKey: removeKeyIfEmpty(
          nextByThreadKey,
          key,
          (messages) => messages.length === 0,
        ),
      };
    }),

  markLocallyCancelledQueuedMessage: (environmentId, threadId, messageId) =>
    set((state) => {
      const key = queuedMessageThreadKey(environmentId, threadId);
      const existing = state.locallyCancelledQueuedMessageIdsByThreadKey[key] ?? new Set();
      if (existing.has(messageId)) {
        return state;
      }
      const nextIds = new Set(existing);
      nextIds.add(messageId);
      return {
        locallyCancelledQueuedMessageIdsByThreadKey: {
          ...state.locallyCancelledQueuedMessageIdsByThreadKey,
          [key]: nextIds,
        },
      };
    }),

  unmarkLocallyCancelledQueuedMessage: (environmentId, threadId, messageId) =>
    set((state) => {
      const key = queuedMessageThreadKey(environmentId, threadId);
      const existing = state.locallyCancelledQueuedMessageIdsByThreadKey[key];
      if (!existing?.has(messageId)) {
        return state;
      }
      const nextIds = new Set(existing);
      nextIds.delete(messageId);
      const nextByThreadKey = {
        ...state.locallyCancelledQueuedMessageIdsByThreadKey,
        [key]: nextIds,
      };
      return {
        locallyCancelledQueuedMessageIdsByThreadKey: removeKeyIfEmpty(
          nextByThreadKey,
          key,
          (ids) => ids.size === 0,
        ),
      };
    }),

  reset: () => set(initialQueuedMessageUiState),
}));

export function resetQueuedMessageUiStoreForTests(): void {
  useQueuedMessageUiStore.getState().reset();
}
