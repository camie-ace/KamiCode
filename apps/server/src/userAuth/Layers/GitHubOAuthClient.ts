import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  GitHubOAuthClient,
  GitHubOAuthError,
  type GitHubOAuthClientShape,
} from "../Services/GitHubOAuthClient.ts";

const GitHubOAuthTokenResponse = Schema.Struct({
  access_token: Schema.optionalKey(Schema.String),
  token_type: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  error_description: Schema.optionalKey(Schema.String),
  interval: Schema.optionalKey(Schema.Number),
});

const GitHubDeviceCodeResponse = Schema.Struct({
  device_code: Schema.optionalKey(Schema.String),
  user_code: Schema.optionalKey(Schema.String),
  verification_uri: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  interval: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
  error_description: Schema.optionalKey(Schema.String),
});

const GitHubUserResponse = Schema.Struct({
  id: Schema.Union([Schema.Number, Schema.String]),
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
});

const decodeTokenResponse = Schema.decodeUnknownEffect(GitHubOAuthTokenResponse);
const decodeDeviceCodeResponse = Schema.decodeUnknownEffect(GitHubDeviceCodeResponse);
const decodeUserResponse = Schema.decodeUnknownEffect(GitHubUserResponse);

const jsonFromResponse = (response: Response, operation: string) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) =>
      new GitHubOAuthError({
        message: `Failed to parse GitHub ${operation} response.`,
        status: 502,
        cause,
      }),
  });

const textFromResponse = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () => "",
  }).pipe(Effect.orElseSucceed(() => ""));

const createDeviceCode: GitHubOAuthClientShape["createDeviceCode"] = (input) =>
  Effect.gen(function* () {
    const body = new URLSearchParams({
      client_id: input.clientId,
      scope: input.scope,
    });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://github.com/login/device/code", {
          body,
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "KamiCode",
          },
          method: "POST",
        }),
      catch: (cause) =>
        new GitHubOAuthError({
          message: "Failed to start GitHub device login.",
          status: 502,
          cause,
        }),
    });

    const payload = yield* jsonFromResponse(response, "device code").pipe(
      Effect.flatMap(decodeDeviceCodeResponse),
      Effect.mapError(
        (cause) =>
          new GitHubOAuthError({
            message: "Invalid GitHub device code response.",
            status: 502,
            cause,
          }),
      ),
    );

    if (!response.ok || payload.error) {
      return yield* new GitHubOAuthError({
        message: payload.error_description ?? payload.error ?? "GitHub device login failed.",
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
      });
    }

    if (
      !payload.device_code ||
      !payload.user_code ||
      !payload.verification_uri ||
      !payload.expires_in
    ) {
      return yield* new GitHubOAuthError({
        message: "GitHub device code response did not include all required fields.",
        status: 502,
      });
    }

    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresInSeconds: payload.expires_in,
      intervalSeconds: payload.interval ?? 5,
    };
  });

const pollDeviceAuthorization: GitHubOAuthClientShape["pollDeviceAuthorization"] = (input) =>
  Effect.gen(function* () {
    const body = new URLSearchParams({
      client_id: input.clientId,
      device_code: input.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://github.com/login/oauth/access_token", {
          body,
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "KamiCode",
          },
          method: "POST",
        }),
      catch: (cause) =>
        new GitHubOAuthError({
          message: "Failed to poll GitHub device login.",
          status: 502,
          cause,
        }),
    });

    const payload = yield* jsonFromResponse(response, "device token").pipe(
      Effect.flatMap(decodeTokenResponse),
      Effect.mapError(
        (cause) =>
          new GitHubOAuthError({
            message: "Invalid GitHub device token response.",
            status: 502,
            cause,
          }),
      ),
    );

    if (payload.error === "authorization_pending") {
      return { status: "pending" } as const;
    }

    if (payload.error === "slow_down") {
      if (typeof payload.interval === "number") {
        return {
          status: "pending",
          intervalSeconds: payload.interval,
        } as const;
      }
      return { status: "pending" } as const;
    }

    if (payload.error === "expired_token") {
      return {
        status: "expired",
        message: payload.error_description ?? "GitHub device login expired.",
      } as const;
    }

    if (payload.error === "access_denied") {
      return {
        status: "denied",
        message: payload.error_description ?? "GitHub device login was denied.",
      } as const;
    }

    if (!response.ok || payload.error) {
      return yield* new GitHubOAuthError({
        message: payload.error_description ?? payload.error ?? "GitHub device login failed.",
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
      });
    }

    if (!payload.access_token) {
      return yield* new GitHubOAuthError({
        message: "GitHub device token response did not include an access token.",
        status: 502,
      });
    }

    return {
      status: "authenticated",
      token: {
        accessToken: payload.access_token,
        tokenType: payload.token_type ?? null,
        scope: payload.scope ?? null,
      },
    } as const;
  });

const exchangeCode: GitHubOAuthClientShape["exchangeCode"] = (input) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://github.com/login/oauth/access_token", {
          body: JSON.stringify({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
          }),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "KamiCode",
          },
          method: "POST",
        }),
      catch: (cause) =>
        new GitHubOAuthError({
          message: "Failed to exchange GitHub OAuth code.",
          status: 502,
          cause,
        }),
    });

    const body = yield* jsonFromResponse(response, "OAuth token").pipe(
      Effect.flatMap(decodeTokenResponse),
      Effect.mapError(
        (cause) =>
          new GitHubOAuthError({
            message: "Invalid GitHub OAuth token response.",
            status: 502,
            cause,
          }),
      ),
    );

    if (!response.ok || body.error) {
      return yield* new GitHubOAuthError({
        message: body.error_description ?? body.error ?? "GitHub OAuth code exchange failed.",
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
      });
    }

    if (!body.access_token) {
      return yield* new GitHubOAuthError({
        message: "GitHub OAuth token response did not include an access token.",
        status: 502,
      });
    }

    return {
      accessToken: body.access_token,
      tokenType: body.token_type ?? null,
      scope: body.scope ?? null,
    };
  });

const fetchUser: GitHubOAuthClientShape["fetchUser"] = (input) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://api.github.com/user", {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${input.accessToken}`,
            "user-agent": "KamiCode",
          },
        }),
      catch: (cause) =>
        new GitHubOAuthError({
          message: "Failed to fetch GitHub user.",
          status: 502,
          cause,
        }),
    });

    if (!response.ok) {
      const detail = yield* textFromResponse(response);
      return yield* new GitHubOAuthError({
        message: detail.trim() || `GitHub user request failed (${response.status}).`,
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
      });
    }

    const body = yield* jsonFromResponse(response, "user").pipe(
      Effect.flatMap(decodeUserResponse),
      Effect.mapError(
        (cause) =>
          new GitHubOAuthError({
            message: "Invalid GitHub user response.",
            status: 502,
            cause,
          }),
      ),
    );

    return {
      githubId: String(body.id),
      login: body.login,
      displayName: body.name,
      avatarUrl: body.avatar_url,
    };
  });

export const GitHubOAuthClientLive = Layer.succeed(GitHubOAuthClient, {
  createDeviceCode,
  pollDeviceAuthorization,
  exchangeCode,
  fetchUser,
} satisfies GitHubOAuthClientShape);
