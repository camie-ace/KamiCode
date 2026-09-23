import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";

const TRANSCRIPTION_TIMEOUT = "60 seconds";
const TRANSCRIPTION_MODEL_MAX_LENGTH = 300;
const TRANSCRIPTION_PROMPT_MAX_LENGTH = 1_000;
const DEFAULT_TRANSCRIPTION_ENDPOINT = new URL("https://api.openai.com/v1/audio/transcriptions");
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

const TranscriptionResponse = Schema.Struct({
  text: Schema.String,
});

const decodeTranscriptionResponse = HttpClientResponse.schemaBodyJson(TranscriptionResponse);

const supportedAudioTypes = new Map<string, string>([
  ["audio/aac", "aac"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/x-m4a", "m4a"],
  ["audio/x-wav", "wav"],
]);

function baseContentType(contentType: string): string {
  return contentType.split(";", 1)[0]!.trim().toLowerCase();
}

function normalizeInitialPrompt(prompt: string | undefined): string | undefined {
  const normalized = prompt?.trim().replace(/\s+/gu, " ");
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized.slice(0, TRANSCRIPTION_PROMPT_MAX_LENGTH);
}

function normalizeModel(model: string | undefined): string | undefined {
  const normalized = model?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized.slice(0, TRANSCRIPTION_MODEL_MAX_LENGTH);
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: ReadonlyArray<number>): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function hasSupportedAudioSignature(bytes: Uint8Array, contentType: string): boolean {
  switch (baseContentType(contentType)) {
    case "audio/webm":
      return bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/ogg":
      return bytesEqual(bytes, 0, [0x4f, 0x67, 0x67, 0x53]);
    case "audio/wav":
    case "audio/x-wav":
      return (
        bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
        bytesEqual(bytes, 8, [0x57, 0x41, 0x56, 0x45])
      );
    case "audio/mp4":
    case "audio/x-m4a":
      return bytesEqual(bytes, 4, [0x66, 0x74, 0x79, 0x70]);
    case "audio/mpeg":
      return (
        bytesEqual(bytes, 0, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0)
      );
    case "audio/aac":
      return bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xf0) === 0xf0;
  }
  return false;
}

export class SpeechTranscriptionInputError extends Schema.TaggedError<SpeechTranscriptionInputError>()(
  "SpeechTranscriptionInputError",
  {
    reason: Schema.Literals(["empty_audio", "invalid_audio", "unsupported_media_type"]),
    contentType: Schema.String,
  },
) {
  override get message(): string {
    if (this.reason === "empty_audio") return "The recording is empty.";
    if (this.reason === "invalid_audio") return "The recording is not valid browser audio.";
    return `Unsupported recording type: ${this.contentType || "unknown"}.`;
  }
}

export class SpeechTranscriptionServiceError extends Schema.TaggedError<SpeechTranscriptionServiceError>()(
  "SpeechTranscriptionServiceError",
  {
    reason: Schema.Literals(["not_configured", "request_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "not_configured"
      ? "Speech transcription is not configured."
      : "The speech transcription service could not process the recording.";
  }
}

export type SpeechTranscriptionError =
  | SpeechTranscriptionInputError
  | SpeechTranscriptionServiceError;

export interface SpeechRecording {
  readonly path: string;
  readonly contentType: string;
}

export class SpeechTranscription extends Context.Service<
  SpeechTranscription,
  {
    readonly transcribe: (
      recording: SpeechRecording,
    ) => Effect.Effect<string, SpeechTranscriptionError>;
  }
>()("t3/speech/SpeechTranscription") {}

export const makeWithEndpoint = (
  configuredEndpoint: URL | undefined,
  configuredPrompt?: string,
  configuredModel?: string,
  apiKey?: Redacted.Redacted<string>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const endpoint = configuredEndpoint ?? DEFAULT_TRANSCRIPTION_ENDPOINT;
    const initialPrompt = normalizeInitialPrompt(configuredPrompt);
    const model = normalizeModel(configuredModel) ?? DEFAULT_TRANSCRIPTION_MODEL;

    const transcribeRequest = Effect.fn("SpeechTranscription.transcribeRequest")(function* (
      recording: SpeechRecording,
    ) {
      if (apiKey === undefined) {
        return yield* new SpeechTranscriptionServiceError({ reason: "not_configured" });
      }

      const contentType = baseContentType(recording.contentType);
      const extension = supportedAudioTypes.get(contentType);
      if (extension === undefined) {
        return yield* new SpeechTranscriptionInputError({
          reason: "unsupported_media_type",
          contentType,
        });
      }

      const bytes = yield* fileSystem
        .readFile(recording.path)
        .pipe(
          Effect.mapError(
            (cause) => new SpeechTranscriptionServiceError({ reason: "request_failed", cause }),
          ),
        );
      if (bytes.byteLength === 0) {
        return yield* new SpeechTranscriptionInputError({
          reason: "empty_audio",
          contentType,
        });
      }
      if (!hasSupportedAudioSignature(bytes, contentType)) {
        return yield* new SpeechTranscriptionInputError({
          reason: "invalid_audio",
          contentType,
        });
      }

      const payload = new FormData();
      payload.append("file", new Blob([bytes], { type: contentType }), `recording.${extension}`);
      payload.append("response_format", "json");
      payload.append("temperature", "0.0");
      payload.append("model", model);
      if (initialPrompt !== undefined) {
        payload.append("prompt", initialPrompt);
      }

      const response = yield* HttpClientRequest.post(endpoint.toString()).pipe(
        HttpClientRequest.bearerToken(Redacted.value(apiKey)),
        HttpClientRequest.bodyFormData(payload),
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(decodeTranscriptionResponse),
        Effect.timeout(TRANSCRIPTION_TIMEOUT),
        Effect.mapError(
          (cause) => new SpeechTranscriptionServiceError({ reason: "request_failed", cause }),
        ),
      );
      return response.text.trim();
    });

    return SpeechTranscription.of({
      transcribe: transcribeRequest,
    });
  });

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  return yield* makeWithEndpoint(
    config.speechTranscriptionUrl,
    config.speechTranscriptionPrompt,
    config.speechTranscriptionModel,
    config.speechTranscriptionApiKey,
  );
});

export const layer = Layer.effect(SpeechTranscription, make);
