import { type UserAuthLogoutResult } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { UserAuth, UserAuthError } from "./Services/UserAuth.ts";

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

export const userAuthGitHubCallbackRouteLayer = HttpRouter.add(
  "GET",
  "/api/user/auth/github/callback",
  Effect.gen(function* () {
    const request = yield* authenticateServerSession;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return yield* new UserAuthError({
        message: "Invalid GitHub OAuth callback request.",
        status: 400,
      });
    }

    const providerError = url.value.searchParams.get("error_description");
    if (providerError) {
      return yield* new UserAuthError({
        message: providerError,
        status: 400,
      });
    }

    const code = url.value.searchParams.get("code")?.trim();
    const state = url.value.searchParams.get("state")?.trim();
    if (!code || !state) {
      return yield* new UserAuthError({
        message: "GitHub OAuth callback is missing code or state.",
        status: 400,
      });
    }

    const userAuth = yield* UserAuth;
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
