import { KamiUserId, UserAuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { UserAuthRepositoryError } from "../Errors.ts";

export const UserAuthUserRecord = Schema.Struct({
  userId: KamiUserId,
  githubId: Schema.String,
  githubLogin: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  lastLoginAt: Schema.DateTimeUtcFromString,
});
export type UserAuthUserRecord = typeof UserAuthUserRecord.Type;

export const UserAuthSessionRecord = Schema.Struct({
  sessionId: UserAuthSessionId,
  userId: KamiUserId,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  user: UserAuthUserRecord,
});
export type UserAuthSessionRecord = typeof UserAuthSessionRecord.Type;

export const UpsertGitHubUserInput = Schema.Struct({
  userId: KamiUserId,
  githubId: Schema.String,
  githubLogin: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  now: Schema.DateTimeUtcFromString,
});
export type UpsertGitHubUserInput = typeof UpsertGitHubUserInput.Type;

export const CreateUserAuthSessionInput = Schema.Struct({
  sessionId: UserAuthSessionId,
  userId: KamiUserId,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type CreateUserAuthSessionInput = typeof CreateUserAuthSessionInput.Type;

export const GetUserAuthSessionByIdInput = Schema.Struct({
  sessionId: UserAuthSessionId,
});
export type GetUserAuthSessionByIdInput = typeof GetUserAuthSessionByIdInput.Type;

export const RevokeUserAuthSessionInput = Schema.Struct({
  sessionId: UserAuthSessionId,
  revokedAt: Schema.DateTimeUtcFromString,
});
export type RevokeUserAuthSessionInput = typeof RevokeUserAuthSessionInput.Type;

export interface UserAuthRepositoryShape {
  readonly upsertGitHubUser: (
    input: UpsertGitHubUserInput,
  ) => Effect.Effect<UserAuthUserRecord, UserAuthRepositoryError>;
  readonly createSession: (
    input: CreateUserAuthSessionInput,
  ) => Effect.Effect<void, UserAuthRepositoryError>;
  readonly getSessionById: (
    input: GetUserAuthSessionByIdInput,
  ) => Effect.Effect<Option.Option<UserAuthSessionRecord>, UserAuthRepositoryError>;
  readonly revokeSession: (
    input: RevokeUserAuthSessionInput,
  ) => Effect.Effect<boolean, UserAuthRepositoryError>;
}

export class UserAuthRepository extends Context.Service<
  UserAuthRepository,
  UserAuthRepositoryShape
>()("t3/persistence/Services/UserAuth/UserAuthRepository") {}
