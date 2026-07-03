import {
  AppendSharedThreadMessageInput,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  type EnvironmentAuthInvalidError,
  type EnvironmentInternalError,
  type EnvironmentScopeRequiredError,
  ClaimSharedProjectInviteInput,
  CreateSharedProjectInviteInput,
  DeleteSharedProjectInput,
  type DeleteSharedProjectResult,
  ImportSharedThreadInput,
  ImportSharedThreadLinkInput,
  PublishLocalProjectInput,
  PublishSharedThreadInput,
  ResolveSharedThreadShareInput,
  RemoveSharedProjectMemberInput,
  RemoveSharedSshCredentialInput,
  SetSharedDefaultEnvironmentInput,
  SharedProjectId,
  SyncSharedProjectContextInput,
  SyncSharedRemoteRuntimeInput,
  UpdateSharedProjectMemberRoleInput,
  UpdateSharedThreadVisibilityInput,
  UpsertSharedDeployAssociationInput,
  UpsertSharedEnvironmentInput,
  UpsertSharedRuntimeInput,
  UpsertSharedSshCredentialInput,
  type ImportSharedThreadResult,
  type SharedProjectBootstrapManifest,
  type SharedProjectClaimResult,
  type SharedProjectDetail,
  type SharedProjectEnvironment,
  type SharedProjectInvite,
  type SharedProjectListResult,
  type ResolvedSharedThreadShare,
  type SharedRuntime,
  type SharedThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http";
import type * as HttpServerResponseModule from "effect/unstable/http/HttpServerResponse";

import { browserApiCorsHeaders } from "../httpCors.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  authenticateEnvironmentRequestWithScope,
  respondToUserAuthError,
} from "../userAuth/http.ts";
import { UserAuth, UserAuthError, type AuthenticatedUser } from "../userAuth/Services/UserAuth.ts";
import { importSharedThreadSnapshot } from "./importSharedThreadSnapshot.ts";
import { SharedProjects, SharedProjectsError } from "./Services/SharedProjects.ts";

const respondToSharedProjectsError = (error: SharedProjectsError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("shared projects route failed", {
        message: error.message,
        cause: error.cause,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      { error: error.message },
      { status: error.status ?? 500, headers: browserApiCorsHeaders },
    );
  });

const authenticateSharedProjectUser = (scope: AuthEnvironmentScope) =>
  Effect.gen(function* () {
    const request = yield* authenticateEnvironmentRequestWithScope(scope);
    const userAuth = yield* UserAuth;
    return yield* userAuth.authenticateRequest(request);
  });

const projectIdFromQuery = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  const projectId = Option.isSome(url) ? url.value.searchParams.get("projectId")?.trim() : null;
  if (!projectId) {
    return yield* new SharedProjectsError({
      message: "Missing shared project id.",
      status: 400,
    });
  }
  return SharedProjectId.make(projectId);
});

type SharedProjectsRouteError =
  | EnvironmentAuthInvalidError
  | EnvironmentInternalError
  | EnvironmentScopeRequiredError
  | UserAuthError
  | SharedProjectsError;

const parseBody = <S extends Schema.Codec<unknown, unknown, never, unknown>>(
  schema: S,
): Effect.Effect<Schema.Schema.Type<S>, SharedProjectsError, HttpServerRequest.HttpServerRequest> =>
  HttpServerRequest.schemaBodyJson(schema).pipe(
    Effect.mapError(
      (cause) =>
        new SharedProjectsError({
          message: "Invalid shared project request payload.",
          status: 400,
          cause,
        }),
    ),
  ) as Effect.Effect<
    Schema.Schema.Type<S>,
    SharedProjectsError,
    HttpServerRequest.HttpServerRequest
  >;

type HostedCollabConfig = {
  readonly baseUrl: string;
  readonly token: string;
};

const SHARED_COLLAB_PROFILE_HEADER = "x-kamicode-shared-collaboration-profile-id";

type HostedCollabQuery = Record<string, boolean | number | string | null | undefined>;
type SharedProjectsHttpStatus = 400 | 401 | 403 | 404 | 409 | 500;

const hostedStatus = (status: number): SharedProjectsHttpStatus => {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) {
    return status;
  }
  return 500;
};

const hostedErrorMessage = (payload: unknown, fallback: string): string => {
  if (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    typeof (payload as { readonly error?: unknown }).error === "string"
  ) {
    return (payload as { readonly error: string }).error;
  }
  return fallback;
};

