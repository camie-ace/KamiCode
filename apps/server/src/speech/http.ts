import {
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as SpeechTranscription from "./SpeechTranscription.ts";

export const speechHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "speech",
  Effect.fnUntraced(function* (handlers) {
    const speechTranscription = yield* SpeechTranscription.SpeechTranscription;

    return handlers.handle(
      "transcribe",
      Effect.fn("environment.speech.transcribe")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        const file = args.payload.files[0]!;
        const text = yield* speechTranscription
          .transcribe({ path: file.path, contentType: file.contentType })
          .pipe(
            Effect.catchTags({
              SpeechTranscriptionInputError: (error) =>
                Effect.fail(new EnvironmentHttpBadRequestError({ message: error.message })),
              SpeechTranscriptionServiceError: (error) =>
                failEnvironmentInternal("internal_error", error),
            }),
          );
        return { text };
      }),
    );
  }),
);
