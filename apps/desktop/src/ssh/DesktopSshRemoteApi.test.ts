import { assert, describe, it } from "@effect/vitest";
import { SshHttpBridgeError } from "@t3tools/ssh/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as DesktopSshRemoteApi from "./DesktopSshRemoteApi.ts";

function jsonResponse(request: HttpClientRequest.HttpClientRequest, body: unknown, status = 200) {
  return HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function makeLayer(
  handler: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse>,
) {
  return DesktopSshRemoteApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => handler(request)),
      ),
    ),
  );
}

describe("DesktopSshRemoteApi", () => {
  it.effect("fetches and decodes the remote environment descriptor", () => {
    const requestUrls: string[] = [];
    const layer = makeLayer((request) =>
      Effect.sync(() => {
        requestUrls.push(request.url);
        return jsonResponse(request, {
          environmentId: "remote-env",
          label: "Remote Devbox",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "1.2.3",
          capabilities: { repositoryIdentity: true },
        });
      }),
    );

    return Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      const descriptor = yield* remoteApi.fetchEnvironmentDescriptor({
        httpBaseUrl: "http://127.0.0.1:41773/",
      });

      assert.equal(descriptor.label, "Remote Devbox");
      assert.deepEqual(requestUrls, ["http://127.0.0.1:41773/.well-known/t3/environment"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("wraps schema decode failures in a typed remote api error", () => {
    const layer = makeLayer((request) =>
      Effect.succeed(jsonResponse(request, { environmentId: "remote-env" })),
    );

    return Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      const error = yield* remoteApi
        .fetchEnvironmentDescriptor({
          httpBaseUrl: "http://127.0.0.1:41773/",
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, DesktopSshRemoteApi.DesktopSshRemoteApiError);
      assert.equal(error.operation, "fetch-environment-descriptor");
      assert.equal(error.cause instanceof SshHttpBridgeError, false);
      assert.include(
        error.message,
        "SSH remote API request failed during fetch-environment-descriptor:",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("decodes auth endpoint ISO date strings from remote JSON", () => {
    const bearerExpiresAt = "2026-07-04T14:06:00.474Z";
    const sessionExpiresAt = "2026-07-04T14:07:00.474Z";
    const wsExpiresAt = "2026-07-04T14:08:00.474Z";
    const layer = makeLayer((request) =>
      Effect.sync(() => {
        const pathname = new URL(request.url).pathname;
        switch (pathname) {
          case "/api/auth/bootstrap/bearer":
            return jsonResponse(request, {
              authenticated: true,
              role: "owner",
              sessionMethod: "bearer-session-token",
              expiresAt: bearerExpiresAt,
              sessionToken: "remote-bearer-token",
            });
          case "/api/auth/session":
            return jsonResponse(request, {
              authenticated: true,
              auth: {
                policy: "remote-reachable",
                bootstrapMethods: ["one-time-token"],
                sessionMethods: ["browser-session-cookie", "bearer-session-token"],
                sessionCookieName: "t3_session",
              },
              role: "owner",
              sessionMethod: "bearer-session-token",
              expiresAt: sessionExpiresAt,
            });
          case "/api/auth/ws-token":
            return jsonResponse(request, {
              token: "remote-ws-token",
              expiresAt: wsExpiresAt,
            });
          default:
            return jsonResponse(request, { error: "not found" }, 404);
        }
      }),
    );

    return Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      const bearer = yield* remoteApi.bootstrapBearerSession({
        httpBaseUrl: "http://127.0.0.1:41773/",
        credential: "pairing-token",
      });
      const session = yield* remoteApi.fetchSessionState({
        httpBaseUrl: "http://127.0.0.1:41773/",
        bearerToken: bearer.sessionToken,
      });
      const wsToken = yield* remoteApi.issueWebSocketToken({
        httpBaseUrl: "http://127.0.0.1:41773/",
        bearerToken: bearer.sessionToken,
      });

      assert.equal(DateTime.toEpochMillis(bearer.expiresAt), Date.parse(bearerExpiresAt));
      if (!session.expiresAt) {
        assert.fail("Expected authenticated session state to include expiresAt.");
      }
      assert.equal(DateTime.toEpochMillis(session.expiresAt), Date.parse(sessionExpiresAt));
      assert.equal(DateTime.toEpochMillis(wsToken.expiresAt), Date.parse(wsExpiresAt));
    }).pipe(Effect.provide(layer));
  });
});
