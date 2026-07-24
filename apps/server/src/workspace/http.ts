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
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";

export const workspaceHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "workspace",
  Effect.fnUntraced(function* (handlers) {
    const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

    return handlers.handle(
      "upload",
      Effect.fn("environment.workspace.upload")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* workspaceFileSystem
          .uploadFiles({
            cwd: args.payload.cwd,
            directory: args.payload.directory,
            conflict: args.payload.conflict,
            files: args.payload.files.map((file) => ({
              name: file.name,
              path: file.path,
            })),
          })
          .pipe(
            Effect.catchTags({
              WorkspacePathOutsideRootError: (error) =>
                Effect.fail(
                  new EnvironmentHttpBadRequestError({
                    message: "Upload destination must stay inside the project workspace.",
                  }),
                ).pipe(Effect.annotateLogs({ cause: error.message })),
              WorkspaceFilePathEscapeError: (error) =>
                Effect.fail(
                  new EnvironmentHttpBadRequestError({
                    message: "Upload destination must stay inside the project workspace.",
                  }),
                ).pipe(Effect.annotateLogs({ cause: error.message })),
              WorkspaceUploadTargetError: (error) =>
                Effect.fail(new EnvironmentHttpBadRequestError({ message: error.message })),
              WorkspaceUploadOperationError: (error) =>
                failEnvironmentInternal("internal_error", error),
            }),
          );
      }),
    );
  }),
);
