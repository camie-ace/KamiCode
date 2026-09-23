import {
  fetchSpeechTranscriptionApiKeyStatus,
  transcribeEnvironmentSpeech,
  updateSpeechTranscriptionApiKey,
} from "@t3tools/client-runtime/state/speech-transcription";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";

class SpeechTranscriptionConnectionError extends Schema.TaggedError<SpeechTranscriptionConnectionError>()(
  "SpeechTranscriptionConnectionError",
  { message: Schema.String },
) {}

export const transcribeSpeechCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "speech-transcription",
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId; readonly file: File }) =>
      input.environmentId,
  },
  execute: (input: { readonly environmentId: EnvironmentId; readonly file: File }, registry) =>
    Effect.gen(function* () {
      // Read through the same registry that owns the command so a reconnect
      // swaps credentials before the request starts.
      const prepared = Option.getOrNull(
        registry.get(environmentSession.preparedConnectionValueAtom(input.environmentId)),
      );
      if (prepared === null) {
        return yield* new SpeechTranscriptionConnectionError({
          message: "The environment is not connected.",
        });
      }
      return yield* transcribeEnvironmentSpeech({ prepared, file: input.file });
    }),
});

const speechSettingsPreparedConnection = (
  environmentId: EnvironmentId,
  registry: Parameters<Parameters<typeof createRuntimeCommand>[1]["execute"]>[1],
) => Option.getOrNull(registry.get(environmentSession.preparedConnectionValueAtom(environmentId)));

export const fetchSpeechTranscriptionApiKeyStatusCommand = createRuntimeCommand(
  connectionAtomRuntime,
  {
    label: "speech-transcription-api-key-status",
    concurrency: {
      mode: "serial",
      key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
    },
    execute: (input: { readonly environmentId: EnvironmentId }, registry) =>
      Effect.gen(function* () {
        const prepared = speechSettingsPreparedConnection(input.environmentId, registry);
        if (prepared === null) {
          return yield* new SpeechTranscriptionConnectionError({
            message: "The environment is not connected.",
          });
        }
        return yield* fetchSpeechTranscriptionApiKeyStatus({ prepared });
      }),
  },
);

export const updateSpeechTranscriptionApiKeyCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "speech-transcription-api-key-update",
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (
    input: { readonly environmentId: EnvironmentId; readonly apiKey: string | null },
    registry,
  ) =>
    Effect.gen(function* () {
      const prepared = speechSettingsPreparedConnection(input.environmentId, registry);
      if (prepared === null) {
        return yield* new SpeechTranscriptionConnectionError({
          message: "The environment is not connected.",
        });
      }
      return yield* updateSpeechTranscriptionApiKey({
        prepared,
        payload: { apiKey: input.apiKey },
      });
    }),
});
