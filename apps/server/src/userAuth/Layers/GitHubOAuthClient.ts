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
});

const GitHubUserResponse = Schema.Struct({
  id: Schema.Union([Schema.Number, Schema.String]),
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
});

const decodeTokenResponse = Schema.decodeUnknownEffect(GitHubOAuthTokenResponse);
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
  exchangeCode,
  fetchUser,
} satisfies GitHubOAuthClientShape);
