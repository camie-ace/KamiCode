import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  readSpeechTranscriptionApiKey,
  setSpeechTranscriptionApiKey,
} from "./SpeechTranscriptionApiKey.ts";

function makeSecretStore() {
  const values = new Map<string, Uint8Array>();
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromUndefinedOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: () => Effect.die("unused"),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
  return store;
}

describe("SpeechTranscriptionApiKey", () => {
  it.effect("stores a settings key without exposing it through status", () =>
    Effect.gen(function* () {
      const store = makeSecretStore();
      yield* setSpeechTranscriptionApiKey(store, "  saved-key  ");
      const state = yield* readSpeechTranscriptionApiKey(store, Redacted.make("environment-key"));
      assert.strictEqual(state.source, "settings");
      assert.strictEqual(Redacted.value(state.apiKey!), "saved-key");
    }),
  );

  it.effect("falls back to the environment key after the saved key is cleared", () =>
    Effect.gen(function* () {
      const store = makeSecretStore();
      yield* setSpeechTranscriptionApiKey(store, "saved-key");
      yield* setSpeechTranscriptionApiKey(store, null);
      const state = yield* readSpeechTranscriptionApiKey(store, Redacted.make("environment-key"));
      assert.strictEqual(state.source, "environment");
      assert.strictEqual(Redacted.value(state.apiKey!), "environment-key");
    }),
  );
});