const hostedCollabConfigFromUrlAndToken = (input: {
  readonly url: string;
  readonly token: string;
  readonly invalidUrlMessage: string;
}): Effect.Effect<HostedCollabConfig, SharedProjectsError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(input.url),
      catch: (cause) =>
        new SharedProjectsError({
          message: input.invalidUrlMessage,
          status: 500,
          cause,
        }),
    });
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return yield* new SharedProjectsError({
        message: "Shared collaboration server URL must use http or https.",
        status: 500,
      });
    }
    return {
      baseUrl: parsed.toString().replace(/\/$/u, ""),
      token: input.token,
    } satisfies HostedCollabConfig;
  });

const hostedCollabConfig = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const requestedProfileId = request.headers[SHARED_COLLAB_PROFILE_HEADER]?.trim() ?? "";
  const rawUrl = process.env.T3CODE_COLLAB_SERVER_URL?.trim() ?? "";
  const token = process.env.T3CODE_COLLAB_SERVER_TOKEN?.trim() ?? "";
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new SharedProjectsError({
          message: "Failed to read hosted collaboration server settings.",
          status: 500,
          cause,
        }),
    ),
  );
  if (requestedProfileId.length > 0) {
    const profile =
      settings.sharedCollaborationProfiles.find(
        (candidate) => candidate.id === requestedProfileId,
      ) ?? null;
    if (!profile) {
      return yield* new SharedProjectsError({
        message: "Shared collaboration profile was not found.",
        status: 404,
      });
    }
    const profileUrl = profile.url.trim();
    const profileToken = profile.token.trim();
    if (profileUrl.length === 0 || profileToken.length === 0) {
      return yield* new SharedProjectsError({
        message: "The selected shared collaboration profile is incomplete.",
        status: 500,
      });
    }
    return yield* hostedCollabConfigFromUrlAndToken({
      url: profileUrl,
      token: profileToken,
      invalidUrlMessage: "Shared collaboration profile URL is not valid.",
    });
  }
  if (rawUrl.length > 0 || token.length > 0) {
    if (rawUrl.length === 0 || token.length === 0) {
      return yield* new SharedProjectsError({
        message:
          "Hosted collaboration server is partially configured. Set both T3CODE_COLLAB_SERVER_URL and T3CODE_COLLAB_SERVER_TOKEN.",
        status: 500,
      });
    }
    return yield* hostedCollabConfigFromUrlAndToken({
      url: rawUrl,
      token,
      invalidUrlMessage: "T3CODE_COLLAB_SERVER_URL is not a valid URL.",
    });
  }
  if (settings.sharedCollaborationDefaultTarget.mode === "profile") {
    const defaultProfile =
      settings.sharedCollaborationProfiles.find(
        (candidate) => candidate.id === settings.sharedCollaborationDefaultTarget.profileId,
      ) ?? null;
    if (defaultProfile) {
      const profileUrl = defaultProfile.url.trim();
      const profileToken = defaultProfile.token.trim();
      if (profileUrl.length === 0 || profileToken.length === 0) {
        return yield* new SharedProjectsError({
          message: "The default shared collaboration profile is incomplete.",
          status: 500,
        });
      }
      return yield* hostedCollabConfigFromUrlAndToken({
        url: profileUrl,
        token: profileToken,
        invalidUrlMessage: "Default shared collaboration profile URL is not valid.",
      });
    }
  }
  const settingsUrl = settings.hostedCollaboration.url.trim();
  const settingsToken = settings.hostedCollaboration.token.trim();
  if (settingsUrl.length === 0 && settingsToken.length === 0) {
    return null;
  }
  if (settingsUrl.length === 0 || settingsToken.length === 0) {
    return yield* new SharedProjectsError({
      message:
        "Hosted collaboration server is partially configured. Set both the shared server URL and token.",
      status: 500,
    });
  }
  return yield* hostedCollabConfigFromUrlAndToken({
    url: settingsUrl,
    token: settingsToken,
    invalidUrlMessage: "Shared collaboration server URL is not valid.",
  });
});

const hostedIdentityHeaders = (user: AuthenticatedUser, token: string): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-kamicode-user-id": user.user.userId,
    "x-kamicode-github-id": user.user.githubId,
    "x-kamicode-github-login": user.user.githubLogin,
  };
  if (user.user.displayName !== null) {
    headers["x-kamicode-display-name"] = user.user.displayName;
  }
  if (user.user.avatarUrl !== null) {
    headers["x-kamicode-avatar-url"] = user.user.avatarUrl;
  }
  return headers;
};

const decodeHostedPayloadJson = Schema.decodeEffect(Schema.UnknownFromJsonString);

const hostedSharedProjectRequest = <T>(input: {
  readonly user: AuthenticatedUser;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: HostedCollabQuery;
  readonly body?: unknown;
}): Effect.Effect<
  T | null,
  SharedProjectsError,
  HttpClient.HttpClient | HttpServerRequest.HttpServerRequest | ServerSettingsService
