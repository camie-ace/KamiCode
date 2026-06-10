import {
  DesktopDiscoveredSshHostSchema,
  DesktopSshBearerBootstrapInputSchema,
  DesktopSshBearerRequestInputSchema,
  DesktopCollabServerDeployInputSchema,
  DesktopCollabServerDeployResultSchema,
  DesktopSshEnvironmentEnsureInputSchema,
  DesktopSshEnvironmentEnsureResultSchema,
  DesktopSshEnvironmentTargetSchema,
  DesktopSshHttpBaseUrlInputSchema,
  DesktopSshPasswordPromptCancelledType,
  DesktopSshPasswordPromptResolutionInputSchema,
  ExecutionEnvironmentDescriptor,
  AuthBearerBootstrapResultJson,
  AuthSessionStateJson,
  AuthWebSocketTokenResultJson,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";
import * as DesktopSshEnvironment from "../../ssh/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "../../ssh/DesktopSshPasswordPrompts.ts";
import * as DesktopSshRemoteApi from "../../ssh/DesktopSshRemoteApi.ts";
import * as DesktopCollabServerDeploy from "../../ssh/DesktopCollabServerDeploy.ts";

export const discoverSshHosts = makeIpcMethod({
  channel: IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopDiscoveredSshHostSchema),
  handler: Effect.fn("desktop.ipc.sshEnvironment.discoverHosts")(function* () {
    const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
    return yield* sshEnvironment.discoverHosts();
  }),
});

export const ensureSshEnvironment = makeIpcMethod({
  channel: IpcChannels.ENSURE_SSH_ENVIRONMENT_CHANNEL,
  payload: DesktopSshEnvironmentEnsureInputSchema,
  result: DesktopSshEnvironmentEnsureResultSchema,
  handler: Effect.fn("desktop.ipc.sshEnvironment.ensureEnvironment")(function* ({
    target,
    options,
  }) {
    const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
    return yield* sshEnvironment.ensureEnvironment(target, options).pipe(
      Effect.catch((error) =>
        DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(error)
          ? Effect.succeed({
              type: DesktopSshPasswordPromptCancelledType,
              message: error.message,
            })
          : Effect.fail(error),
      ),
    );
  }),
});

export const disconnectSshEnvironment = makeIpcMethod({
  channel: IpcChannels.DISCONNECT_SSH_ENVIRONMENT_CHANNEL,
  payload: DesktopSshEnvironmentTargetSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.sshEnvironment.disconnectEnvironment")(function* (target) {
    const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
    yield* sshEnvironment.disconnectEnvironment(target);
  }),
});

export const fetchSshEnvironmentDescriptor = makeIpcMethod({
  channel: IpcChannels.FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
  payload: DesktopSshHttpBaseUrlInputSchema,
  result: ExecutionEnvironmentDescriptor,
  handler: Effect.fn("desktop.ipc.sshEnvironment.fetchDescriptor")(function* ({ httpBaseUrl }) {
    const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
    return yield* remoteApi.fetchEnvironmentDescriptor({ httpBaseUrl });
  }),
});

export const bootstrapSshBearerSession = makeIpcMethod({
  channel: IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
  payload: DesktopSshBearerBootstrapInputSchema,
  result: AuthBearerBootstrapResultJson,
  handler: Effect.fn("desktop.ipc.sshEnvironment.bootstrapBearerSession")(function* ({
    httpBaseUrl,
    credential,
  }) {
    const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
    return yield* remoteApi.bootstrapBearerSession({ httpBaseUrl, credential });
  }),
});

export const fetchSshSessionState = makeIpcMethod({
  channel: IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthSessionStateJson,
  handler: Effect.fn("desktop.ipc.sshEnvironment.fetchSessionState")(function* ({
    httpBaseUrl,
    bearerToken,
  }) {
    const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
    return yield* remoteApi.fetchSessionState({ httpBaseUrl, bearerToken });
  }),
});

export const issueSshWebSocketToken = makeIpcMethod({
  channel: IpcChannels.ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthWebSocketTokenResultJson,
  handler: Effect.fn("desktop.ipc.sshEnvironment.issueWebSocketToken")(function* ({
    httpBaseUrl,
    bearerToken,
  }) {
    const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
    return yield* remoteApi.issueWebSocketToken({ httpBaseUrl, bearerToken });
  }),
});

export const deployCollabServer = makeIpcMethod({
  channel: IpcChannels.DEPLOY_COLLAB_SERVER_CHANNEL,
  payload: DesktopCollabServerDeployInputSchema,
  result: DesktopCollabServerDeployResultSchema,
  handler: Effect.fn("desktop.ipc.sshEnvironment.deployCollabServer")(function* ({
    target,
    options,
  }) {
    return yield* DesktopCollabServerDeploy.deployCollabServer({
      target,
      ...(options?.password === undefined ? {} : { password: options.password }),
      ...(options?.publicBaseUrl === undefined ? {} : { publicBaseUrl: options.publicBaseUrl }),
      ...(options?.installDocker === undefined ? {} : { installDocker: options.installDocker }),
    });
  }),
});

export const resolveSshPasswordPrompt = makeIpcMethod({
  channel: IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
  payload: DesktopSshPasswordPromptResolutionInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.sshEnvironment.resolvePasswordPrompt")(function* ({
    requestId,
    password,
  }) {
    const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
    yield* prompts.resolve({ requestId, password });
  }),
});
