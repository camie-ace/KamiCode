import {
  AppendSharedThreadMessageInput,
  ClaimSharedProjectInviteInput,
  CreateSharedProjectInviteInput,
  PublishLocalProjectInput,
  PublishSharedThreadInput,
  RemoveSharedProjectMemberInput,
  SetSharedDefaultEnvironmentInput,
  SharedProjectId,
  SyncSharedProjectContextInput,
  SyncSharedRemoteRuntimeInput,
  UpdateSharedProjectMemberRoleInput,
  UpdateSharedThreadVisibilityInput,
  UpsertSharedDeployAssociationInput,
  UpsertSharedEnvironmentInput,
  UpsertSharedRuntimeInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type * as HttpServerResponseModule from "effect/unstable/http/HttpServerResponse";

import { respondToAuthError } from "../auth/http.ts";
import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { respondToUserAuthError } from "../userAuth/http.ts";
import { UserAuth, UserAuthError } from "../userAuth/Services/UserAuth.ts";
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

const authenticateSharedProjectUser = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
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

type SharedProjectsRouteError = AuthError | UserAuthError | SharedProjectsError;

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

const withSharedProjectErrorHandling = <R>(
  effect: Effect.Effect<HttpServerResponseModule.HttpServerResponse, SharedProjectsRouteError, R>,
): Effect.Effect<HttpServerResponseModule.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
    Effect.catchTag("SharedProjectsError", (error) => respondToSharedProjectsError(error)),
  );

export const sharedProjectsListRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
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
      const user = yield* authenticateSharedProjectUser;
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
      const user = yield* authenticateSharedProjectUser;
      const projectId = yield* projectIdFromQuery;
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.getDetail(user, projectId);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsBootstrapRouteLayer = HttpRouter.add(
  "GET",
  "/api/shared-projects/bootstrap",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const projectId = yield* projectIdFromQuery;
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
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(PublishLocalProjectInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.publishLocalProject(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsSyncContextRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/context/sync",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(SyncSharedProjectContextInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.syncContext(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsCreateInviteRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/invites",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(CreateSharedProjectInviteInput);
      const sharedProjects = yield* SharedProjects;
      const invite = yield* sharedProjects.createInvite(user, input);
      return HttpServerResponse.jsonUnsafe(invite, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsClaimInviteRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/invites/claim",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(ClaimSharedProjectInviteInput);
      const sharedProjects = yield* SharedProjects;
      const result = yield* sharedProjects.claimInvite(user, input);
      return HttpServerResponse.jsonUnsafe(result, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsUpdateMemberRoleRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/members/role",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(UpdateSharedProjectMemberRoleInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.updateMemberRole(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsRemoveMemberRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/members/remove",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(RemoveSharedProjectMemberInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.removeMember(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsPublishThreadRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/publish",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(PublishSharedThreadInput);
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.publishThread(user, input);
      return HttpServerResponse.jsonUnsafe(thread, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsUpdateThreadVisibilityRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/visibility",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(UpdateSharedThreadVisibilityInput);
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.updateThreadVisibility(user, input);
      return HttpServerResponse.jsonUnsafe(thread, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsAppendThreadMessageRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/threads/messages",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(AppendSharedThreadMessageInput);
      const sharedProjects = yield* SharedProjects;
      const thread = yield* sharedProjects.appendThreadMessage(user, input);
      return HttpServerResponse.jsonUnsafe(thread, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsUpsertRuntimeRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/runtimes",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(UpsertSharedRuntimeInput);
      const sharedProjects = yield* SharedProjects;
      const runtime = yield* sharedProjects.upsertRuntime(user, input);
      return HttpServerResponse.jsonUnsafe(runtime, {
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
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(UpsertSharedEnvironmentInput);
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
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(SetSharedDefaultEnvironmentInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.setDefaultEnvironment(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsUpsertDeployRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/deploys",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(UpsertSharedDeployAssociationInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.upsertDeployAssociation(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);

export const sharedProjectsSyncRemoteRuntimeRouteLayer = HttpRouter.add(
  "POST",
  "/api/shared-projects/sync-remote-runtime",
  withSharedProjectErrorHandling(
    Effect.gen(function* () {
      const user = yield* authenticateSharedProjectUser;
      const input = yield* parseBody(SyncSharedRemoteRuntimeInput);
      const sharedProjects = yield* SharedProjects;
      const detail = yield* sharedProjects.syncRemoteRuntime(user, input);
      return HttpServerResponse.jsonUnsafe(detail, { status: 200, headers: browserApiCorsHeaders });
    }),
  ),
);
