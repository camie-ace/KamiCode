import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  ThreadLockService,
  ThreadLockServiceLive,
  requireThreadLockAccess,
} from "./ThreadLockService.ts";

const makeTestLayer = (values: Map<string, Uint8Array>) => {
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromUndefinedOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    create: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const value = values.get(name) ?? new Uint8Array(bytes).fill(7);
        values.set(name, value);
        return value;
      }),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
  return ThreadLockServiceLive.pipe(
    Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, store)),
  );
};

describe("ThreadLockService", () => {
  it.effect("stores only a salted hash and scopes authorization to a session", () => {
    const values = new Map<string, Uint8Array>();
    const threadId = ThreadId.make("locked-thread");
    return Effect.gen(function* () {
      const locks = yield* ThreadLockService;
      yield* locks.setPasscode(threadId, "correct horse");

      const stored = [...values.values()][0];
      expect(stored).toBeDefined();
      expect(new TextDecoder().decode(stored)).not.toContain("correct horse");
      expect(yield* locks.authorize(threadId, "session-a", "wrong passcode")).toBe(false);
      expect(locks.isAuthorized(threadId, "session-a")).toBe(false);
      expect(yield* locks.authorize(threadId, "session-a", "correct horse")).toBe(true);
      expect(locks.isAuthorized(threadId, "session-a")).toBe(true);
      expect(locks.isAuthorized(threadId, "session-b")).toBe(false);

      expect(yield* locks.remove(threadId, "session-a", "correct horse")).toBe(true);
      expect(locks.isAuthorized(threadId, "session-a")).toBe(false);
      expect(values.size).toBe(0);
    }).pipe(Effect.provide(makeTestLayer(values)));
  });
  it.effect(
    "denies locked reads until this session unlocks and revokes access after a passcode change",
    () => {
      const threadId = ThreadId.make("access-thread");
      return Effect.gen(function* () {
        const locks = yield* ThreadLockService;
        yield* locks.setPasscode(threadId, "initial-passcode");
        const read = (sessionId: string) =>
          requireThreadLockAccess({ threadId, locked: true }, sessionId);
        expect((yield* Effect.exit(read("first")))._tag).toBe("Failure");
        yield* locks.authorize(threadId, "first", "initial-passcode");
        yield* read("first");
        expect((yield* Effect.exit(read("second")))._tag).toBe("Failure");
        yield* locks.setPasscode(threadId, "replacement-passcode");
        expect((yield* Effect.exit(read("first")))._tag).toBe("Failure");
        yield* requireThreadLockAccess({ threadId, locked: false }, "second");
      }).pipe(Effect.provide(makeTestLayer(new Map())));
    },
  );
});
