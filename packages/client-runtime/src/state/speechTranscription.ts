import {
  SPEECH_TRANSCRIPTION_MAX_FILE_BYTES,
  type SpeechTranscriptionResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const SPEECH_TRANSCRIPTION_TIMEOUT_MS = 75_000;

export class SpeechTranscriptionValidationError extends Schema.TaggedErrorClass<SpeechTranscriptionValidationError>()(
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

  const requestUrl = environmentEndpointUrl(input.prepared.httpBaseUrl, "/api/speech/transcribe");
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "POST",
    requestUrl,
    signer,
  );
  const payload = new FormData();
  payload.append("files", input.file, input.file.name);

  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    SPEECH_TRANSCRIPTION_TIMEOUT_MS,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      client.speech.transcribe({ headers, payload }),
    ),
  );
});

export type TranscribeEnvironmentSpeechError =
  | SpeechTranscriptionValidationError
  | RemoteEnvironmentRequestError;

export type TranscribeEnvironmentSpeechResult = SpeechTranscriptionResult;
