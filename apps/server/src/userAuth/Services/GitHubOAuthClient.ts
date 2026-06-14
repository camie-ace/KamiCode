import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface GitHubOAuthToken {
  readonly accessToken: string;
  readonly tokenType: string | null;
  readonly scope: string | null;
}

export interface GitHubOAuthDeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

export type GitHubOAuthDeviceAuthorizationResult =
  | { readonly status: "pending"; readonly intervalSeconds?: number }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "expired"; readonly message: string }
  | { readonly status: "authenticated"; readonly token: GitHubOAuthToken };

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
  readonly createDeviceCode: (input: {
    readonly clientId: string;
    readonly scope: string;
  }) => Effect.Effect<GitHubOAuthDeviceCode, GitHubOAuthError>;
  readonly pollDeviceAuthorization: (input: {
    readonly clientId: string;
    readonly deviceCode: string;
  }) => Effect.Effect<GitHubOAuthDeviceAuthorizationResult, GitHubOAuthError>;
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
