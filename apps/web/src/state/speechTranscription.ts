import { transcribeEnvironmentSpeech } from "@t3tools/client-runtime/state/speech-transcription";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";

class SpeechTranscriptionConnectionError extends Schema.TaggedErrorClass<SpeechTranscriptionConnectionError>()(
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
