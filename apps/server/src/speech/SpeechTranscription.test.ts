import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  makeWithEndpoint,
  SpeechTranscriptionInputError,
  SpeechTranscriptionServiceError,
} from "./SpeechTranscription.ts";

const endpoint = new URL("http://127.0.0.1:8087/inference");
const openAiCompatibleEndpoint = new URL("http://127.0.0.1:8088/v1/audio/transcriptions");
const isInputError = Schema.is(SpeechTranscriptionInputError);
const isServiceError = Schema.is(SpeechTranscriptionServiceError);

const httpClientLayer = (execute: Parameters<typeof HttpClient.make>[0]) =>
  Layer.succeed(HttpClient.HttpClient, HttpClient.make(execute));

const withRecording = <A, E, R>(
  contentType: string,
  effect: (path: string) => Effect.Effect<A, E, R>,
  bytes = contentType.startsWith("audio/ogg")
    ? new Uint8Array([0x4f, 0x67, 0x67, 0x53])
    : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* fileSystem.makeTempFileScoped({ suffix: ".audio" });
    yield* fileSystem.writeFile(path, bytes);
    return yield* effect(path);
  }).pipe(Effect.scoped);

describe("SpeechTranscription", () => {
  it.effect("forwards configured Whisper fields and trims the resulting text", () => {
    let observedRequest = false;
    return withRecording("audio/webm;codecs=opus", (path) =>
      Effect.gen(function* () {
        const service = yield* makeWithEndpoint(
          endpoint,
          "  Nigerian English.  KamiCode, TypeScript, GitHub, Playwright.  ",
          "  Systran/faster-whisper-small.en  ",
        );
        const text = yield* service.transcribe({ path, contentType: "audio/webm;codecs=opus" });
        assert.strictEqual(text, "write the regression test");
        assert.isTrue(observedRequest);
      }).pipe(
        Effect.provide(
          httpClientLayer((request) =>
            Effect.sync(() => {
              assert.strictEqual(request.url, endpoint.toString());
              assert.strictEqual(request.method, "POST");
              assert.strictEqual(request.body._tag, "FormData");
              if (request.body._tag !== "FormData") {
                throw new Error("Expected multipart form data");
              }
              const file = request.body.formData.get("file");
              assert.instanceOf(file, File);
              assert.strictEqual(file.name, "recording.webm");
              assert.strictEqual(file.type, "audio/webm");
              assert.strictEqual(file.size, 4);
              assert.strictEqual(request.body.formData.get("response_format"), "json");
              assert.strictEqual(request.body.formData.get("temperature"), "0.0");
              assert.strictEqual(
                request.body.formData.get("model"),
                "Systran/faster-whisper-small.en",
              );
              assert.strictEqual(
                request.body.formData.get("prompt"),
                "Nigerian English. KamiCode, TypeScript, GitHub, Playwright.",
              );
              assert.strictEqual(request.body.formData.get("carry_initial_prompt"), "true");
              observedRequest = true;
              return HttpClientResponse.fromWeb(
                request,
                Response.json({ text: "  write the regression test  " }),
              );
            }),
          ),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("omits whisper.cpp-only fields for an OpenAI-compatible endpoint", () =>
    withRecording("audio/webm", (path) =>
      Effect.gen(function* () {
        const service = yield* makeWithEndpoint(
          openAiCompatibleEndpoint,
          "Nigerian English.",
          "Systran/faster-whisper-small.en",
        );
        yield* service.transcribe({ path, contentType: "audio/webm" });
      }).pipe(
        Effect.provide(
          httpClientLayer((request) => {
            assert.strictEqual(request.url, openAiCompatibleEndpoint.toString());
            assert.strictEqual(request.body._tag, "FormData");
            if (request.body._tag !== "FormData") {
              throw new Error("Expected multipart form data");
            }
            assert.strictEqual(request.body.formData.get("prompt"), "Nigerian English.");
            assert.strictEqual(
              request.body.formData.get("model"),
              "Systran/faster-whisper-small.en",
            );
            assert.isNull(request.body.formData.get("carry_initial_prompt"));
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, Response.json({ text: "ship it" })),
            );
          }),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects unsupported media before contacting the model server", () => {
    let requests = 0;
    return withRecording("application/octet-stream", (path) =>
      Effect.gen(function* () {
        const service = yield* makeWithEndpoint(endpoint);
        const error = yield* service
          .transcribe({ path, contentType: "application/octet-stream" })
          .pipe(Effect.flip);
        assert.isTrue(isInputError(error));
        assert.strictEqual(requests, 0);
      }).pipe(
        Effect.provide(
          httpClientLayer((request) => {
            requests += 1;
            return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ text: "" })));
          }),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("turns malformed upstream responses into a service error", () =>
    withRecording("audio/ogg", (path) =>
      Effect.gen(function* () {
        const service = yield* makeWithEndpoint(endpoint);
        const error = yield* service
          .transcribe({ path, contentType: "audio/ogg" })
          .pipe(Effect.flip);
        assert.isTrue(isServiceError(error));
      }).pipe(
        Effect.provide(
          httpClientLayer((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ nope: true }))),
          ),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects mislabeled bytes before they reach ffmpeg", () => {
    let requests = 0;
    return withRecording(
      "audio/webm",
      (path) =>
        Effect.gen(function* () {
          const service = yield* makeWithEndpoint(endpoint);
          const error = yield* service
            .transcribe({ path, contentType: "audio/webm" })
            .pipe(Effect.flip);
          assert.isTrue(isInputError(error));
          assert.strictEqual(requests, 0);
        }).pipe(
          Effect.provide(
            httpClientLayer((request) => {
              requests += 1;
              return Effect.succeed(
                HttpClientResponse.fromWeb(request, Response.json({ text: "" })),
              );
            }),
          ),
        ),
      new Uint8Array([1, 2, 3, 4]),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("serializes model work so concurrent recordings cannot saturate the CPU", () => {
    let active = 0;
    let maximumActive = 0;
    return withRecording("audio/webm", (path) =>
      Effect.gen(function* () {
        const service = yield* makeWithEndpoint(endpoint);
        yield* Effect.all(
          [
            service.transcribe({ path, contentType: "audio/webm" }),
            service.transcribe({ path, contentType: "audio/webm" }),
          ],
          { concurrency: "unbounded" },
        );
        assert.strictEqual(maximumActive, 1);
      }).pipe(
        Effect.provide(
          httpClientLayer((request) =>
            Effect.gen(function* () {
              active += 1;
              maximumActive = Math.max(maximumActive, active);
              yield* Effect.yieldNow;
              active -= 1;
              return HttpClientResponse.fromWeb(request, Response.json({ text: "ok" }));
            }),
          ),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer));
  });
});
