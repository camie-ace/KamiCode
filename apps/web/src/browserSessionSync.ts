const BROWSER_SESSION_SYNC_CHANNEL = "kamicode:browser-session-sync:v1";
export const BROWSER_SESSION_SYNC_STORAGE_KEY = "kamicode:browser-session-sync:v1";

interface BrowserSessionSyncMessage {
  readonly type: "browser-session-changed";
  readonly sourceId: string;
  readonly nonce: string;
}

interface StorageEventLike {
  readonly key: string | null;
  readonly newValue: string | null;
}

interface StorageEventTargetLike {
  readonly addEventListener: (type: "storage", listener: (event: StorageEventLike) => void) => void;
  readonly removeEventListener: (
    type: "storage",
    listener: (event: StorageEventLike) => void,
  ) => void;
}

interface BroadcastMessageEventLike {
  readonly data: unknown;
}

interface BroadcastChannelLike {
  readonly postMessage: (message: unknown) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: BroadcastMessageEventLike) => void,
  ) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: BroadcastMessageEventLike) => void,
  ) => void;
  readonly close: () => void;
}

export interface BrowserSessionSyncController {
  readonly start: () => void;
  readonly publish: () => void;
  readonly stop: () => void;
}

export function createBrowserSessionSyncController(options: {
  readonly sourceId: string;
  readonly createNonce: () => string;
  readonly storage: Pick<Storage, "setItem"> | null;
  readonly storageEvents: StorageEventTargetLike | null;
  readonly createBroadcastChannel: (() => BroadcastChannelLike) | null;
  readonly onSessionChanged: () => void;
}): BrowserSessionSyncController {
  let started = false;
  let channel: BroadcastChannelLike | null = null;
  const handledNonces = new Set<string>();

  const handleMessage = (value: unknown) => {
    if (!isBrowserSessionSyncMessage(value)) {
      return;
    }
    if (value.sourceId === options.sourceId || handledNonces.has(value.nonce)) {
      return;
    }
    handledNonces.add(value.nonce);
    options.onSessionChanged();
  };
  const handleStorage = (event: StorageEventLike) => {
    if (event.key !== BROWSER_SESSION_SYNC_STORAGE_KEY || event.newValue === null) {
      return;
    }
    try {
      handleMessage(JSON.parse(event.newValue));
    } catch {
      // Ignore unrelated or malformed browser storage updates.
    }
  };
  const handleBroadcast = (event: BroadcastMessageEventLike) => {
    handleMessage(event.data);
  };

  const start = () => {
    if (started) {
      return;
    }
    started = true;
    options.storageEvents?.addEventListener("storage", handleStorage);
    if (options.createBroadcastChannel !== null) {
      try {
        channel = options.createBroadcastChannel();
        channel.addEventListener("message", handleBroadcast);
      } catch {
        channel = null;
      }
    }
  };

  const publish = () => {
    const message: BrowserSessionSyncMessage = {
      type: "browser-session-changed",
      sourceId: options.sourceId,
      nonce: options.createNonce(),
    };
    try {
      options.storage?.setItem(BROWSER_SESSION_SYNC_STORAGE_KEY, JSON.stringify(message));
    } catch {
      // BroadcastChannel still covers browsers that deny local storage.
    }
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel messages are origin-scoped and do not accept a targetOrigin argument.
      channel?.postMessage(message);
    } catch {
      // The successful pairing remains valid even if another tab cannot be notified.
    }
  };

  const stop = () => {
    if (!started) {
      return;
    }
    started = false;
    options.storageEvents?.removeEventListener("storage", handleStorage);
    if (channel !== null) {
      channel.removeEventListener("message", handleBroadcast);
      channel.close();
      channel = null;
    }
  };

  return { start, publish, stop };
}

function isBrowserSessionSyncMessage(value: unknown): value is BrowserSessionSyncMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<BrowserSessionSyncMessage>;
  return (
    candidate.type === "browser-session-changed" &&
    typeof candidate.sourceId === "string" &&
    candidate.sourceId.length > 0 &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.length > 0
  );
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let defaultController: BrowserSessionSyncController | null = null;

function getDefaultController(): BrowserSessionSyncController | null {
  if (typeof window === "undefined") {
    return null;
  }
  defaultController ??= createBrowserSessionSyncController({
    sourceId: randomId(),
    createNonce: randomId,
    storage: browserStorage(),
    storageEvents: window,
    createBroadcastChannel:
      typeof BroadcastChannel === "function"
        ? () => new BroadcastChannel(BROWSER_SESSION_SYNC_CHANNEL)
        : null,
    onSessionChanged: () => {
      window.location.reload();
    },
  });
  return defaultController;
}

export function installBrowserSessionSync(): void {
  getDefaultController()?.start();
}

export function publishBrowserSessionChanged(): void {
  const controller = getDefaultController();
  controller?.start();
  controller?.publish();
}
