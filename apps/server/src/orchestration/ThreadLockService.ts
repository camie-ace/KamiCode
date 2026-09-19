import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

const scrypt = NodeUtil.promisify(NodeCrypto.scrypt);
const encoder = new TextEncoder();

const StoredThreadLock = Schema.Struct({
  version: Schema.Literal(1),
  salt: Schema.String,
  hash: Schema.String,
});
type StoredThreadLock = typeof StoredThreadLock.Type;
const StoredThreadLockJson = Schema.fromJsonString(StoredThreadLock);
const decodeStoredThreadLock = Schema.decodeUnknownEffect(StoredThreadLockJson);
const encodeStoredThreadLock = Schema.encodeEffect(StoredThreadLockJson);

class ThreadLockStorageError extends Data.TaggedError("ThreadLockStorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const secretName = (threadId: ThreadId) =>
  `thread-lock-${Buffer.from(String(threadId)).toString("base64url")}`;

interface ThreadLockServiceShape {
  readonly setPasscode: (
    threadId: ThreadId,
    passcode: string,
  ) => Effect.Effect<void, ThreadLockStorageError>;
  readonly authorize: (
    threadId: ThreadId,
    sessionId: string,
    passcode: string,
  ) => Effect.Effect<boolean, ThreadLockStorageError>;
  readonly remove: (
    threadId: ThreadId,
    sessionId: string,
    passcode: string,
  ) => Effect.Effect<boolean, ThreadLockStorageError>;
  readonly isAuthorized: (threadId: ThreadId, sessionId: string) => boolean;
  readonly revoke: (threadId: ThreadId) => void;
}

export class ThreadLockService extends Context.Reference<ThreadLockServiceShape>(
  "t3/orchestration/ThreadLockService",
  {
    // Most isolated route/unit layers predate thread locking. Keep those
    // layers fail-closed without forcing every unrelated test to provision a
    // credential store; the production server overrides this reference with
    // ThreadLockServiceLive below.
    defaultValue: () => ({
      setPasscode: () =>
        Effect.fail(new ThreadLockStorageError({ message: "Thread lock storage is unavailable." })),
      authorize: () => Effect.succeed(false),
      remove: () => Effect.succeed(false),
      isAuthorized: () => false,
      revoke: () => undefined,
    }),
  },
) {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const authorizedBySession = new Map<string, Set<string>>();
  const derive = (passcode: string, salt: Buffer) =>
    Effect.tryPromise({
      try: () => scrypt(passcode, salt, 32).then((value) => Buffer.from(value as ArrayBuffer)),
      catch: (cause) =>
        new ThreadLockStorageError({ message: "Could not verify thread passcode.", cause }),
    });
  const read = (threadId: ThreadId) =>
    secrets.get(secretName(threadId)).pipe(
      Effect.mapError(
        (cause) => new ThreadLockStorageError({ message: "Could not read thread lock.", cause }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed<StoredThreadLock | null>(null),
          onSome: (bytes) =>
            decodeStoredThreadLock(new TextDecoder().decode(bytes)).pipe(
              Effect.mapError(
                (cause) =>
                  new ThreadLockStorageError({ message: "Thread lock data is invalid.", cause }),
              ),
            ),
        }),
      ),
    );
  const verify = (threadId: ThreadId, passcode: string) =>
    Effect.gen(function* () {
      const stored = yield* read(threadId);
      if (!stored) return false;
      const expected = Buffer.from(stored.hash, "base64url");
      const actual = yield* derive(passcode, Buffer.from(stored.salt, "base64url"));
      return actual.length === expected.length && NodeCrypto.timingSafeEqual(actual, expected);
    });
  const revoke = (threadId: ThreadId) => {
    for (const entries of authorizedBySession.values()) entries.delete(String(threadId));
  };

  return ThreadLockService.of({
    setPasscode: (threadId, passcode) =>
      Effect.gen(function* () {
        const salt = NodeCrypto.randomBytes(16);
        const hash = yield* derive(passcode, salt);
        const record: StoredThreadLock = {
          version: 1,
          salt: salt.toString("base64url"),
          hash: hash.toString("base64url"),
        };
        const encoded = yield* encodeStoredThreadLock(record).pipe(
          Effect.mapError(
            (cause) =>
              new ThreadLockStorageError({ message: "Could not encode thread lock.", cause }),
          ),
        );
        yield* secrets
          .set(secretName(threadId), encoder.encode(encoded))
          .pipe(
            Effect.mapError(
              (cause) =>
                new ThreadLockStorageError({ message: "Could not save thread lock.", cause }),
            ),
          );
        revoke(threadId);
      }),
    authorize: (threadId, sessionId, passcode) =>
      verify(threadId, passcode).pipe(
        Effect.tap((valid) =>
          Effect.sync(() => {
            if (!valid) return;
            const entries = authorizedBySession.get(sessionId) ?? new Set<string>();
            entries.add(String(threadId));
            authorizedBySession.set(sessionId, entries);
          }),
        ),
      ),
    remove: (threadId, sessionId, passcode) =>
      verify(threadId, passcode).pipe(
        Effect.tap((valid) =>
          valid
            ? secrets.remove(secretName(threadId)).pipe(
                Effect.mapError(
                  (cause) =>
                    new ThreadLockStorageError({
                      message: "Could not remove thread lock.",
                      cause,
                    }),
                ),
                Effect.tap(() => Effect.sync(() => revoke(threadId))),
              )
            : Effect.void,
        ),
        Effect.tap(() =>
          Effect.sync(() => authorizedBySession.get(sessionId)?.delete(String(threadId))),
        ),
      ),
    isAuthorized: (threadId, sessionId) =>
      authorizedBySession.get(sessionId)?.has(String(threadId)) === true,
    revoke,
  });
});

export const ThreadLockServiceLive = Layer.effect(ThreadLockService, make);
