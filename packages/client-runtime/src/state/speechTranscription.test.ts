import { EnvironmentId, SPEECH_TRANSCRIPTION_MAX_FILE_BYTES } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import {
  fetchSpeechTranscriptionApiKeyStatus,
  SpeechTranscriptionValidationError,
  transcribeEnvironmentSpeech,
  updateSpeechTranscriptionApiKey,
} from "./speechTranscription.ts";

const environmentId = EnvironmentId.make("environment-voice-test");
const isValidationError = Schema.is(SpeechTranscriptionValidationError);
const unusedClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die("Unexpected HTTP request")),
);

function preparedConnection(
  httpAuthorization: PreparedConnection["httpAuthorization"] = null,
): PreparedConnection {
  return {
    environmentId,
    label: "Voice test",
    httpBaseUrl: "https://environment.example.test/base",
    socketUrl: "wss://environment.example.test/ws",
    httpAuthorization,
    target: new PrimaryConnectionTarget({
      environmentId,
      label: "Voice test",
      httpBaseUrl: "https://environment.example.test/base",
      wsBaseUrl: "wss://environment.example.test/ws",
    }),
  };
}

describe("transcribeEnvironmentSpeech", () => {
  it.effect("sends one authenticated multipart recording through the environment API", () => {
    let observed = false;
    const clientLayer = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          assert.strictEqual(request.url, "https://environment.example.test/api/speech/transcribe");
          assert.strictEqual(request.headers.authorization, "Bearer voice-token");
          assert.strictEqual(request.body._tag, "FormData");
          if (request.body._tag !== "FormData") throw new Error("Expected form data");
          const file = request.body.formData.get("files");
          assert.instanceOf(file, File);
          assert.strictEqual(file.name, "voice-prompt.webm");
          assert.strictEqual(file.type, "audio/webm");
          observed = true;
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ text: "explain this function" }),
          );
        }),
      ),
    );

    return Effect.gen(function* () {
      const result = yield* transcribeEnvironmentSpeech({
        prepared: preparedConnection({ _tag: "Bearer", token: "voice-token" }),
        file: new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], "voice-prompt.webm", {
          type: "audio/webm",
        }),
      });
      assert.deepStrictEqual(result, { text: "explain this function" });
      assert.isTrue(observed);
    }).pipe(Effect.provide(clientLayer));
  });

  it.effect("rejects oversized recordings before opening a connection", () =>
    Effect.gen(function* () {
      const error = yield* transcribeEnvironmentSpeech({
        prepared: preparedConnection(),
        file: {
          size: SPEECH_TRANSCRIPTION_MAX_FILE_BYTES + 1,
        } as File,
      }).pipe(Effect.flip);
      assert.isTrue(isValidationError(error));
    }).pipe(Effect.provide(unusedClientLayer)),
  );
});

describe("speech transcription API key settings", () => {
  it.effect("reads and updates key status without receiving the secret", () => {
    const observedMethods: Array<string> = [];
    const clientLayer = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          assert.strictEqual(request.url, "https://environment.example.test/api/speech/api-key");
          assert.strictEqual(request.headers.authorization, "Bearer voice-token");
          observedMethods.push(request.method);
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ configured: true, source: "settings" }),
          );
        }),
      ),
    );

    return Effect.gen(function* () {
      const prepared = preparedConnection({ _tag: "Bearer", token: "voice-token" });
      const before = yield* fetchSpeechTranscriptionApiKeyStatus({ prepared });
      const after = yield* updateSpeechTranscriptionApiKey({
        prepared,
        payload: { apiKey: "new-secret" },
      });
      assert.deepStrictEqual(before, { configured: true, source: "settings" });
      assert.deepStrictEqual(after, { configured: true, source: "settings" });
      assert.deepStrictEqual(observedMethods, ["GET", "PUT"]);
    }).pipe(Effect.provide(clientLayer));
  });
});
