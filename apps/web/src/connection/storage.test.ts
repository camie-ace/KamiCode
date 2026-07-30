import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { makeCatalogBackend, makeCatalogStore, openConnectionStorageDatabase } from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});

type Listener = () => void;

function makeEventTarget() {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

describe("openConnectionStorageDatabase", () => {
  it.effect("closes an older connection when another tab requests a database upgrade", () =>
    Effect.gen(function* () {
      const databaseEvents = makeEventTarget();
      const database = {
        addEventListener: databaseEvents.addEventListener,
        close: vi.fn(),
      } as unknown as IDBDatabase;
      const requestEvents = makeEventTarget();
      const request = {
        addEventListener: requestEvents.addEventListener,
        result: database,
      } as unknown as IDBOpenDBRequest;
      vi.stubGlobal("indexedDB", {
        open: vi.fn(() => request),
      });

      const open = yield* Effect.forkChild(openConnectionStorageDatabase());
      yield* Effect.yieldNow;
      requestEvents.emit("success");
      expect(yield* Fiber.join(open)).toBe(database);

      databaseEvents.emit("versionchange");

      expect(database.close).toHaveBeenCalledOnce();
    }),
  );

  it.effect("fails a blocked upgrade instead of leaving project bootstrap pending forever", () =>
    Effect.gen(function* () {
      const database = {
        close: vi.fn(),
      } as unknown as IDBDatabase;
      const requestEvents = makeEventTarget();
      const request = {
        addEventListener: requestEvents.addEventListener,
        result: database,
      } as unknown as IDBOpenDBRequest;
      vi.stubGlobal("indexedDB", {
        open: vi.fn(() => request),
      });

      const open = yield* Effect.forkChild(openConnectionStorageDatabase());
      yield* Effect.yieldNow;
      requestEvents.emit("blocked");
      const error = yield* Fiber.join(open).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ConnectionTransientError",
        detail: expect.stringContaining("Retrying will continue automatically"),
      });

      requestEvents.emit("success");
      expect(database.close).toHaveBeenCalledOnce();
    }),
  );
});
