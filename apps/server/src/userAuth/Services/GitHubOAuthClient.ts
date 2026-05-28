import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface GitHubOAuthToken {
  readonly accessToken: string;
  readonly tokenType: string | null;
  readonly scope: string | null;
}

export interface GitHubOAuthUser {
  readonly githubId: string;
  readonly login: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export class GitHubOAuthError extends Data.TaggedError("GitHubOAuthError")<{
  readonly message: string;
  readonly status?: 400 | 502;
  readonly cause?: unknown;
}> {}

export interface GitHubOAuthClientShape {
  readonly exchangeCode: (input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly redirectUri: string;
  }) => Effect.Effect<GitHubOAuthToken, GitHubOAuthError>;
  readonly fetchUser: (input: {
    readonly accessToken: string;
  }) => Effect.Effect<GitHubOAuthUser, GitHubOAuthError>;
}

export class GitHubOAuthClient extends Context.Service<GitHubOAuthClient, GitHubOAuthClientShape>()(
  "t3/userAuth/Services/GitHubOAuthClient",
) {}
