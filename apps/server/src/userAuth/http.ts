import { type UserAuthLogoutResult } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { isDesktopGitHubLoginState, UserAuth, UserAuthError } from "./Services/UserAuth.ts";

const EXPIRED_COOKIE_DATE = DateTime.toDate(DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"));

export const respondToUserAuthError = (error: UserAuthError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("user auth route failed", {
        message: error.message,
        cause: error.cause,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500, headers: browserApiCorsHeaders },
    );
  });

const authenticateServerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
  return request;
});

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function desktopGitHubLoginPage(input: { readonly title: string; readonly message: string }) {
  return HttpServerResponse.text(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0a0a0a;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
      }
      p {
        color: #a3a3a3;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.message)}</p>
    </main>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export const userAuthSessionRouteLayer = HttpRouter.add(
  "GET",
  "/api/user/session",
  Effect.gen(function* () {
    const request = yield* authenticateServerSession;
    const userAuth = yield* UserAuth;
    const session = yield* userAuth.getSessionState(request);
    return HttpServerResponse.jsonUnsafe(session, {
      status: 200,
      headers: browserApiCorsHeaders,
    });
  }).pipe(Effect.catchTag("AuthError", (error) => respondToAuthError(error))),
);

export const userAuthGitHubStartRouteLayer = HttpRouter.add(
  "GET",
  "/api/user/auth/github/start",
  Effect.gen(function* () {
    const request = yield* authenticateServerSession;
    const userAuth = yield* UserAuth;
    const login = yield* userAuth.createGitHubLogin(request);
    return yield* HttpServerResponse.redirect(login.authorizationUrl, { status: 302 }).pipe(
      HttpServerResponse.setCookie(userAuth.stateCookieName, login.state, {
        expires: DateTime.toDate(login.expiresAt),
        httpOnly: true,
        path: userAuth.stateCookiePath,
        sameSite: "lax",
      }),
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
  ),
);

export const userAuthGitHubDesktopStartRouteLayer = HttpRouter.add(
  "POST",
  "/api/user/auth/github/desktop/start",
  Effect.gen(function* () {
    const request = yield* authenticateServerSession;
    const userAuth = yield* UserAuth;
    const login = yield* userAuth.createDesktopGitHubLogin(request);
    return HttpServerResponse.jsonUnsafe(
      {
        authorizationUrl: login.authorizationUrl,
        handoffId: login.handoffId,
        expiresAt: DateTime.toUtc(login.expiresAt),
      },
      {
        status: 200,
        headers: browserApiCorsHeaders,
      },
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
  ),
);

export const userAuthGitHubDesktopSessionRouteLayer = HttpRouter.add(
  "GET",
  "/api/user/auth/github/desktop/session",
  Effect.gen(function* () {
    yield* authenticateServerSession;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    const handoffId = Option.isSome(url) ? url.value.searchParams.get("handoffId")?.trim() : null;
    if (!handoffId) {
      return yield* new UserAuthError({
        message: "Missing GitHub login handoff id.",
        status: 400,
      });
    }

    const userAuth = yield* UserAuth;
    const result = yield* userAuth.consumeDesktopGitHubLogin({ handoffId });
    if (result.status === "pending") {
      return HttpServerResponse.jsonUnsafe(
        {
          status: "pending",
        },
        {
          status: 202,
          headers: browserApiCorsHeaders,
        },
      );
    }
    if (result.status === "error") {
      return HttpServerResponse.jsonUnsafe(
        {
          status: "error",
          message: result.message,
        },
        {
          status: 400,
          headers: browserApiCorsHeaders,
        },
      );
    }

    return yield* HttpServerResponse.jsonUnsafe(
      {
        status: "authenticated",
        sessionState: result.sessionState,
      },
      {
        status: 200,
        headers: browserApiCorsHeaders,
      },
    ).pipe(
      HttpServerResponse.setCookie(userAuth.cookieName, result.sessionToken, {
        expires: DateTime.toDate(result.sessionExpiresAt),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
  ),
);

export const userAuthGitHubCallbackRouteLayer = HttpRouter.add(
  "GET",
  "/api/user/auth/github/callback",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return yield* new UserAuthError({
        message: "Invalid GitHub OAuth callback request.",
        status: 400,
      });
    }

    const state = url.value.searchParams.get("state")?.trim();
    const providerError = url.value.searchParams.get("error_description");
    if (state && isDesktopGitHubLoginState(state) && providerError) {
      const userAuth = yield* UserAuth;
      yield* userAuth.failDesktopGitHubLogin({ state, message: providerError });
      return desktopGitHubLoginPage({
        title: "GitHub sign-in failed",
        message: providerError,
      });
    }
    if (providerError) {
      return yield* new UserAuthError({
        message: providerError,
        status: 400,
      });
    }

    const code = url.value.searchParams.get("code")?.trim();
    if (!code || !state) {
      return yield* new UserAuthError({
        message: "GitHub OAuth callback is missing code or state.",
        status: 400,
      });
    }

    const userAuth = yield* UserAuth;
    if (isDesktopGitHubLoginState(state)) {
      yield* userAuth.completeDesktopGitHubLogin({ code, state });
      return desktopGitHubLoginPage({
        title: "GitHub sign-in complete",
        message: "You can return to KamiCode. This tab can be closed.",
      });
    }

    yield* authenticateServerSession;
    const completed = yield* userAuth.completeGitHubLogin({ request, code, state });
    const response = yield* HttpServerResponse.redirect("/", { status: 302 }).pipe(
      HttpServerResponse.setCookie(userAuth.cookieName, completed.sessionToken, {
        expires: DateTime.toDate(completed.sessionExpiresAt),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    );
    return yield* HttpServerResponse.setCookie(userAuth.stateCookieName, "", {
      expires: EXPIRED_COOKIE_DATE,
      httpOnly: true,
      path: userAuth.stateCookiePath,
      sameSite: "lax",
    })(response);
  }).pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
  ),
);

export const userAuthLogoutRouteLayer = HttpRouter.add(
  "POST",
  "/api/user/logout",
  Effect.gen(function* () {
    const request = yield* authenticateServerSession;
    const userAuth = yield* UserAuth;
    yield* userAuth.logout(request);
    return yield* HttpServerResponse.jsonUnsafe({ ok: true } satisfies UserAuthLogoutResult, {
      status: 200,
      headers: browserApiCorsHeaders,
    }).pipe(
      HttpServerResponse.setCookie(userAuth.cookieName, "", {
        expires: EXPIRED_COOKIE_DATE,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) => respondToAuthError(error)),
    Effect.catchTag("UserAuthError", (error) => respondToUserAuthError(error)),
  ),
);
