import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { ServerSecretStore } from "../auth/ServerSecretStore.ts";

export const SPEECH_TRANSCRIPTION_API_KEY_SECRET = "speech-transcription-api-key";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SpeechTranscriptionApiKeyState {
  readonly apiKey: Redacted.Redacted<string> | undefined;
  readonly source: "settings" | "environment" | "none";
}

const environmentState = (
  environmentApiKey: Redacted.Redacted<string> | undefined,
): SpeechTranscriptionApiKeyState => ({
  apiKey: environmentApiKey,
  source: environmentApiKey === undefined ? "none" : "environment",
});

export const readSpeechTranscriptionApiKey = (
  secrets: ServerSecretStore["Service"],
  environmentApiKey: Redacted.Redacted<string> | undefined,
) =>
  secrets.get(SPEECH_TRANSCRIPTION_API_KEY_SECRET).pipe(
    Effect.map(
      Option.match({
        onNone: () => environmentState(environmentApiKey),
        onSome: (bytes): SpeechTranscriptionApiKeyState => {
          const value = decoder.decode(bytes).trim();
          return value.length === 0
            ? environmentState(environmentApiKey)
            : { apiKey: Redacted.make(value), source: "settings" };
        },
      }),
    ),
  );

export const setSpeechTranscriptionApiKey = (
  secrets: ServerSecretStore["Service"],
  apiKey: string | null,
) =>
  apiKey === null
    ? secrets.remove(SPEECH_TRANSCRIPTION_API_KEY_SECRET)
    : secrets.set(SPEECH_TRANSCRIPTION_API_KEY_SECRET, encoder.encode(apiKey.trim()));