> =>
  Effect.gen(function* () {
    const config = yield* hostedCollabConfig;
    if (config === null) {
      return null;
    }
    const url = new URL(input.path, `${config.baseUrl}/`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.make(input.method)(url, {
      headers: hostedIdentityHeaders(input.user, config.token),
    }).pipe(
      input.body === undefined
        ? (request) => request
        : HttpClientRequest.bodyJsonUnsafe(input.body),
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new SharedProjectsError({
            message: "Hosted collaboration server is not reachable.",
            status: 500,
            cause,
          }),
      ),
    );
    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new SharedProjectsError({
            message: "Could not read hosted collaboration server response.",
            status: 500,
            cause,
          }),
      ),
    );
    const payload =
      text.trim().length === 0
        ? null
        : yield* decodeHostedPayloadJson(text).pipe(
            Effect.mapError(
              (cause) =>
                new SharedProjectsError({
                  message: "Hosted collaboration server returned invalid JSON.",
                  status: 500,
                  cause,
                }),
            ),
          );
    if (response.status < 200 || response.status >= 300) {
      return yield* new SharedProjectsError({
        message: hostedErrorMessage(
          payload,
          `Hosted collaboration server request failed with HTTP ${response.status}.`,
        ),
        status: hostedStatus(response.status),
      });
    }
    return payload as T;
  });

const withSharedProjectErrorHandling = <R>(
  effect: Effect.Effect<HttpServerResponseModule.HttpServerResponse, SharedProjectsRouteError, R>,
): Effect.Effect<HttpServerResponseModule.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
      UserAuthError: respondToUserAuthError,
      SharedProjectsError: respondToSharedProjectsError,
    }),
  );

export const sharedProjectsListRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationReadScope);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectListResult>({
        user,
        method: "GET",
        path: "/api/shared-projects",
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.listForUser(user);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsCurrentUserRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects/current-user",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationReadScope);
      const hosted = yield* hostedSharedProjectRequest<{
        readonly user: AuthenticatedUser["user"];
      }>({
        user,
        method: "GET",
        path: "/api/shared-projects/current-user",
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      return HttpServerResponse.jsonUnsafe(
        { user: user.user },
        { status: 200, headers: browserApiCorsHeaders },
      );
    }),
  ),
);

