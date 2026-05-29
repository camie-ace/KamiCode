import * as Crypto from "node:crypto";

import {
  KamiUserId,
  UserAuthSessionId,
  type KamiUser,
  type UserAuthSessionState,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { ServerConfig } from "../../config.ts";
import { UserAuthRepositoryLive } from "../../persistence/Layers/UserAuth.ts";
import { UserAuthRepository } from "../../persistence/Services/UserAuth.ts";
import type { UserAuthUserRecord } from "../../persistence/Services/UserAuth.ts";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../../auth/utils.ts";
import { GitHubOAuthClient, GitHubOAuthError } from "../Services/GitHubOAuthClient.ts";
import {
  type AuthenticatedUser,
  DESKTOP_GITHUB_STATE_PREFIX,
  isDesktopGitHubLoginState,
  UserAuth,
  UserAuthError,
  type UserAuthShape,
} from "../Services/UserAuth.ts";

const SIGNING_SECRET_NAME = "user-auth-signing-key";
const DEFAULT_SESSION_TTL = Duration.days(30);
const DEFAULT_STATE_TTL = Duration.minutes(10);
const USER_SESSION_COOKIE_NAME = "t3_user_session";
const STATE_COOKIE_PATH = "/api/user/auth/github";

const UserSessionClaims = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal("user-session"),
  sid: UserAuthSessionId,
  uid: KamiUserId,
  iat: Schema.Number,
  exp: Schema.Number,
});
type UserSessionClaims = typeof UserSessionClaims.Type;

type DesktopGitHubLoginHandoff =
  | {
      readonly status: "pending";
      readonly state: string;
      readonly redirectUri: string;
      readonly expiresAt: DateTime.DateTime;
    }
  | {
      readonly status: "error";
      readonly state: string;
      readonly message: string;
      readonly expiresAt: DateTime.DateTime;
    }
  | {
      readonly status: "authenticated";
      readonly state: string;
      readonly sessionState: UserAuthSessionState;
      readonly sessionToken: string;
      readonly sessionExpiresAt: DateTime.DateTime;
      readonly expiresAt: DateTime.DateTime;
    };

const decodeUserSessionClaims = Schema.decodeUnknownEffect(
  Schema.fromJsonString(UserSessionClaims),
);
const encodeUserSessionClaims = Schema.encodeEffect(Schema.fromJsonString(UserSessionClaims));

function resolveUserSessionCookieName(input: {
  readonly mode: "web" | "desktop";
  readonly port: number;
}): string {
  if (input.mode !== "desktop") {
    return USER_SESSION_COOKIE_NAME;
  }

  return `${USER_SESSION_COOKIE_NAME}_${input.port}`;
}

