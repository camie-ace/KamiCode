import {
  SPEECH_TRANSCRIPTION_MAX_FILE_BYTES,
  type SpeechTranscriptionApiKeyStatus,
  type SpeechTranscriptionResult,
  type UpdateSpeechTranscriptionApiKeyRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

const SPEECH_TRANSCRIPTION_TIMEOUT_MS = 75_000;
const SPEECH_TRANSCRIPTION_SETTINGS_TIMEOUT_MS = 10_000;

export class SpeechTranscriptionValidationError extends Schema.TaggedError<SpeechTranscriptionValidationError>()(
  "SpeechTranscriptionValidationError",
  { message: Schema.String },
) {}

export const transcribeEnvironmentSpeech = Effect.fn(
  "clientRuntime.state.transcribeEnvironmentSpeech",
)(function* (input: { readonly prepared: PreparedConnection; readonly file: File }) {
  if (input.file.size === 0) {
    return yield* new SpeechTranscriptionValidationError({
      message: "The recording is empty.",
    });
  }
  if (input.file.size > SPEECH_TRANSCRIPTION_MAX_FILE_BYTES) {
    return yield* new SpeechTranscriptionValidationError({
      message: "The recording is too large. Try a shorter prompt.",
    });
  }

  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  const payload = new FormData();
  payload.append("files", input.file, input.file.name);

  return yield* executeAuthenticatedEnvironmentHttpRequest({
    group: "speech",
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    method: "POST",
    url: (httpBaseUrl) => environmentEndpointUrl(httpBaseUrl, "/api/speech/transcribe"),
    timeoutMs: SPEECH_TRANSCRIPTION_TIMEOUT_MS,
    request: ({ client, headers }) => client.transcribe({ headers, payload }),
  });
});

export type TranscribeEnvironmentSpeechError =
  | SpeechTranscriptionValidationError
  | RemoteEnvironmentRequestError;

export type TranscribeEnvironmentSpeechResult = SpeechTranscriptionResult;

export const fetchSpeechTranscriptionApiKeyStatus = Effect.fn(
  "clientRuntime.state.fetchSpeechTranscriptionApiKeyStatus",
)(function* (input: { readonly prepared: PreparedConnection }) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    group: "speech",
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    method: "GET",
    url: (httpBaseUrl) => environmentEndpointUrl(httpBaseUrl, "/api/speech/api-key"),
    timeoutMs: SPEECH_TRANSCRIPTION_SETTINGS_TIMEOUT_MS,
    request: ({ client, headers }) => client.apiKeyStatus({ headers }),
  });
});

export const updateSpeechTranscriptionApiKey = Effect.fn(
  "clientRuntime.state.updateSpeechTranscriptionApiKey",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly payload: UpdateSpeechTranscriptionApiKeyRequest;
}) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    group: "speech",
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    method: "PUT",
    url: (httpBaseUrl) => environmentEndpointUrl(httpBaseUrl, "/api/speech/api-key"),
    timeoutMs: SPEECH_TRANSCRIPTION_SETTINGS_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.updateApiKey({
        headers,
        payload: input.payload,
      }),
  });
});

export type SpeechTranscriptionApiKeyStatusResult = SpeechTranscriptionApiKeyStatus;
