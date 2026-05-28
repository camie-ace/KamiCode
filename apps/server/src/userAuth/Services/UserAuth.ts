import type { KamiUser, UserAuthSessionId, UserAuthSessionState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

export interface AuthenticatedUser {
  readonly sessionId: UserAuthSessionId;
  readonly user: KamiUser;
  readonly expiresAt: DateTime.DateTime;
}

export class UserAuthError extends Data.TaggedError("UserAuthError")<{
  readonly message: string;
  readonly status?: 400 | 401 | 500 | 503;
  readonly cause?: unknown;
}> {}

export interface UserAuthShape {
  readonly cookieName: string;
  readonly stateCookieName: string;
  readonly stateCookiePath: string;
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<UserAuthSessionState, never>;
  readonly authenticateRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedUser, UserAuthError>;
  readonly createGitHubLogin: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<
    {
      readonly authorizationUrl: string;
      readonly state: string;
      readonly expiresAt: DateTime.DateTime;
    },
    UserAuthError
  >;
  readonly completeGitHubLogin: (input: {
    readonly request: HttpServerRequest.HttpServerRequest;
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<
    {
      readonly sessionState: UserAuthSessionState;
      readonly sessionToken: string;
      readonly sessionExpiresAt: DateTime.DateTime;
    },
    UserAuthError
  >;
  readonly logout: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<void, UserAuthError>;
}

export class UserAuth extends Context.Service<UserAuth, UserAuthShape>()(
  "t3/userAuth/Services/UserAuth",
) {}