export const sharedProjectsDetailRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects/detail",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationReadScope);
      const projectId = yield* projectIdFromQuery;
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "GET",
        path: "/api/shared-projects/detail",
        query: { projectId },
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.getDetail(user, projectId);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsBootstrapRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects/bootstrap",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationReadScope);
      const projectId = yield* projectIdFromQuery;
      const hosted = yield* hostedSharedProjectRequest<SharedProjectBootstrapManifest>({
        user,
        method: "GET",
        path: "/api/shared-projects/bootstrap",
        query: { projectId },
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const manifest = yield* sharedProjects.getBootstrapManifest(user, projectId);
      return HttpServerResponse.jsonUnsafe(manifest, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsPublishRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/publish",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(PublishLocalProjectInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/publish",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.publishLocalProject(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsSyncContextRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/context/sync",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(SyncSharedProjectContextInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/context/sync",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.syncContext(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsCreateInviteRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/invites",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(CreateSharedProjectInviteInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectInvite>({
        user,
        method: "POST",
        path: "/api/shared-projects/invites",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const invite = yield* sharedProjects.createInvite(user, input);
      return HttpServerResponse.jsonUnsafe(invite, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsClaimInviteRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/invites/claim",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(ClaimSharedProjectInviteInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectClaimResult>({
        user,
        method: "POST",
        path: "/api/shared-projects/invites/claim",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.claimInvite(user, input);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpdateMemberRoleRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/members/role",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpdateSharedProjectMemberRoleInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/members/role",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.updateMemberRole(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsRemoveMemberRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/members/remove",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(RemoveSharedProjectMemberInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/members/remove",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.removeMember(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsDeleteRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/delete",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(DeleteSharedProjectInput);
      const hosted = yield* hostedSharedProjectRequest<DeleteSharedProjectResult>({
        user,
        method: "POST",
        path: "/api/shared-projects/delete",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.deleteProject(user, input);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsPublishThreadRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/publish",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(PublishSharedThreadInput);
      const hosted = yield* hostedSharedProjectRequest<SharedThread>({
        user,
        method: "POST",
        path: "/api/shared-projects/threads/publish",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.publishThread(user, input);
      return HttpServerResponse.jsonUnsafe(thread, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpdateThreadVisibilityRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/visibility",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpdateSharedThreadVisibilityInput);
      const hosted = yield* hostedSharedProjectRequest<SharedThread>({
        user,
        method: "POST",
        path: "/api/shared-projects/threads/visibility",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.updateThreadVisibility(user, input);
      return HttpServerResponse.jsonUnsafe(thread, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsImportThreadRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/import",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(ImportSharedThreadInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "GET",
        path: "/api/shared-projects/detail",
        query: { projectId: input.projectId },
      });
      if (hosted !== null) {
        const thread = hosted.threads.find((candidate) => candidate.id === input.threadId);
        if (!thread) {
          return yield* new SharedProjectsError({
            message: "Shared thread was not found.",
            status: 404,
          });
        }
        if (!thread.sessionSnapshot) {
          return yield* new SharedProjectsError({
            message: "This shared session does not have an importable snapshot yet.",
            status: 400,
          });
        }
        const result = yield* importSharedThreadSnapshot({
          request: input,
          title: thread.title,
          snapshot: thread.sessionSnapshot,
          sourceSharedThreadId: input.threadId,
        });
        return HttpServerResponse.jsonUnsafe(result satisfies ImportSharedThreadResult, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.importThread(user, input);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsResolveThreadShareRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/resolve",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationReadScope);
      const input = yield* parseBody(ResolveSharedThreadShareInput);
      const hosted = yield* hostedSharedProjectRequest<ResolvedSharedThreadShare>({
        user,
        method: "POST",
        path: "/api/shared-projects/threads/resolve",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.resolveSharedThreadShare(user, input.shareCode);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsImportThreadLinkRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/import-link",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(ImportSharedThreadLinkInput);
      const hosted = yield* hostedSharedProjectRequest<ResolvedSharedThreadShare>({
        user,
        method: "POST",
        path: "/api/shared-projects/threads/resolve",
        body: { shareCode: input.shareCode },
      });
      if (hosted !== null) {
        if (!hosted.thread.sessionSnapshot) {
          return yield* new SharedProjectsError({
            message: "This shared session does not have an importable snapshot yet.",
            status: 400,
          });
        }
        const result = yield* importSharedThreadSnapshot({
          request: {
            projectId: hosted.projectId,
            threadId: hosted.thread.id,
            targetProjectId: input.targetProjectId,
          },
          title: hosted.thread.title,
          snapshot: hosted.thread.sessionSnapshot,
          sourceSharedThreadId: hosted.thread.id,
          targetProjectCwd: input.targetProjectCwd,
        });
        return HttpServerResponse.jsonUnsafe(result satisfies ImportSharedThreadResult, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.importThreadFromLink(user, input);
      return HttpServerResponse.jsonUnsafe(result, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsAppendThreadMessageRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/messages",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(AppendSharedThreadMessageInput);
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.appendThreadMessage(user, input);
      return HttpServerResponse.jsonUnsafe(thread, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpsertRuntimeRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/runtimes",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpsertSharedRuntimeInput);
      const hosted = yield* hostedSharedProjectRequest<SharedRuntime>({
        user,
        method: "POST",
        path: "/api/shared-projects/runtimes",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const runtime = yield* sharedProjects.upsertRuntime(user, input);
      return HttpServerResponse.jsonUnsafe(runtime, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpsertSshCredentialRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/ssh-credentials",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpsertSharedSshCredentialInput);
      const sharedProjects = yield* SharedProjects;
      const credential = yield* sharedProjects.upsertSshCredential(user, input);
      return HttpServerResponse.jsonUnsafe(credential, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsRemoveSshCredentialRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/ssh-credentials/remove",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(RemoveSharedSshCredentialInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.removeSshCredential(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpsertEnvironmentRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/environments",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpsertSharedEnvironmentInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectEnvironment>({
        user,
        method: "POST",
        path: "/api/shared-projects/environments",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const environment = yield* sharedProjects.upsertEnvironment(user, input);
      return HttpServerResponse.jsonUnsafe(environment, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsSetDefaultEnvironmentRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/environments/default",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(SetSharedDefaultEnvironmentInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/environments/default",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.setDefaultEnvironment(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsUpsertDeployRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/deploys",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(UpsertSharedDeployAssociationInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/deploys",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.upsertDeployAssociation(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);

export const sharedProjectsSyncRemoteRuntimeRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/sync-remote-runtime",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser(AuthOrchestrationOperateScope);
      const input = yield* parseBody(SyncSharedRemoteRuntimeInput);
      const hosted = yield* hostedSharedProjectRequest<SharedProjectDetail>({
        user,
        method: "POST",
        path: "/api/shared-projects/sync-remote-runtime",
        body: input,
      });
      if (hosted !== null) {
        return HttpServerResponse.jsonUnsafe(hosted, {
          status: 200,
          headers: browserApiCorsHeaders,
        });
      }
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.syncRemoteRuntime(user, input);
      return HttpServerResponse.jsonUnsafe(detail, {
        status: 200,
        headers: browserApiCorsHeaders,
      });
    }),
  ),
);
