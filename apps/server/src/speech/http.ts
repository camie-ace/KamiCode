import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
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
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SpeechTranscription from "./SpeechTranscription.ts";
import {
  readSpeechTranscriptionApiKey,
  setSpeechTranscriptionApiKey,
} from "./SpeechTranscriptionApiKey.ts";

export const speechHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "speech",
  Effect.fnUntraced(function* (handlers) {
    const speechTranscription = yield* SpeechTranscription.SpeechTranscription;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const config = yield* ServerConfig.ServerConfig;

    const readApiKeyStatus = readSpeechTranscriptionApiKey(
      secrets,
      config.speechTranscriptionApiKey,
    ).pipe(
      Effect.map(({ apiKey, source }) => ({ configured: apiKey !== undefined, source })),
      Effect.catchIf(ServerSecretStore.isSecretStoreError, (error) =>
        failEnvironmentInternal("internal_error", error),
      ),
    );

    return handlers
      .handle(
        "apiKeyStatus",
        Effect.fn("environment.speech.apiKeyStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* readApiKeyStatus;
        }),
      )
      .handle(
        "updateApiKey",
        Effect.fn("environment.speech.updateApiKey")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          yield* setSpeechTranscriptionApiKey(secrets, args.payload.apiKey).pipe(
            Effect.catchIf(ServerSecretStore.isSecretStoreError, (error) =>
              failEnvironmentInternal("internal_error", error),
            ),
          );
          return yield* readApiKeyStatus;
        }),
      )
      .handle(
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
                  error.reason === "not_configured"
                    ? Effect.fail(new EnvironmentHttpBadRequestError({ message: error.message }))
                    : failEnvironmentInternal("internal_error", error),
              }),
            );
          return { text };
        }),
      );
  }),
);
