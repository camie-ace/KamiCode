import { KamiUserId, UserAuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type UserAuthRepositoryError,
} from "../Errors.ts";
import {
  CreateUserAuthSessionInput,
  GetUserAuthSessionByIdInput,
  RevokeUserAuthSessionInput,
  UpsertGitHubUserInput,
  UserAuthRepository,
  UserAuthSessionRecord,
  UserAuthUserRecord,
  type UserAuthRepositoryShape,
} from "../Services/UserAuth.ts";

const UserAuthSessionDbRow = Schema.Struct({
  sessionId: UserAuthSessionId,
  userId: KamiUserId,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  githubId: Schema.String,
  githubLogin: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  userCreatedAt: Schema.DateTimeUtcFromString,
  userUpdatedAt: Schema.DateTimeUtcFromString,
  userLastLoginAt: Schema.DateTimeUtcFromString,
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): UserAuthRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toSessionRecord(row: typeof UserAuthSessionDbRow.Type): UserAuthSessionRecord {
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    user: {
      userId: row.userId,
      githubId: row.githubId,
      githubLogin: row.githubLogin,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      createdAt: row.userCreatedAt,
      updatedAt: row.userUpdatedAt,
      lastLoginAt: row.userLastLoginAt,
    },
  };
}

const makeUserAuthRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertGitHubUserRow = SqlSchema.findOne({
    Request: UpsertGitHubUserInput,
    Result: UserAuthUserRecord,
    execute: (input) =>
      sql`
        INSERT INTO user_auth_users (
          user_id,
          github_id,
          github_login,
          display_name,
          avatar_url,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES (
          ${input.userId},
          ${input.githubId},
          ${input.githubLogin},
          ${input.displayName},
          ${input.avatarUrl},
          ${input.now},
          ${input.now},
          ${input.now}
        )
        ON CONFLICT(github_id) DO UPDATE SET
          github_login = excluded.github_login,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          updated_at = excluded.updated_at,
          last_login_at = excluded.last_login_at
        RETURNING
          user_id AS "userId",
          github_id AS "githubId",
          github_login AS "githubLogin",
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_login_at AS "lastLoginAt"
      `,
  });

  const createUserAuthSessionRow = SqlSchema.void({
    Request: CreateUserAuthSessionInput,
    execute: (input) =>
      sql`
        INSERT INTO user_auth_sessions (
          session_id,
          user_id,
          issued_at,
          expires_at,
          revoked_at
        )
        VALUES (
          ${input.sessionId},
          ${input.userId},
          ${input.issuedAt},
          ${input.expiresAt},
          NULL
        )
      `,
  });

  const getUserAuthSessionRowById = SqlSchema.findOneOption({
    Request: GetUserAuthSessionByIdInput,
    Result: UserAuthSessionDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session.session_id AS "sessionId",
          session.user_id AS "userId",
          session.issued_at AS "issuedAt",
          session.expires_at AS "expiresAt",
          session.revoked_at AS "revokedAt",
          auth_user.github_id AS "githubId",
          auth_user.github_login AS "githubLogin",
          auth_user.display_name AS "displayName",
          auth_user.avatar_url AS "avatarUrl",
          auth_user.created_at AS "userCreatedAt",
          auth_user.updated_at AS "userUpdatedAt",
          auth_user.last_login_at AS "userLastLoginAt"
        FROM user_auth_sessions session
        INNER JOIN user_auth_users auth_user ON auth_user.user_id = session.user_id
        WHERE session.session_id = ${sessionId}
      `,
  });

  const revokeUserAuthSessionRows = SqlSchema.findAll({
    Request: RevokeUserAuthSessionInput,
    Result: Schema.Struct({ sessionId: UserAuthSessionId }),
    execute: ({ sessionId, revokedAt }) =>
      sql`
        UPDATE user_auth_sessions
        SET revoked_at = ${revokedAt}
        WHERE session_id = ${sessionId}
          AND revoked_at IS NULL
        RETURNING session_id AS "sessionId"
      `,
  });

  const upsertGitHubUser: UserAuthRepositoryShape["upsertGitHubUser"] = (input) =>
    upsertGitHubUserRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UserAuthRepository.upsertGitHubUser:query",
          "UserAuthRepository.upsertGitHubUser:decodeRow",
        ),
      ),
    );

  const createSession: UserAuthRepositoryShape["createSession"] = (input) =>
    createUserAuthSessionRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UserAuthRepository.createSession:query",
          "UserAuthRepository.createSession:encodeRequest",
        ),
      ),
    );

  const getSessionById: UserAuthRepositoryShape["getSessionById"] = (input) =>
    getUserAuthSessionRowById(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UserAuthRepository.getSessionById:query",
          "UserAuthRepository.getSessionById:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => Effect.succeed(Option.some(toSessionRecord(row))),
        }),
      ),
    );

  const revokeSession: UserAuthRepositoryShape["revokeSession"] = (input) =>
    revokeUserAuthSessionRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "UserAuthRepository.revokeSession:query",
          "UserAuthRepository.revokeSession:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.length > 0),
    );

  return {
    upsertGitHubUser,
    createSession,
    getSessionById,
    revokeSession,
  } satisfies UserAuthRepositoryShape;
});

export const UserAuthRepositoryLive = Layer.effect(UserAuthRepository, makeUserAuthRepository);
