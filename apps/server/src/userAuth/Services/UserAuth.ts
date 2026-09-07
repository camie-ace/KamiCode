import type {
  AuthSessionId,
  KamiUser,
  UserAuthSessionId,
  UserAuthSessionState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

export const DESKTOP_GITHUB_STATE_PREFIX = "desktop:";

export function isDesktopGitHubLoginState(state: string): boolean {
  return state.startsWith(DESKTOP_GITHUB_STATE_PREFIX);
}

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
  /** Web access-code sessions must carry a linked GitHub profile when true. */
  readonly profileRequiredForBrowserSessions: boolean;
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest,
    environmentSessionId?: AuthSessionId,
  ) => Effect.Effect<UserAuthSessionState, UserAuthError>;
  readonly authenticateRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedUser, UserAuthError>;
  readonly authenticateEnvironmentSession: (input: {
    readonly request: HttpServerRequest.HttpServerRequest;
    readonly environmentSessionId: AuthSessionId;
  }) => Effect.Effect<AuthenticatedUser, UserAuthError>;
  readonly getEnvironmentSessionUser: (
    environmentSessionId: AuthSessionId,
  ) => Effect.Effect<AuthenticatedUser | null, UserAuthError>;
  readonly bindEnvironmentSession: (input: {
    readonly environmentSessionId: AuthSessionId;
    readonly authenticatedUser: AuthenticatedUser;
  }) => Effect.Effect<void, UserAuthError>;
  readonly createGitHubLogin: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<
    {
      readonly authorizationUrl: string;
      readonly state: string;
      readonly expiresAt: DateTime.DateTime;
    },
    UserAuthError
  >;
  readonly createDesktopGitHubLogin: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<
    {
      readonly authorizationUrl: string;
      readonly handoffId: string;
      readonly userCode?: string;
      readonly pollIntervalMs?: number;
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
      readonly authenticatedUser: AuthenticatedUser;
    },
    UserAuthError
  >;
  readonly completeDesktopGitHubLogin: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<void, UserAuthError>;
  readonly failDesktopGitHubLogin: (input: {
    readonly state: string;
    readonly message: string;
  }) => Effect.Effect<void>;
  readonly consumeDesktopGitHubLogin: (input: { readonly handoffId: string }) => Effect.Effect<
    | { readonly status: "pending"; readonly pollIntervalMs?: number }
    | { readonly status: "error"; readonly message: string }
    | {
        readonly status: "authenticated";
        readonly sessionState: UserAuthSessionState;
        readonly sessionToken: string;
        readonly sessionExpiresAt: DateTime.DateTime;
        readonly authenticatedUser: AuthenticatedUser;
      },
    UserAuthError
  >;
  readonly logout: (
    request: HttpServerRequest.HttpServerRequest,
    environmentSessionId?: AuthSessionId,
  ) => Effect.Effect<void, UserAuthError>;
}

export class UserAuth extends Context.Service<UserAuth, UserAuthShape>()(
  "t3/userAuth/Services/UserAuth",
) {}
