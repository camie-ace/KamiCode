import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const KamiUserId = TrimmedNonEmptyString.pipe(Schema.brand("KamiUserId"));
export type KamiUserId = typeof KamiUserId.Type;

export const UserAuthSessionId = TrimmedNonEmptyString.pipe(Schema.brand("UserAuthSessionId"));
export type UserAuthSessionId = typeof UserAuthSessionId.Type;

export const UserAuthProvider = Schema.Literal("github");
export type UserAuthProvider = typeof UserAuthProvider.Type;

export const KamiUser = Schema.Struct({
  userId: KamiUserId,
  githubId: TrimmedNonEmptyString,
  githubLogin: TrimmedNonEmptyString,
  displayName: Schema.NullOr(TrimmedNonEmptyString),
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type KamiUser = typeof KamiUser.Type;

export const UserAuthDisabledSessionState = Schema.Struct({
  enabled: Schema.Literal(false),
  authenticated: Schema.Literal(false),
  provider: Schema.Null,
});
export type UserAuthDisabledSessionState = typeof UserAuthDisabledSessionState.Type;

export const UserAuthUnauthenticatedSessionState = Schema.Struct({
  enabled: Schema.Literal(true),
  authenticated: Schema.Literal(false),
  provider: UserAuthProvider,
});
export type UserAuthUnauthenticatedSessionState = typeof UserAuthUnauthenticatedSessionState.Type;

export const UserAuthAuthenticatedSessionState = Schema.Struct({
  enabled: Schema.Literal(true),
  authenticated: Schema.Literal(true),
  provider: UserAuthProvider,
  user: KamiUser,
  expiresAt: Schema.DateTimeUtc,
});
export type UserAuthAuthenticatedSessionState = typeof UserAuthAuthenticatedSessionState.Type;

export const UserAuthSessionState = Schema.Union([
  UserAuthDisabledSessionState,
  UserAuthUnauthenticatedSessionState,
  UserAuthAuthenticatedSessionState,
]);
export type UserAuthSessionState = typeof UserAuthSessionState.Type;

export const UserAuthLogoutResult = Schema.Struct({
  ok: Schema.Boolean,
});
export type UserAuthLogoutResult = typeof UserAuthLogoutResult.Type;
