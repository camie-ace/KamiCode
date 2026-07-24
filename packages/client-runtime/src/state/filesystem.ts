import {
  WORKSPACE_UPLOAD_MAX_FILE_BYTES,
  WORKSPACE_UPLOAD_MAX_FILES,
  WS_METHODS,
  type WorkspaceUploadConflict,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

const WORKSPACE_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export class WorkspaceUploadValidationError extends Data.TaggedError(
  "WorkspaceUploadValidationError",
)<{
  readonly message: string;
}> {}

export const uploadEnvironmentWorkspaceFiles = Effect.fn(
  "clientRuntime.state.uploadEnvironmentWorkspaceFiles",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly cwd: string;
  readonly directory: string;
  readonly conflict: WorkspaceUploadConflict;
  readonly files: ReadonlyArray<File>;
}) {
  if (input.files.length === 0) {
    return yield* new WorkspaceUploadValidationError({
      message: "Choose at least one file to upload.",
    });
  }
  if (input.files.length > WORKSPACE_UPLOAD_MAX_FILES) {
    return yield* new WorkspaceUploadValidationError({
      message: `Upload up to ${WORKSPACE_UPLOAD_MAX_FILES} files at a time.`,
    });
  }
  const oversized = input.files.find((file) => file.size > WORKSPACE_UPLOAD_MAX_FILE_BYTES);
  if (oversized) {
    return yield* new WorkspaceUploadValidationError({
      message: `${oversized.name} exceeds the ${Math.round(
        WORKSPACE_UPLOAD_MAX_FILE_BYTES / (1024 * 1024),
      )}MB upload limit.`,
    });
  }

  const requestUrl = environmentEndpointUrl(input.prepared.httpBaseUrl, "/api/workspace/upload");
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "POST",
    requestUrl,
    signer,
  );
  const payload = new FormData();
  payload.append("cwd", input.cwd);
  payload.append("directory", input.directory);
  payload.append("conflict", input.conflict);
  for (const file of input.files) {
    payload.append("files", file, file.name);
  }

  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    WORKSPACE_UPLOAD_TIMEOUT_MS,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      client.workspace.upload({ headers, payload }),
    ),
  );
});

export type UploadEnvironmentWorkspaceFilesError =
  | WorkspaceUploadValidationError
  | RemoteEnvironmentRequestError;

export function createFilesystemEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    browse: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:browse",
      tag: WS_METHODS.filesystemBrowse,
    }),
  };
}