function normalizeRequiredConfig(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toKamiUser(record: UserAuthUserRecord): KamiUser {
  return {
    userId: record.userId,
    githubId: record.githubId,
    githubLogin: record.githubLogin,
    displayName: normalizeOptionalString(record.displayName),
    avatarUrl: normalizeOptionalString(record.avatarUrl),
  };
}

function makeUnauthenticatedState(): UserAuthSessionState {
  return {
    enabled: true,
    authenticated: false,
    provider: "github",
  };
}

function makeDisabledState(): UserAuthSessionState {
  return {
    enabled: false,
    authenticated: false,
    provider: null,
  };
}

function randomBase64Url(bytes: number): string {
  return Crypto.randomBytes(bytes).toString("base64url");
}

function parseDesktopGitHubLoginHandoffId(state: string): string | null {
  if (!isDesktopGitHubLoginState(state)) {
    return null;
  }

  const [prefix, handoffId, secret] = state.split(":");
  if (`${prefix}:` !== DESKTOP_GITHUB_STATE_PREFIX || !handoffId || !secret) {
    return null;
  }

  return handoffId;
}

function resolveRequestUrl(request: HttpServerRequest.HttpServerRequest): Option.Option<URL> {
  return HttpServerRequest.toURL(request);
}

export const makeUserAuth = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const secretStore = yield* ServerSecretStore;
  const userAuthRepository = yield* UserAuthRepository;
  const githubOAuthClient = yield* GitHubOAuthClient;
  const desktopGitHubLoginHandoffs = yield* Ref.make(new Map<string, DesktopGitHubLoginHandoff>());
  const signingSecret = yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32).pipe(
    Effect.mapError(
      (cause) =>
        new UserAuthError({
          message: "Failed to load user auth signing secret.",
          cause,
        }),
    ),
  );

  const cookieName = resolveUserSessionCookieName({
    mode: config.mode,
    port: config.port,
  });
  const stateCookieName = `${cookieName}_github_state`;
  const githubClientId = normalizeRequiredConfig(config.githubOAuthClientId);
  const githubClientSecret = normalizeRequiredConfig(config.githubOAuthClientSecret);
  const enabled = githubClientId !== null && githubClientSecret !== null;

  const toUserAuthError = (message: string, status?: UserAuthError["status"]) => (cause: unknown) =>
    new UserAuthError({
      message,
      ...(status ? { status } : {}),
      cause,
    });

  const ensureConfigured = () =>
    enabled && githubClientId && githubClientSecret
      ? Effect.succeed({
          clientId: githubClientId,
          clientSecret: githubClientSecret,
        })
      : Effect.fail(
          new UserAuthError({
            message:
              "GitHub OAuth login is not configured. Set T3CODE_GITHUB_OAUTH_CLIENT_ID and T3CODE_GITHUB_OAUTH_CLIENT_SECRET.",
            status: 503,
          }),
        );

  const resolveCallbackUrl = (request: HttpServerRequest.HttpServerRequest) => {
    if (config.githubOAuthCallbackUrl) {
      return Effect.succeed(config.githubOAuthCallbackUrl.toString());
    }

    const requestUrl = resolveRequestUrl(request);
    if (Option.isNone(requestUrl)) {
      return Effect.fail(
        new UserAuthError({
          message: "Unable to resolve GitHub OAuth callback URL from request.",
          status: 400,
        }),
      );
    }

    const callbackUrl = new URL("/api/user/auth/github/callback", requestUrl.value.origin);
    return Effect.succeed(callbackUrl.toString());
  };

  const issueSession = (user: UserAuthUserRecord) =>
    Effect.gen(function* () {
      const issuedAt = yield* DateTime.now;
      const expiresAt = DateTime.add(issuedAt, {
        milliseconds: Duration.toMillis(DEFAULT_SESSION_TTL),
      });
      const sessionId = UserAuthSessionId.make(Crypto.randomUUID());
      const claims: UserSessionClaims = {
        v: 1,
        kind: "user-session",
        sid: sessionId,
        uid: user.userId,
        iat: issuedAt.epochMilliseconds,
        exp: expiresAt.epochMilliseconds,
      };
      const encodedPayload = yield* encodeUserSessionClaims(claims).pipe(
        Effect.map(base64UrlEncode),
        Effect.mapError(toUserAuthError("Failed to encode user auth session.", 500)),
      );
      const signature = signPayload(encodedPayload, signingSecret);

      yield* userAuthRepository
        .createSession({
          sessionId,
          userId: user.userId,
          issuedAt,
          expiresAt,
        })
        .pipe(Effect.mapError(toUserAuthError("Failed to create user auth session.", 500)));

      return {
        sessionId,
        token: `${encodedPayload}.${signature}`,
        expiresAt,
      };
    });

  const verifyToken = (token: string): Effect.Effect<AuthenticatedUser, UserAuthError> =>
    Effect.gen(function* () {
      const [encodedPayload, signature] = token.split(".");
      if (!encodedPayload || !signature) {
        return yield* new UserAuthError({
          message: "Malformed user auth session token.",
          status: 401,
        });
      }

      const expectedSignature = signPayload(encodedPayload, signingSecret);
      if (!timingSafeEqualBase64Url(signature, expectedSignature)) {
        return yield* new UserAuthError({
          message: "Invalid user auth session signature.",
          status: 401,
        });
      }

      const claims = yield* decodeUserSessionClaims(base64UrlDecodeUtf8(encodedPayload)).pipe(
        Effect.mapError(toUserAuthError("Invalid user auth session payload.", 401)),
      );

      const now = yield* Clock.currentTimeMillis;
      if (claims.exp <= now) {
        return yield* new UserAuthError({
          message: "User auth session expired.",
          status: 401,
        });
      }

      const row = yield* userAuthRepository
        .getSessionById({ sessionId: claims.sid })
        .pipe(Effect.mapError(toUserAuthError("Failed to load user auth session.", 500)));
      if (Option.isNone(row)) {
        return yield* new UserAuthError({
          message: "Unknown user auth session.",
          status: 401,
        });
      }
      if (row.value.revokedAt !== null) {
        return yield* new UserAuthError({
          message: "User auth session revoked.",
          status: 401,
        });
      }
      if (row.value.userId !== claims.uid) {
        return yield* new UserAuthError({
          message: "User auth session user mismatch.",
          status: 401,
        });
      }
      if (row.value.expiresAt.epochMilliseconds <= now) {
        return yield* new UserAuthError({
          message: "User auth session expired.",
          status: 401,
        });
      }

      return {
        sessionId: row.value.sessionId,
        user: toKamiUser(row.value.user),
        expiresAt: row.value.expiresAt,
      } satisfies AuthenticatedUser;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof UserAuthError
          ? cause
          : new UserAuthError({
              message: "Failed to verify user auth session.",
              status: 401,
              cause,
            }),
      ),
    );

  const getSessionState: UserAuthShape["getSessionState"] = (request) => {
    if (!enabled) {
      return Effect.succeed(makeDisabledState());
    }

    const token = request.cookies[cookieName];
    if (!token) {
      return Effect.succeed(makeUnauthenticatedState());
    }

    return verifyToken(token).pipe(
      Effect.map(
        (authenticated) =>
          ({
            enabled: true,
            authenticated: true,
            provider: "github",
            user: authenticated.user,
            expiresAt: DateTime.toUtc(authenticated.expiresAt),
          }) satisfies UserAuthSessionState,
      ),
      Effect.catchTag("UserAuthError", () => Effect.succeed(makeUnauthenticatedState())),
    );
  };

  const authenticateRequest: UserAuthShape["authenticateRequest"] = (request) =>
    Effect.gen(function* () {
      yield* ensureConfigured();
      const token = request.cookies[cookieName];
      if (!token) {
        return yield* new UserAuthError({
          message: "GitHub login required.",
          status: 401,
        });
      }
      return yield* verifyToken(token);
    });

  const createGitHubLogin: UserAuthShape["createGitHubLogin"] = (request) =>
    Effect.gen(function* () {
      const credentials = yield* ensureConfigured();
      const state = randomBase64Url(32);
      const issuedAt = yield* DateTime.now;
      const expiresAt = DateTime.add(issuedAt, {
        milliseconds: Duration.toMillis(DEFAULT_STATE_TTL),
      });
      const redirectUri = yield* resolveCallbackUrl(request);
      const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
      authorizationUrl.searchParams.set("client_id", credentials.clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("scope", "read:user");

      return {
        authorizationUrl: authorizationUrl.toString(),
        state,
        expiresAt,
      };
    });

  const createDesktopGitHubLogin: UserAuthShape["createDesktopGitHubLogin"] = (request) =>
    Effect.gen(function* () {
      const credentials = yield* ensureConfigured();
      const handoffId = randomBase64Url(18);
      const state = `${DESKTOP_GITHUB_STATE_PREFIX}${handoffId}:${randomBase64Url(32)}`;
      const issuedAt = yield* DateTime.now;
      const expiresAt = DateTime.add(issuedAt, {
        milliseconds: Duration.toMillis(DEFAULT_STATE_TTL),
      });
      const redirectUri = yield* resolveCallbackUrl(request);
      const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
      authorizationUrl.searchParams.set("client_id", credentials.clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("scope", "read:user");

      yield* Ref.update(desktopGitHubLoginHandoffs, (handoffs) => {
        const next = new Map(handoffs);
        next.set(handoffId, {
          status: "pending",
          state,
          redirectUri,
          expiresAt,
        });
        return next;
      });

      return {
        authorizationUrl: authorizationUrl.toString(),
        handoffId,
        expiresAt,
      };
    });

  const completeGitHubOAuthCode = (input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly redirectUri: string;
  }) =>
    Effect.gen(function* () {
      const token = yield* githubOAuthClient
        .exchangeCode({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          code: input.code,
          redirectUri: input.redirectUri,
        })
        .pipe(
          Effect.mapError(
            (cause: GitHubOAuthError) =>
              new UserAuthError({
                message: cause.message,
                status: cause.status === 400 ? 400 : 500,
                cause,
              }),
          ),
        );
      const githubUser = yield* githubOAuthClient
        .fetchUser({ accessToken: token.accessToken })
        .pipe(
          Effect.mapError(
            (cause: GitHubOAuthError) =>
              new UserAuthError({
                message: cause.message,
                status: cause.status === 400 ? 400 : 500,
                cause,
              }),
          ),
        );

      const now = yield* DateTime.now;
      const user = yield* userAuthRepository
        .upsertGitHubUser({
          userId: KamiUserId.make(Crypto.randomUUID()),
          githubId: githubUser.githubId,
          githubLogin: githubUser.login,
          displayName: normalizeOptionalString(githubUser.displayName),
          avatarUrl: normalizeOptionalString(githubUser.avatarUrl),
          now,
        })
        .pipe(Effect.mapError(toUserAuthError("Failed to save GitHub user.", 500)));
      const session = yield* issueSession(user);

      return {
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
        sessionState: {
          enabled: true,
          authenticated: true,
          provider: "github",
          user: toKamiUser(user),
          expiresAt: DateTime.toUtc(session.expiresAt),
        } satisfies UserAuthSessionState,
      };
    });

  const completeGitHubLogin: UserAuthShape["completeGitHubLogin"] = (input) =>
    Effect.gen(function* () {
      const credentials = yield* ensureConfigured();
      const storedState = input.request.cookies[stateCookieName];
      if (!storedState || storedState !== input.state) {
        return yield* new UserAuthError({
          message: "Invalid GitHub OAuth state.",
          status: 400,
        });
      }

      const redirectUri = yield* resolveCallbackUrl(input.request);
      return yield* completeGitHubOAuthCode({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        code: input.code,
        redirectUri,
      });
    });

  const completeDesktopGitHubLogin: UserAuthShape["completeDesktopGitHubLogin"] = (input) =>
    Effect.gen(function* () {
      const credentials = yield* ensureConfigured();
      const handoffId = parseDesktopGitHubLoginHandoffId(input.state);
      if (!handoffId) {
        return yield* new UserAuthError({
          message: "Invalid GitHub OAuth state.",
          status: 400,
        });
      }

      const now = yield* DateTime.now;
      const handoffs = yield* Ref.get(desktopGitHubLoginHandoffs);
      const handoff = handoffs.get(handoffId);
      if (
        !handoff ||
        handoff.status !== "pending" ||
        handoff.state !== input.state ||
        DateTime.isGreaterThanOrEqualTo(now, handoff.expiresAt)
      ) {
        return yield* new UserAuthError({
          message: "Invalid GitHub OAuth state.",
          status: 400,
        });
      }

      const completed = yield* completeGitHubOAuthCode({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        code: input.code,
        redirectUri: handoff.redirectUri,
      });

      yield* Ref.update(desktopGitHubLoginHandoffs, (current) => {
        const next = new Map(current);
        next.set(handoffId, {
          status: "authenticated",
          state: input.state,
          expiresAt: handoff.expiresAt,
          ...completed,
        });
        return next;
      });
    });

  const failDesktopGitHubLogin: UserAuthShape["failDesktopGitHubLogin"] = (input) =>
    Effect.gen(function* () {
      const handoffId = parseDesktopGitHubLoginHandoffId(input.state);
      if (!handoffId) {
        return;
      }

      yield* Ref.update(desktopGitHubLoginHandoffs, (current) => {
        const handoff = current.get(handoffId);
        if (!handoff || handoff.state !== input.state) {
          return current;
        }

        const next = new Map(current);
        next.set(handoffId, {
          status: "error",
          state: input.state,
          message: input.message,
          expiresAt: handoff.expiresAt,
        });
        return next;
      });
    });

  const consumeDesktopGitHubLogin: UserAuthShape["consumeDesktopGitHubLogin"] = (input) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const handoff = yield* Ref.modify(desktopGitHubLoginHandoffs, (current) => {
        const next = new Map(current);
        const value = next.get(input.handoffId);
        if (!value) {
          return [null, next] as const;
        }
        if (DateTime.isGreaterThanOrEqualTo(now, value.expiresAt)) {
          next.delete(input.handoffId);
          return [null, next] as const;
        }
        if (value.status === "authenticated" || value.status === "error") {
          next.delete(input.handoffId);
        }
        return [value, next] as const;
      });

      if (!handoff) {
        return yield* new UserAuthError({
          message: "GitHub login handoff expired.",
          status: 400,
        });
      }

      if (handoff.status === "pending") {
        return { status: "pending" } as const;
      }

      if (handoff.status === "error") {
        return {
          status: "error",
          message: handoff.message,
        } as const;
      }

      return {
        status: "authenticated",
        sessionState: handoff.sessionState,
        sessionToken: handoff.sessionToken,
        sessionExpiresAt: handoff.sessionExpiresAt,
      } as const;
    });

  const logout: UserAuthShape["logout"] = (request) =>
    Effect.gen(function* () {
      const token = request.cookies[cookieName];
      if (!token) {
        return;
      }
      const authenticated = yield* verifyToken(token).pipe(
        Effect.catchTag("UserAuthError", () => Effect.succeed(null)),
      );
      if (!authenticated) {
        return;
      }
      const revokedAt = yield* DateTime.now;
      yield* userAuthRepository
        .revokeSession({
          sessionId: authenticated.sessionId,
          revokedAt,
        })
        .pipe(Effect.mapError(toUserAuthError("Failed to revoke user auth session.", 500)));
    });

  return {
    cookieName,
    stateCookieName,
    stateCookiePath: STATE_COOKIE_PATH,
    getSessionState,
    authenticateRequest,
    createGitHubLogin,
    createDesktopGitHubLogin,
    completeGitHubLogin,
    completeDesktopGitHubLogin,
    failDesktopGitHubLogin,
    consumeDesktopGitHubLogin,
    logout,
  } satisfies UserAuthShape;
});

export const UserAuthLive = Layer.effect(UserAuth, makeUserAuth).pipe(
  Layer.provideMerge(UserAuthRepositoryLive),
);
