import { describe, expect, it, vi } from "vite-plus/test";

import {
  BROWSER_SESSION_SYNC_STORAGE_KEY,
  createBrowserSessionSyncController,
} from "./browserSessionSync";

interface TestBroadcastChannel {
  readonly postMessage: (message: unknown) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly close: () => void;
}

function createBroadcastBus() {
  const listeners = new Set<(event: { readonly data: unknown }) => void>();
  return {
    createChannel(): TestBroadcastChannel {
      let ownListener: ((event: { readonly data: unknown }) => void) | null = null;
      return {
        postMessage(message) {
          for (const listener of listeners) {
            if (listener !== ownListener) {
              listener({ data: message });
            }
          }
        },
        addEventListener(_type, listener) {
          ownListener = listener;
          listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          listeners.delete(listener);
        },
        close() {
          if (ownListener !== null) {
            listeners.delete(ownListener);
          }
        },
      };
    },
  };
}

function createStorageEvents() {
  const listeners = new Set<
    (event: { readonly key: string | null; readonly newValue: string | null }) => void
  >();
  return {
    target: {
      addEventListener(
        _type: "storage",
        listener: (event: {
          readonly key: string | null;
          readonly newValue: string | null;
        }) => void,
      ) {
        listeners.add(listener);
      },
      removeEventListener(
        _type: "storage",
        listener: (event: {
          readonly key: string | null;
          readonly newValue: string | null;
        }) => void,
      ) {
        listeners.delete(listener);
      },
    },
    emit(newValue: string) {
      for (const listener of listeners) {
        listener({ key: BROWSER_SESSION_SYNC_STORAGE_KEY, newValue });
      }
    },
  };
}

describe("browser session synchronization", () => {
  it("notifies other tabs once without reloading the publishing tab", () => {
    const bus = createBroadcastBus();
    const firstReload = vi.fn();
    const secondReload = vi.fn();
    const first = createBrowserSessionSyncController({
      sourceId: "first-tab",
      createNonce: () => "pairing-1",
      storage: null,
      storageEvents: null,
      createBroadcastChannel: () => bus.createChannel(),
      onSessionChanged: firstReload,
    });
    const second = createBrowserSessionSyncController({
      sourceId: "second-tab",
      createNonce: () => "pairing-2",
      storage: null,
      storageEvents: null,
      createBroadcastChannel: () => bus.createChannel(),
      onSessionChanged: secondReload,
    });

    first.start();
    second.start();
    first.publish();

    expect(firstReload).not.toHaveBeenCalled();
    expect(secondReload).toHaveBeenCalledOnce();
  });

  it("uses the storage event fallback and ignores duplicate delivery", () => {
    const storageEvents = createStorageEvents();
    const reload = vi.fn();
    let stored = "";
    const controller = createBrowserSessionSyncController({
      sourceId: "receiving-tab",
      createNonce: () => "local-nonce",
      storage: {
        setItem(_key, value) {
          stored = value;
        },
      },
      storageEvents: storageEvents.target,
      createBroadcastChannel: null,
      onSessionChanged: reload,
    });
    const publisher = createBrowserSessionSyncController({
      sourceId: "publishing-tab",
      createNonce: () => "shared-nonce",
      storage: {
        setItem(_key, value) {
          stored = value;
        },
      },
      storageEvents: null,
      createBroadcastChannel: null,
      onSessionChanged: vi.fn(),
    });

    controller.start();
    publisher.publish();
    storageEvents.emit(stored);
    storageEvents.emit(stored);

    expect(reload).toHaveBeenCalledOnce();
  });

  it("ignores malformed and same-tab storage messages", () => {
    const storageEvents = createStorageEvents();
    const reload = vi.fn();
    const controller = createBrowserSessionSyncController({
      sourceId: "same-tab",
      createNonce: () => "unused",
      storage: null,
      storageEvents: storageEvents.target,
      createBroadcastChannel: null,
      onSessionChanged: reload,
    });

    controller.start();
    storageEvents.emit("not-json");
    storageEvents.emit(
      JSON.stringify({
        type: "browser-session-changed",
        sourceId: "same-tab",
        nonce: "same-tab-event",
      }),
    );

    expect(reload).not.toHaveBeenCalled();
  });
});
