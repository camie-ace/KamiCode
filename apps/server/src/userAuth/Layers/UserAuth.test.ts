import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import type { ServerConfigShape } from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { GitHubOAuthClient } from "../Services/GitHubOAuthClient.ts";
import type { GitHubOAuthClientShape } from "../Services/GitHubOAuthClient.ts";
import { UserAuth } from "../Services/UserAuth.ts";
import { UserAuthLive } from "./UserAuth.ts";

const makeServerConfigLayer = (overrides?: Partial<ServerConfigShape>) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfigShape;
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-user-auth-test-" })));

const makeRequest = (
  cookies: Record<string, string> = {},
  input?: {
    readonly url?: string;
    readonly host?: string;
    readonly protocol?: "http" | "https";
  },
) =>
  ({
    cookies,
    headers: {
      ...(input?.host ? { host: input.host } : {}),
      ...(input?.protocol === "https" ? { "x-forwarded-proto": "https" } : {}),
    },
    url: input?.url ?? "/",
  }) as unknown as HttpServerRequest.HttpServerRequest;

const makeGitHubOAuthClientLayer = (overrides?: Partial<GitHubOAuthClientShape>) =>
  Layer.succeed(GitHubOAuthClient, {
    createDeviceCode: () =>
      Effect.succeed({
        deviceCode: "github-device-code",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresInSeconds: 900,
        intervalSeconds: 5,
      }),
    pollDeviceAuthorization: () =>
      Effect.succeed({
        status: "authenticated",
        token: {
          accessToken: "github-device-access-token",
          tokenType: "bearer",
          scope: "read:user",
        },
      }),
    exchangeCode: () =>
      Effect.succeed({
        accessToken: "github-access-token",
        tokenType: "bearer",
        scope: "read:user",
      }),
    fetchUser: () =>
      Effect.succeed({
        githubId: "123",
        login: "julius",
        displayName: "Julius",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
      }),
    ...overrides,
  } satisfies GitHubOAuthClientShape);

const makeUserAuthLayer = (
  overrides?: Partial<ServerConfigShape>,
  githubOAuthClient?: Partial<GitHubOAuthClientShape>,
) =>
  UserAuthLive.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeGitHubOAuthClientLayer(githubOAuthClient)),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

it.layer(NodeServices.layer)("UserAuthLive", (it) => {
  it.effect("reports disabled state when GitHub OAuth credentials are absent", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;

      const state = yield* userAuth.getSessionState(makeRequest());

      expect(state).toEqual({
        enabled: false,
        authenticated: false,
        provider: null,
      });
    }).pipe(Effect.provide(makeUserAuthLayer())),
  );

  it.effect("builds a GitHub authorization URL with a state cookie value", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;

      const login = yield* userAuth.createGitHubLogin(makeRequest());
      const url = new URL(login.authorizationUrl);

      expect(url.origin).toBe("https://github.com");
      expect(url.pathname).toBe("/login/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://kamicode.example.com/api/user/auth/github/callback",
      );
      expect(url.searchParams.get("scope")).toBe("read:user");
      expect(url.searchParams.get("state")).toBe(login.state);
      expect(login.state.length).toBeGreaterThan(20);
    }).pipe(
      Effect.provide(
        makeUserAuthLayer({
          githubOAuthClientId: "client-id",
          githubOAuthClientSecret: "client-secret",
          githubOAuthCallbackUrl: new URL(
            "https://kamicode.example.com/api/user/auth/github/callback",
          ),
        }),
      ),
    ),
  );

  it.effect("starts desktop GitHub login with device flow using only the client id", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;

      const login = yield* userAuth.createDesktopGitHubLogin(
        makeRequest({}, { host: "127.0.0.1:3773", url: "/api/user/auth/github/desktop/start" }),
      );

      expect(login.authorizationUrl).toBe("https://github.com/login/device");
      expect(login.userCode).toBe("ABCD-1234");
      expect(login.pollIntervalMs).toBe(5_000);
    }).pipe(
      Effect.provide(
        makeUserAuthLayer({
          mode: "desktop",
          githubOAuthClientId: "client-id",
        }),
      ),
    ),
  );

  it.effect("completes desktop GitHub device login and authenticates the user session cookie", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;
      const login = yield* userAuth.createDesktopGitHubLogin(makeRequest());

      const result = yield* userAuth.consumeDesktopGitHubLogin({ handoffId: login.handoffId });
      expect(result.status).toBe("authenticated");
      if (result.status !== "authenticated") {
        return;
      }

      const sessionState = yield* userAuth.getSessionState(
        makeRequest({
          [userAuth.cookieName]: result.sessionToken,
        }),
      );

      expect(sessionState).toMatchObject({
        enabled: true,
        authenticated: true,
        provider: "github",
        user: {
          githubId: "123",
          githubLogin: "julius",
        },
      });
    }).pipe(
      Effect.provide(
        makeUserAuthLayer({
          mode: "desktop",
          githubOAuthClientId: "client-id",
        }),
      ),
    ),
  );

  it.effect("completes GitHub login and authenticates the user session cookie", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;
      const state = "oauth-state";

      const completed = yield* userAuth.completeGitHubLogin({
        request: makeRequest({
          [userAuth.stateCookieName]: state,
        }),
        code: "oauth-code",
        state,
      });
      const sessionState = yield* userAuth.getSessionState(
        makeRequest({
          [userAuth.cookieName]: completed.sessionToken,
        }),
      );

      expect(completed.sessionState).toMatchObject({
        enabled: true,
        authenticated: true,
        provider: "github",
        user: {
          githubId: "123",
          githubLogin: "julius",
          displayName: "Julius",
        },
      });
      expect(sessionState).toMatchObject({
        enabled: true,
        authenticated: true,
        provider: "github",
        user: {
          githubId: "123",
          githubLogin: "julius",
        },
      });
    }).pipe(
      Effect.provide(
        makeUserAuthLayer({
          githubOAuthClientId: "client-id",
          githubOAuthClientSecret: "client-secret",
          githubOAuthCallbackUrl: new URL(
            "https://kamicode.example.com/api/user/auth/github/callback",
          ),
        }),
      ),
    ),
  );

  it.effect("revokes the current user session on logout", () =>
    Effect.gen(function* () {
      const userAuth = yield* UserAuth;
      const state = "oauth-state";
      const completed = yield* userAuth.completeGitHubLogin({
        request: makeRequest({
          [userAuth.stateCookieName]: state,
        }),
        code: "oauth-code",
        state,
      });
      const authenticatedRequest = makeRequest({
        [userAuth.cookieName]: completed.sessionToken,
      });

      yield* userAuth.logout(authenticatedRequest);
      const sessionState = yield* userAuth.getSessionState(authenticatedRequest);

      expect(sessionState).toEqual({
        enabled: true,
        authenticated: false,
        provider: "github",
      });
    }).pipe(
      Effect.provide(
        makeUserAuthLayer({
          githubOAuthClientId: "client-id",
          githubOAuthClientSecret: "client-secret",
          githubOAuthCallbackUrl: new URL(
            "https://kamicode.example.com/api/user/auth/github/callback",
          ),
        }),
      ),
    ),
  );
});
