import {
  KamiUserId,
  ProjectId,
  SharedContextBundle as SharedContextBundleSchema,
  SharedThreadCodeState as SharedThreadCodeStateSchema,
  SharedThreadMessage as SharedThreadMessageSchema,
  SharedDeployAssociationId,
  SharedEnvironmentType,
  SharedEnvironmentValidationStatus,
  SharedProjectEnvironmentId,
  SharedProjectId,
  SharedProjectInviteCode,
  SharedProjectRole,
  SharedRuntimeHealth,
  SharedRuntimeId,
  SharedRuntimeType,
  SharedThreadId,
  SharedThreadVisibility,
  ThreadId,
  type SharedContextBundle,
  type SharedDeployAssociation,
  type SharedProjectBootstrapManifest,
  type SharedProjectClaimResult,
  type SharedProjectDetail,
  type SharedProjectEnvironment,
  type SharedProjectInvite,
  type SharedProjectListResult,
  type SharedProjectMember,
  type SharedProjectSummary,
  type SharedRepositoryState,
  type SharedRuntime,
  type SharedThread,
  type SharedThreadMessage,
} from "@t3tools/contracts";
import { randomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ProcessRunner from "../../processRunner.ts";
import {
  RepositoryIdentityResolver,
  type RepositoryIdentityResolverShape,
} from "../../project/Services/RepositoryIdentityResolver.ts";
import type { AuthenticatedUser } from "../../userAuth/Services/UserAuth.ts";
import {
  canEditSharedWork,
  canManageSharedProject,
  normalizeGitHubLogin,
  resolveDeployState,
  resolveInviteStatus,
  roleAtLeast,
  validateSharedEnvironmentUrl,
} from "../logic.ts";
import {
  SharedProjects,
  SharedProjectsError,
  type SharedProjectsShape,
} from "../Services/SharedProjects.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONTEXT_FILE_BYTES = 40_000;
const MAX_CONTEXT_ITEMS = 80;

const ContextBundleJson = Schema.fromJsonString(SharedContextBundleSchema);
const ThreadCodeStateJson = Schema.fromJsonString(SharedThreadCodeStateSchema);
const ThreadMessagesJson = Schema.fromJsonString(Schema.Array(SharedThreadMessageSchema));
const StringArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));
const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    scripts: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

const encodeContextBundleJson = Schema.encodeSync(ContextBundleJson);
const decodeContextBundleJson = Schema.decodeUnknownSync(ContextBundleJson);
const encodeThreadCodeStateJson = Schema.encodeSync(ThreadCodeStateJson);
const decodeThreadCodeStateJson = Schema.decodeUnknownSync(ThreadCodeStateJson);
const encodeThreadMessagesJson = Schema.encodeSync(ThreadMessagesJson);
const decodeThreadMessagesJson = Schema.decodeUnknownSync(ThreadMessagesJson);
const encodeStringArrayJson = Schema.encodeSync(StringArrayJson);
const decodeStringArrayJson = Schema.decodeUnknownSync(StringArrayJson);
const decodePackageJson = Schema.decodeUnknownSync(PackageJson);

type SharedProjectRow = {
  readonly sharedProjectId: string;
  readonly sourceProjectId: string | null;
  readonly name: string;
  readonly ownerUserId: string;
  readonly ownerGithubId: string;
  readonly ownerGithubLogin: string;
  readonly repoCanonicalKey: string | null;
  readonly repoRemoteUrl: string | null;
  readonly repoRemoteName: string | null;
  readonly defaultBranch: string | null;
  readonly currentBranch: string | null;
  readonly currentHeadSha: string | null;
  readonly dirty: number;
  readonly contextJson: string | null;
  readonly contextSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ProjectAccessRow = SharedProjectRow & {
  readonly role: string;
};

type MemberRow = {
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly githubId: string;
  readonly githubLogin: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly role: string;
  readonly joinedAt: string;
  readonly invitedByUserId: string | null;
};

type InviteRow = {
  readonly inviteCode: string;
  readonly sharedProjectId: string;
  readonly invitedGithubLogin: string;
  readonly invitedGithubId: string | null;
  readonly role: string;
  readonly invitedByUserId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly claimedAt: string | null;
  readonly claimedByUserId: string | null;
  readonly revokedAt: string | null;
};

type ThreadRow = {
  readonly sharedThreadId: string;
  readonly sharedProjectId: string;
  readonly localThreadId: string | null;
  readonly createdByUserId: string;
  readonly title: string;
  readonly visibility: string;
  readonly codeStateJson: string;
  readonly messagesJson: string;
  readonly lastRuntimeId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type RuntimeRow = {
  readonly runtimeId: string;
  readonly sharedProjectId: string;
  readonly runtimeType: string;
  readonly ownerUserId: string;
  readonly label: string;
  readonly endpointLabel: string | null;
  readonly health: string;
  readonly capabilitiesJson: string;
  readonly providerLabel: string | null;
  readonly unavailableReason: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type EnvironmentRow = {
  readonly environmentId: string;
  readonly sharedProjectId: string;
  readonly name: string;
  readonly environmentType: string;
  readonly baseUrl: string;
  readonly isDefault: number;
  readonly validationStatus: string;
  readonly lastValidatedAt: string | null;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type DeployRow = {
  readonly deployId: string;
  readonly sharedProjectId: string;
  readonly branch: string;
  readonly environmentId: string;
  readonly deployUrl: string;
  readonly deployedSha: string | null;
  readonly source: string;
  readonly lastCheckedState: string;
  readonly lastCheckedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const futureIso = (ms: number) =>
  DateTime.now.pipe(
    Effect.map((now) => DateTime.add(now, { milliseconds: ms })),
    Effect.map(DateTime.formatIso),
  );

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function newInviteCode(): SharedProjectInviteCode {
  return SharedProjectInviteCode.make(`spc_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
}

function roleFromDb(value: string): SharedProjectRole {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer"
    ? value
    : "viewer";
}

function runtimeTypeFromDb(value: string): SharedRuntimeType {
  return value === "local" || value === "ssh-vps" || value === "hosted-worker" ? value : "local";
}

function runtimeHealthFromDb(value: string): SharedRuntimeHealth {
  return value === "healthy" || value === "unavailable" || value === "unknown" ? value : "unknown";
}

function threadVisibilityFromDb(value: string): SharedThreadVisibility {
  return value === "private" || value === "shared" ? value : "private";
}

function environmentTypeFromDb(value: string): SharedEnvironmentType {
  return value === "local-dev" ||
    value === "preview" ||
    value === "vps-staging" ||
    value === "production" ||
    value === "custom"
    ? value
    : "custom";
}

function validationStatusFromDb(value: string): SharedEnvironmentValidationStatus {
  return value === "unknown" ||
    value === "reachable" ||
    value === "unreachable" ||
    value === "invalid-url"
    ? value
    : "unknown";
}

function decodeJsonOr<T>(decode: (value: unknown) => T, value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return decode(value);
  } catch {
    return fallback;
  }
}

function toRepositoryState(row: SharedProjectRow): SharedRepositoryState {
  return {
    canonicalKey: row.repoCanonicalKey,
    remoteUrl: row.repoRemoteUrl,
    remoteName: row.repoRemoteName,
    defaultBranch: row.defaultBranch,
    currentBranch: row.currentBranch,
    headSha: row.currentHeadSha,
    dirty: row.dirty === 1,
  };
}

function toProjectSummary(row: ProjectAccessRow): SharedProjectSummary {
  return {
    id: SharedProjectId.make(row.sharedProjectId),
    sourceProjectId: row.sourceProjectId === null ? null : ProjectId.make(row.sourceProjectId),
    name: row.name,
    ownerUserId: KamiUserId.make(row.ownerUserId),
    ownerGithubLogin: row.ownerGithubLogin,
    role: roleFromDb(row.role),
    repository: toRepositoryState(row),
    contextSyncedAt: row.contextSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMember(row: MemberRow): SharedProjectMember {
  return {
    projectId: SharedProjectId.make(row.sharedProjectId),
    userId: KamiUserId.make(row.userId),
    githubId: row.githubId,
    githubLogin: row.githubLogin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    role: roleFromDb(row.role),
    joinedAt: row.joinedAt,
    invitedByUserId: row.invitedByUserId === null ? null : KamiUserId.make(row.invitedByUserId),
  };
}

function toInvite(row: InviteRow, now: string): SharedProjectInvite {
  const invite = {
    code: SharedProjectInviteCode.make(row.inviteCode),
    projectId: SharedProjectId.make(row.sharedProjectId),
    githubLogin: row.invitedGithubLogin,
    githubId: row.invitedGithubId,
    role: roleFromDb(row.role),
    invitedByUserId: KamiUserId.make(row.invitedByUserId),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    claimedAt: row.claimedAt,
    claimedByUserId: row.claimedByUserId === null ? null : KamiUserId.make(row.claimedByUserId),
    revokedAt: row.revokedAt,
    status: "pending" as const,
  };
  return {
    ...invite,
    status: resolveInviteStatus(invite, now),
  };
}

function toThread(row: ThreadRow): SharedThread {
  return {
    id: SharedThreadId.make(row.sharedThreadId),
    projectId: SharedProjectId.make(row.sharedProjectId),
    localThreadId: row.localThreadId === null ? null : ThreadId.make(row.localThreadId),
    createdByUserId: KamiUserId.make(row.createdByUserId),
    title: row.title,
    visibility: threadVisibilityFromDb(row.visibility),
    codeState: decodeJsonOr(decodeThreadCodeStateJson, row.codeStateJson, {
      branch: null,
      headSha: null,
      dirty: false,
      patchAttached: false,
    }),
    messages: decodeJsonOr(decodeThreadMessagesJson, row.messagesJson, []),
    lastRuntimeId: row.lastRuntimeId === null ? null : SharedRuntimeId.make(row.lastRuntimeId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRuntime(row: RuntimeRow): SharedRuntime {
  return {
    id: SharedRuntimeId.make(row.runtimeId),
    projectId: SharedProjectId.make(row.sharedProjectId),
    type: runtimeTypeFromDb(row.runtimeType),
    ownerUserId: KamiUserId.make(row.ownerUserId),
    label: row.label,
    endpointLabel: row.endpointLabel,
    health: runtimeHealthFromDb(row.health),
    capabilities: decodeJsonOr(decodeStringArrayJson, row.capabilitiesJson, []),
    providerLabel: row.providerLabel,
    unavailableReason: row.unavailableReason,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEnvironment(row: EnvironmentRow): SharedProjectEnvironment {
  return {
    id: SharedProjectEnvironmentId.make(row.environmentId),
    projectId: SharedProjectId.make(row.sharedProjectId),
    name: row.name,
    type: environmentTypeFromDb(row.environmentType),
    baseUrl: row.baseUrl,
    isDefault: row.isDefault === 1,
    validationStatus: validationStatusFromDb(row.validationStatus),
    lastValidatedAt: row.lastValidatedAt,
    source: row.source === "runtime-sync" || row.source === "deploy-sync" ? row.source : "manual",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDeploy(row: DeployRow): SharedDeployAssociation {
  return {
    id: SharedDeployAssociationId.make(row.deployId),
    projectId: SharedProjectId.make(row.sharedProjectId),
    branch: row.branch,
    environmentId: SharedProjectEnvironmentId.make(row.environmentId),
    deployUrl: row.deployUrl,
    deployedSha: row.deployedSha,
    source: row.source === "runtime-sync" || row.source === "deploy-sync" ? row.source : "manual",
    state:
      row.lastCheckedState === "current" || row.lastCheckedState === "stale"
        ? row.lastCheckedState
        : "unknown",
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asSharedProjectsError(operation: string) {
  return (cause: unknown): SharedProjectsError =>
    cause instanceof SharedProjectsError
      ? cause
      : new SharedProjectsError({
          message: `Failed to ${operation}.`,
          status: 500,
          cause,
        });
}

function fileExists(fileSystem: FileSystem.FileSystem, filePath: string) {
  return fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
}

function safeReadText(fileSystem: FileSystem.FileSystem, filePath: string) {
  return Effect.gen(function* () {
    const exists = yield* fileExists(fileSystem, filePath);
    if (!exists) return null;
    const content = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.orElseSucceed(() => null));
    if (content === null || content.length > MAX_CONTEXT_FILE_BYTES) return null;
    return content;
  });
}

function detectPackageManager(fileSystem: FileSystem.FileSystem, path: Path.Path, cwd: string) {
  return Effect.gen(function* () {
    if (yield* fileExists(fileSystem, path.join(cwd, "bun.lock"))) return "bun";
    if (yield* fileExists(fileSystem, path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (yield* fileExists(fileSystem, path.join(cwd, "yarn.lock"))) return "yarn";
    if (yield* fileExists(fileSystem, path.join(cwd, "package-lock.json"))) return "npm";
    if (yield* fileExists(fileSystem, path.join(cwd, "package.json"))) return "npm";
    return null;
  });
}

function readPackageScripts(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
): Effect.Effect<SharedContextBundle["scripts"]> {
  return Effect.gen(function* () {
    const packageJson = yield* safeReadText(fileSystem, path.join(cwd, "package.json"));
    if (!packageJson) return [];
    const parsed = decodeJsonOr(decodePackageJson, packageJson, { scripts: {} });
    return Object.entries(parsed.scripts ?? {})
      .filter(([, command]) => typeof command === "string" && command.trim().length > 0)
      .slice(0, MAX_CONTEXT_ITEMS)
      .map(([name, command]) => ({ name, command: command as string }));
  });
}

function readEnvironmentVariableNames(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
): Effect.Effect<SharedContextBundle["environmentVariables"]> {
  return Effect.gen(function* () {
    const entries = yield* fileSystem
      .readDirectory(cwd, { recursive: false })
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    const envFiles = entries
      .filter((entry) => /^\.env(?:\.|$)/u.test(entry))
      .filter((entry) => !entry.endsWith(".local"))
      .slice(0, 8);
    const variables: Array<SharedContextBundle["environmentVariables"][number]> = [];
    for (const file of envFiles) {
      const content = yield* safeReadText(fileSystem, path.join(cwd, file));
      if (!content) continue;
      for (const line of content.split(/\r?\n/u)) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
        if (!match?.[1]) continue;
        variables.push({ file, name: match[1] });
        if (variables.length >= MAX_CONTEXT_ITEMS) return variables;
      }
    }
    return variables;
  });
}

function buildContextBundle(fileSystem: FileSystem.FileSystem, path: Path.Path, cwd: string) {
  return Effect.gen(function* () {
    const syncedAt = yield* nowIso;
    const [projectMemory, packageManager, scripts, environmentVariables] = yield* Effect.all([
      safeReadText(fileSystem, path.join(cwd, ".camie", "project-memory.md")),
      detectPackageManager(fileSystem, path, cwd),
      readPackageScripts(fileSystem, path, cwd),
      readEnvironmentVariableNames(fileSystem, path, cwd),
    ]);
    const instructionCandidates = yield* Effect.all(
      ["AGENTS.md", ".kami/BOOTSTRAP.md"].map((relativePath) =>
        safeReadText(fileSystem, path.join(cwd, relativePath)).pipe(
          Effect.map((content) => (content ? { path: relativePath, content } : null)),
        ),
      ),
    );
    const instructions = instructionCandidates.filter(
      (entry): entry is SharedContextBundle["instructions"][number] => entry !== null,
    );

    return {
      syncedAt,
      includedCategories: [
        "project memory",
        "instructions",
        "repo metadata",
        "package scripts",
        "environment variable names",
      ],
      excludedCategories: [
        "secret values",
        "private keys",
        "auth state",
        "raw .env contents",
        "provider credentials",
      ],
      projectMemory,
      instructions,
      packageManager,
      scripts,
      environmentVariables,
    } satisfies SharedContextBundle;
  });
}

const runGit = Effect.fn("SharedProjects.runGit")(function* (
  processRunner: ProcessRunner.ProcessRunnerShape,
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cwd, ...args],
      timeoutBehavior: "timedOutResult",
      shell: process.platform === "win32",
    })
    .pipe(Effect.option);
  if (result._tag === "None" || result.value.code !== 0) return null;
  const value = result.value.stdout.trim();
  return value.length > 0 ? value : null;
});

const resolveRepositoryState = Effect.fn("SharedProjects.resolveRepositoryState")(function* (
  processRunner: ProcessRunner.ProcessRunnerShape,
  repositoryIdentityResolver: RepositoryIdentityResolverShape,
  cwd: string,
) {
  const repositoryIdentity = yield* repositoryIdentityResolver
    .resolve(cwd)
    .pipe(Effect.orElseSucceed(() => null));
  const [currentBranch, headSha, status, defaultRemoteHead] = yield* Effect.all([
    runGit(processRunner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(processRunner, cwd, ["rev-parse", "HEAD"]),
    runGit(processRunner, cwd, ["status", "--porcelain"]),
    runGit(processRunner, cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
  ]);
  const defaultBranch = defaultRemoteHead?.startsWith("origin/")
    ? defaultRemoteHead.slice("origin/".length)
    : defaultRemoteHead;

  return {
    canonicalKey: repositoryIdentity?.canonicalKey ?? null,
    remoteUrl: repositoryIdentity?.locator.remoteUrl ?? null,
    remoteName: repositoryIdentity?.locator.remoteName ?? null,
    defaultBranch: defaultBranch ?? null,
    currentBranch: currentBranch ?? null,
    headSha: headSha ?? null,
    dirty: status !== null && status.length > 0,
  } satisfies SharedRepositoryState;
});

export const makeSharedProjects = Effect.fn("makeSharedProjects")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const loadProjectAccess = Effect.fn("SharedProjects.loadProjectAccess")(function* (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ) {
    const rows = yield* sql<ProjectAccessRow>`
      SELECT
        p.shared_project_id AS "sharedProjectId",
        p.source_project_id AS "sourceProjectId",
        p.name,
        p.owner_user_id AS "ownerUserId",
        p.owner_github_id AS "ownerGithubId",
        p.owner_github_login AS "ownerGithubLogin",
        p.repo_canonical_key AS "repoCanonicalKey",
        p.repo_remote_url AS "repoRemoteUrl",
        p.repo_remote_name AS "repoRemoteName",
        p.default_branch AS "defaultBranch",
        p.current_branch AS "currentBranch",
        p.current_head_sha AS "currentHeadSha",
        p.dirty,
        p.context_json AS "contextJson",
        p.context_synced_at AS "contextSyncedAt",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",
        m.role
      FROM shared_projects p
      JOIN shared_project_members m ON m.shared_project_id = p.shared_project_id
      WHERE p.shared_project_id = ${projectId}
        AND m.user_id = ${user.user.userId}
        AND m.removed_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return yield* new SharedProjectsError({
        message: "Shared project was not found or is not available to this GitHub account.",
        status: 404,
      });
    }
    return row;
  });

  const requireRole = Effect.fn("SharedProjects.requireRole")(function* (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
    predicate: (role: SharedProjectRole) => boolean,
    message: string,
  ) {
    const row = yield* loadProjectAccess(user, projectId);
    const role = roleFromDb(row.role);
    if (!predicate(role)) {
      return yield* new SharedProjectsError({ message, status: 403 });
    }
    return { row, role };
  });

  const ensureEnvironmentDefault = Effect.fn("SharedProjects.ensureEnvironmentDefault")(function* (
    projectId: SharedProjectId,
  ) {
    const defaultRows = yield* sql<{ readonly environmentId: string }>`
      SELECT environment_id AS "environmentId"
      FROM shared_project_environments
      WHERE shared_project_id = ${projectId}
        AND is_default = 1
      LIMIT 1
    `;
    if (defaultRows.length > 0) return;
    const firstRows = yield* sql<{ readonly environmentId: string }>`
      SELECT environment_id AS "environmentId"
      FROM shared_project_environments
      WHERE shared_project_id = ${projectId}
      ORDER BY created_at ASC, environment_id ASC
      LIMIT 1
    `;
    const first = firstRows[0];
    if (!first) return;
    yield* sql`
      UPDATE shared_project_environments
      SET is_default = 1
      WHERE environment_id = ${first.environmentId}
    `;
  });

  const loadDetailFromAccess = Effect.fn("SharedProjects.loadDetailFromAccess")(function* (
    user: AuthenticatedUser,
    access: ProjectAccessRow,
  ) {
    const projectId = SharedProjectId.make(access.sharedProjectId);
    const role = roleFromDb(access.role);
    const [memberRows, inviteRows, threadRows, runtimeRows, environmentRows, deployRows] =
      yield* Effect.all([
        sql<MemberRow>`
          SELECT
            shared_project_id AS "sharedProjectId",
            user_id AS "userId",
            github_id AS "githubId",
            github_login AS "githubLogin",
            display_name AS "displayName",
            avatar_url AS "avatarUrl",
            role,
            joined_at AS "joinedAt",
            invited_by_user_id AS "invitedByUserId"
          FROM shared_project_members
          WHERE shared_project_id = ${projectId}
            AND removed_at IS NULL
          ORDER BY
            CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
            github_login ASC
        `,
        sql<InviteRow>`
          SELECT
            invite_code AS "inviteCode",
            shared_project_id AS "sharedProjectId",
            invited_github_login AS "invitedGithubLogin",
            invited_github_id AS "invitedGithubId",
            role,
            invited_by_user_id AS "invitedByUserId",
            created_at AS "createdAt",
            expires_at AS "expiresAt",
            claimed_at AS "claimedAt",
            claimed_by_user_id AS "claimedByUserId",
            revoked_at AS "revokedAt"
          FROM shared_project_invites
          WHERE shared_project_id = ${projectId}
          ORDER BY created_at DESC
        `,
        sql<ThreadRow>`
          SELECT
            shared_thread_id AS "sharedThreadId",
            shared_project_id AS "sharedProjectId",
            local_thread_id AS "localThreadId",
            created_by_user_id AS "createdByUserId",
            title,
            visibility,
            code_state_json AS "codeStateJson",
            messages_json AS "messagesJson",
            last_runtime_id AS "lastRuntimeId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM shared_threads
          WHERE shared_project_id = ${projectId}
          ORDER BY updated_at DESC
        `,
        sql<RuntimeRow>`
          SELECT
            runtime_id AS "runtimeId",
            shared_project_id AS "sharedProjectId",
            runtime_type AS "runtimeType",
            owner_user_id AS "ownerUserId",
            label,
            endpoint_label AS "endpointLabel",
            health,
            capabilities_json AS "capabilitiesJson",
            provider_label AS "providerLabel",
            unavailable_reason AS "unavailableReason",
            last_seen_at AS "lastSeenAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM shared_runtimes
          WHERE shared_project_id = ${projectId}
          ORDER BY created_at ASC
        `,
        sql<EnvironmentRow>`
          SELECT
            environment_id AS "environmentId",
            shared_project_id AS "sharedProjectId",
            name,
            environment_type AS "environmentType",
            base_url AS "baseUrl",
            is_default AS "isDefault",
            validation_status AS "validationStatus",
            last_validated_at AS "lastValidatedAt",
            source,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM shared_project_environments
          WHERE shared_project_id = ${projectId}
          ORDER BY is_default DESC, created_at ASC
        `,
        sql<DeployRow>`
          SELECT
            deploy_id AS "deployId",
            shared_project_id AS "sharedProjectId",
            branch,
            environment_id AS "environmentId",
            deploy_url AS "deployUrl",
            deployed_sha AS "deployedSha",
            source,
            last_checked_state AS "lastCheckedState",
            last_checked_at AS "lastCheckedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM shared_deploy_associations
          WHERE shared_project_id = ${projectId}
          ORDER BY updated_at DESC
        `,
      ]);

    const now = yield* nowIso;
    const canSeePrivateThreads = roleAtLeast(role, "admin");
    return {
      project: toProjectSummary(access),
      contextBundle: decodeJsonOr(decodeContextBundleJson, access.contextJson, null),
      members: memberRows.map(toMember),
      invites: canManageSharedProject(role) ? inviteRows.map((row) => toInvite(row, now)) : [],
      threads: threadRows
        .map(toThread)
        .filter(
          (thread) =>
            thread.visibility === "shared" ||
            canSeePrivateThreads ||
            thread.createdByUserId === user.user.userId,
        ),
      runtimes: runtimeRows.map(toRuntime),
      environments: environmentRows.map(toEnvironment),
      deploys: deployRows.map(toDeploy),
    } satisfies SharedProjectDetail;
  });

  const loadDetail = Effect.fn("SharedProjects.loadDetail")(function* (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ) {
    const access = yield* loadProjectAccess(user, projectId);
    return yield* loadDetailFromAccess(user, access);
  });

  const insertOwnerRuntime = Effect.fn("SharedProjects.insertOwnerRuntime")(function* (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
    createdAt: string,
  ) {
    yield* sql`
      INSERT INTO shared_runtimes (
        runtime_id,
        shared_project_id,
        runtime_type,
        owner_user_id,
        label,
        endpoint_label,
        health,
        capabilities_json,
        provider_label,
        unavailable_reason,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (
        ${newId("rt")},
        ${projectId},
        'local',
        ${user.user.userId},
        'Local desktop',
        'This device',
        'healthy',
        ${encodeStringArrayJson(["execute", "test", "sync"])},
        'User-local provider profile',
        NULL,
        ${createdAt},
        ${createdAt},
        ${createdAt}
      )
    `;
  });

  const listForUser: SharedProjectsShape["listForUser"] = (user) =>
    Effect.gen(function* () {
      const rows = yield* sql<ProjectAccessRow>`
        SELECT
          p.shared_project_id AS "sharedProjectId",
          p.source_project_id AS "sourceProjectId",
          p.name,
          p.owner_user_id AS "ownerUserId",
          p.owner_github_id AS "ownerGithubId",
          p.owner_github_login AS "ownerGithubLogin",
          p.repo_canonical_key AS "repoCanonicalKey",
          p.repo_remote_url AS "repoRemoteUrl",
          p.repo_remote_name AS "repoRemoteName",
          p.default_branch AS "defaultBranch",
          p.current_branch AS "currentBranch",
          p.current_head_sha AS "currentHeadSha",
          p.dirty,
          p.context_json AS "contextJson",
          p.context_synced_at AS "contextSyncedAt",
          p.created_at AS "createdAt",
          p.updated_at AS "updatedAt",
          m.role
        FROM shared_projects p
        JOIN shared_project_members m ON m.shared_project_id = p.shared_project_id
        WHERE m.user_id = ${user.user.userId}
          AND m.removed_at IS NULL
        ORDER BY p.updated_at DESC
      `;
      return { projects: rows.map(toProjectSummary) } satisfies SharedProjectListResult;
    }).pipe(Effect.mapError(asSharedProjectsError("list shared projects")));

  const publishLocalProject: SharedProjectsShape["publishLocalProject"] = (user, input) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso;
      const repository = yield* resolveRepositoryState(
        processRunner,
        repositoryIdentityResolver,
        input.cwd,
      );
      const contextBundle = yield* buildContextBundle(fileSystem, path, input.cwd);
      const existingRows = yield* sql<{ readonly sharedProjectId: string }>`
        SELECT shared_project_id AS "sharedProjectId"
        FROM shared_projects
        WHERE owner_user_id = ${user.user.userId}
          AND source_project_id = ${input.sourceProjectId}
        LIMIT 1
      `;
      const projectId = existingRows[0]?.sharedProjectId
        ? SharedProjectId.make(existingRows[0].sharedProjectId)
        : SharedProjectId.make(newId("sp"));

      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (existingRows.length === 0) {
            yield* sql`
              INSERT INTO shared_projects (
                shared_project_id,
                source_project_id,
                name,
                owner_user_id,
                owner_github_id,
                owner_github_login,
                repo_canonical_key,
                repo_remote_url,
                repo_remote_name,
                default_branch,
                current_branch,
                current_head_sha,
                dirty,
                context_json,
                context_synced_at,
                created_at,
                updated_at
              )
              VALUES (
                ${projectId},
                ${input.sourceProjectId},
                ${input.name},
                ${user.user.userId},
                ${user.user.githubId},
                ${normalizeGitHubLogin(user.user.githubLogin)},
                ${repository.canonicalKey},
                ${repository.remoteUrl},
                ${repository.remoteName},
                ${repository.defaultBranch},
                ${repository.currentBranch},
                ${repository.headSha},
                ${repository.dirty ? 1 : 0},
                ${encodeContextBundleJson(contextBundle)},
                ${contextBundle.syncedAt},
                ${createdAt},
                ${createdAt}
              )
            `;
            yield* insertOwnerRuntime(user, projectId, createdAt);
          } else {
            yield* sql`
              UPDATE shared_projects
              SET
                name = ${input.name},
                repo_canonical_key = ${repository.canonicalKey},
                repo_remote_url = ${repository.remoteUrl},
                repo_remote_name = ${repository.remoteName},
                default_branch = ${repository.defaultBranch},
                current_branch = ${repository.currentBranch},
                current_head_sha = ${repository.headSha},
                dirty = ${repository.dirty ? 1 : 0},
                context_json = ${encodeContextBundleJson(contextBundle)},
                context_synced_at = ${contextBundle.syncedAt},
                updated_at = ${createdAt}
              WHERE shared_project_id = ${projectId}
            `;
          }

          yield* sql`
            INSERT INTO shared_project_members (
              shared_project_id,
              user_id,
              github_id,
              github_login,
              display_name,
              avatar_url,
              role,
              joined_at,
              invited_by_user_id,
              removed_at
            )
            VALUES (
              ${projectId},
              ${user.user.userId},
              ${user.user.githubId},
              ${normalizeGitHubLogin(user.user.githubLogin)},
              ${user.user.displayName},
              ${user.user.avatarUrl},
              'owner',
              ${createdAt},
              NULL,
              NULL
            )
            ON CONFLICT (shared_project_id, user_id)
            DO UPDATE SET
              github_id = excluded.github_id,
              github_login = excluded.github_login,
              display_name = excluded.display_name,
              avatar_url = excluded.avatar_url,
              role = 'owner',
              removed_at = NULL
          `;
        }),
      );

      return yield* loadDetail(user, projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("publish shared project")));

  const getDetail: SharedProjectsShape["getDetail"] = (user, projectId) =>
    loadDetail(user, projectId).pipe(Effect.mapError(asSharedProjectsError("load shared project")));

  const getBootstrapManifest: SharedProjectsShape["getBootstrapManifest"] = (user, projectId) =>
    Effect.gen(function* () {
      const detail = yield* loadDetail(user, projectId);
      return {
        project: detail.project,
        contextBundle: detail.contextBundle,
        threads: detail.threads.filter((thread) => thread.visibility === "shared"),
        runtimes: detail.runtimes,
        environments: detail.environments,
        deploys: detail.deploys,
      } satisfies SharedProjectBootstrapManifest;
    }).pipe(Effect.mapError(asSharedProjectsError("load shared project bootstrap")));

  const syncContext: SharedProjectsShape["syncContext"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can sync shared project context.",
      );
      const repository = yield* resolveRepositoryState(
        processRunner,
        repositoryIdentityResolver,
        input.cwd,
      );
      const contextBundle = yield* buildContextBundle(fileSystem, path, input.cwd);
      yield* sql`
        UPDATE shared_projects
        SET
          repo_canonical_key = ${repository.canonicalKey},
          repo_remote_url = ${repository.remoteUrl},
          repo_remote_name = ${repository.remoteName},
          default_branch = ${repository.defaultBranch},
          current_branch = ${repository.currentBranch},
          current_head_sha = ${repository.headSha},
          dirty = ${repository.dirty ? 1 : 0},
          context_json = ${encodeContextBundleJson(contextBundle)},
          context_synced_at = ${contextBundle.syncedAt},
          updated_at = ${contextBundle.syncedAt}
        WHERE shared_project_id = ${input.projectId}
      `;
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("sync shared project context")));

  const createInvite: SharedProjectsShape["createInvite"] = (user, input) =>
    Effect.gen(function* () {
      if (input.role === "owner") {
        return yield* new SharedProjectsError({
          message: "Invitees cannot be granted owner access with an invite code.",
          status: 400,
        });
      }
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can invite project members.",
      );
      const createdAt = yield* nowIso;
      const expiresAt = yield* futureIso(INVITE_TTL_MS);
      const code = newInviteCode();
      const githubLogin = normalizeGitHubLogin(input.githubLogin);
      yield* sql`
        INSERT INTO shared_project_invites (
          invite_code,
          shared_project_id,
          invited_github_login,
          invited_github_id,
          role,
          invited_by_user_id,
          created_at,
          expires_at,
          claimed_at,
          claimed_by_user_id,
          revoked_at
        )
        VALUES (
          ${code},
          ${input.projectId},
          ${githubLogin},
          ${input.githubId ?? null},
          ${input.role},
          ${user.user.userId},
          ${createdAt},
          ${expiresAt},
          NULL,
          NULL,
          NULL
        )
      `;
      const rows = yield* sql<InviteRow>`
        SELECT
          invite_code AS "inviteCode",
          shared_project_id AS "sharedProjectId",
          invited_github_login AS "invitedGithubLogin",
          invited_github_id AS "invitedGithubId",
          role,
          invited_by_user_id AS "invitedByUserId",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          claimed_at AS "claimedAt",
          claimed_by_user_id AS "claimedByUserId",
          revoked_at AS "revokedAt"
        FROM shared_project_invites
        WHERE invite_code = ${code}
      `;
      return toInvite(rows[0]!, createdAt);
    }).pipe(Effect.mapError(asSharedProjectsError("create shared project invite")));

  const claimInvite: SharedProjectsShape["claimInvite"] = (user, input) =>
    Effect.gen(function* () {
      const rows = yield* sql<InviteRow>`
        SELECT
          invite_code AS "inviteCode",
          shared_project_id AS "sharedProjectId",
          invited_github_login AS "invitedGithubLogin",
          invited_github_id AS "invitedGithubId",
          role,
          invited_by_user_id AS "invitedByUserId",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          claimed_at AS "claimedAt",
          claimed_by_user_id AS "claimedByUserId",
          revoked_at AS "revokedAt"
        FROM shared_project_invites
        WHERE invite_code = ${input.code}
        LIMIT 1
      `;
      const inviteRow = rows[0];
      if (!inviteRow) {
        return yield* new SharedProjectsError({
          message: "Invite code was not found.",
          status: 404,
        });
      }
      const now = yield* nowIso;
      const status = resolveInviteStatus(
        {
          claimedAt: inviteRow.claimedAt,
          revokedAt: inviteRow.revokedAt,
          expiresAt: inviteRow.expiresAt,
        },
        now,
      );
      if (status !== "pending") {
        return yield* new SharedProjectsError({
          message:
            status === "claimed"
              ? "Invite code has already been claimed."
              : status === "expired"
                ? "Invite code has expired."
                : "Invite code has been revoked.",
          status: 409,
        });
      }
      const invitedLogin = normalizeGitHubLogin(inviteRow.invitedGithubLogin);
      const actualLogin = normalizeGitHubLogin(user.user.githubLogin);
      if (
        (inviteRow.invitedGithubId !== null && inviteRow.invitedGithubId !== user.user.githubId) ||
        invitedLogin !== actualLogin
      ) {
        return yield* new SharedProjectsError({
          message: `This invite was created for @${invitedLogin}, but you are signed in as @${actualLogin}.`,
          status: 403,
        });
      }
      const claimedAt = yield* nowIso;
      const projectId = SharedProjectId.make(inviteRow.sharedProjectId);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE shared_project_invites
            SET claimed_at = ${claimedAt},
                claimed_by_user_id = ${user.user.userId}
            WHERE invite_code = ${input.code}
              AND claimed_at IS NULL
              AND revoked_at IS NULL
          `;
          yield* sql`
            INSERT INTO shared_project_members (
              shared_project_id,
              user_id,
              github_id,
              github_login,
              display_name,
              avatar_url,
              role,
              joined_at,
              invited_by_user_id,
              removed_at
            )
            VALUES (
              ${projectId},
              ${user.user.userId},
              ${user.user.githubId},
              ${actualLogin},
              ${user.user.displayName},
              ${user.user.avatarUrl},
              ${inviteRow.role},
              ${claimedAt},
              ${inviteRow.invitedByUserId},
              NULL
            )
            ON CONFLICT (shared_project_id, user_id)
            DO UPDATE SET
              github_id = excluded.github_id,
              github_login = excluded.github_login,
              display_name = excluded.display_name,
              avatar_url = excluded.avatar_url,
              role = excluded.role,
              removed_at = NULL
          `;
        }),
      );
      const detail = yield* loadDetail(user, projectId);
      return {
        project: detail.project,
        bootstrap: {
          project: detail.project,
          contextBundle: detail.contextBundle,
          threads: detail.threads.filter((thread) => thread.visibility === "shared"),
          runtimes: detail.runtimes,
          environments: detail.environments,
          deploys: detail.deploys,
        },
      } satisfies SharedProjectClaimResult;
    }).pipe(Effect.mapError(asSharedProjectsError("claim shared project invite")));

  const updateMemberRole: SharedProjectsShape["updateMemberRole"] = (user, input) =>
    Effect.gen(function* () {
      if (input.role === "owner") {
        return yield* new SharedProjectsError({
          message: "Project ownership transfer is not available here.",
          status: 400,
        });
      }
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can change project roles.",
      );
      const targetRows = yield* sql<{ readonly role: string }>`
        SELECT role
        FROM shared_project_members
        WHERE shared_project_id = ${input.projectId}
          AND user_id = ${input.userId}
          AND removed_at IS NULL
        LIMIT 1
      `;
      if (!targetRows[0]) {
        return yield* new SharedProjectsError({ message: "Member was not found.", status: 404 });
      }
      if (targetRows[0].role === "owner") {
        return yield* new SharedProjectsError({
          message: "The owner role cannot be changed.",
          status: 400,
        });
      }
      yield* sql`
        UPDATE shared_project_members
        SET role = ${input.role}
        WHERE shared_project_id = ${input.projectId}
          AND user_id = ${input.userId}
      `;
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("update shared project member role")));

  const removeMember: SharedProjectsShape["removeMember"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can remove project members.",
      );
      const targetRows = yield* sql<{ readonly role: string }>`
        SELECT role
        FROM shared_project_members
        WHERE shared_project_id = ${input.projectId}
          AND user_id = ${input.userId}
          AND removed_at IS NULL
        LIMIT 1
      `;
      if (!targetRows[0]) {
        return yield* new SharedProjectsError({ message: "Member was not found.", status: 404 });
      }
      if (targetRows[0].role === "owner") {
        return yield* new SharedProjectsError({
          message: "The project owner cannot be removed.",
          status: 400,
        });
      }
      const removedAt = yield* nowIso;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE shared_project_members
            SET removed_at = ${removedAt}
            WHERE shared_project_id = ${input.projectId}
              AND user_id = ${input.userId}
          `;
          yield* sql`
            UPDATE shared_project_invites
            SET revoked_at = ${removedAt}
            WHERE shared_project_id = ${input.projectId}
              AND claimed_by_user_id = ${input.userId}
              AND revoked_at IS NULL
          `;
        }),
      );
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("remove shared project member")));

  const publishThread: SharedProjectsShape["publishThread"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canEditSharedWork,
        "Viewers cannot publish or update shared threads.",
      );
      const existingRows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE shared_project_id = ${input.projectId}
          AND local_thread_id = ${input.localThreadId}
        LIMIT 1
      `;
      const existing = existingRows[0];
      const updatedAt = yield* nowIso;
      const threadId = existing?.sharedThreadId
        ? SharedThreadId.make(existing.sharedThreadId)
        : SharedThreadId.make(newId("st"));
      const messages =
        input.messages ??
        (existing ? decodeJsonOr(decodeThreadMessagesJson, existing.messagesJson, []) : []);
      if (existing) {
        yield* sql`
          UPDATE shared_threads
          SET
            title = ${input.title},
            visibility = ${input.visibility},
            code_state_json = ${encodeThreadCodeStateJson(input.codeState)},
            messages_json = ${encodeThreadMessagesJson(messages)},
            updated_at = ${updatedAt}
          WHERE shared_thread_id = ${threadId}
        `;
      } else {
        yield* sql`
          INSERT INTO shared_threads (
            shared_thread_id,
            shared_project_id,
            local_thread_id,
            created_by_user_id,
            title,
            visibility,
            code_state_json,
            messages_json,
            last_runtime_id,
            created_at,
            updated_at
          )
          VALUES (
            ${threadId},
            ${input.projectId},
            ${input.localThreadId},
            ${user.user.userId},
            ${input.title},
            ${input.visibility},
            ${encodeThreadCodeStateJson(input.codeState)},
            ${encodeThreadMessagesJson(messages)},
            NULL,
            ${updatedAt},
            ${updatedAt}
          )
        `;
      }
      const rows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE shared_thread_id = ${threadId}
      `;
      return toThread(rows[0]!);
    }).pipe(Effect.mapError(asSharedProjectsError("publish shared thread")));

  const updateThreadVisibility: SharedProjectsShape["updateThreadVisibility"] = (user, input) =>
    Effect.gen(function* () {
      const { role } = yield* requireRole(
        user,
        input.projectId,
        canEditSharedWork,
        "Viewers cannot change shared thread visibility.",
      );
      const rows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE shared_project_id = ${input.projectId}
          AND shared_thread_id = ${input.threadId}
        LIMIT 1
      `;
      const thread = rows[0];
      if (!thread) {
        return yield* new SharedProjectsError({
          message: "Shared thread was not found.",
          status: 404,
        });
      }
      if (!roleAtLeast(role, "admin") && thread.createdByUserId !== user.user.userId) {
        return yield* new SharedProjectsError({
          message:
            "Only the thread publisher, project admins, and owners can change this thread visibility.",
          status: 403,
        });
      }
      const updatedAt = yield* nowIso;
      yield* sql`
        UPDATE shared_threads
        SET visibility = ${input.visibility},
            updated_at = ${updatedAt}
        WHERE shared_thread_id = ${input.threadId}
      `;
      return toThread({ ...thread, visibility: input.visibility, updatedAt });
    }).pipe(Effect.mapError(asSharedProjectsError("update shared thread visibility")));

  const appendThreadMessage: SharedProjectsShape["appendThreadMessage"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canEditSharedWork,
        "Viewers cannot continue shared threads.",
      );
      const rows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE shared_project_id = ${input.projectId}
          AND shared_thread_id = ${input.threadId}
        LIMIT 1
      `;
      const thread = rows[0];
      if (!thread) {
        return yield* new SharedProjectsError({
          message: "Shared thread was not found.",
          status: 404,
        });
      }
      const updatedAt = yield* nowIso;
      const messages = decodeJsonOr(decodeThreadMessagesJson, thread.messagesJson, []);
      const nextMessage: SharedThreadMessage = {
        id: newId("msg"),
        role: input.role,
        text: input.text,
        authorGithubLogin: normalizeGitHubLogin(user.user.githubLogin),
        createdAt: updatedAt,
      };
      const nextMessages = [...messages, nextMessage].slice(-500);
      yield* sql`
        UPDATE shared_threads
        SET messages_json = ${encodeThreadMessagesJson(nextMessages)},
            last_runtime_id = ${input.runtimeId ?? thread.lastRuntimeId},
            updated_at = ${updatedAt}
        WHERE shared_thread_id = ${input.threadId}
      `;
      return toThread({
        ...thread,
        messagesJson: encodeThreadMessagesJson(nextMessages),
        lastRuntimeId: input.runtimeId ?? thread.lastRuntimeId,
        updatedAt,
      });
    }).pipe(Effect.mapError(asSharedProjectsError("append shared thread message")));

  const upsertRuntime: SharedProjectsShape["upsertRuntime"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canEditSharedWork,
        "Viewers cannot attach runtimes to a shared project.",
      );
      const createdAt = yield* nowIso;
      const runtimeId = input.runtimeId ?? SharedRuntimeId.make(newId("rt"));
      const existingRows = yield* sql<{ readonly createdAt: string }>`
        SELECT created_at AS "createdAt"
        FROM shared_runtimes
        WHERE runtime_id = ${runtimeId}
          AND shared_project_id = ${input.projectId}
        LIMIT 1
      `;
      const originalCreatedAt = existingRows[0]?.createdAt ?? createdAt;
      yield* sql`
        INSERT INTO shared_runtimes (
          runtime_id,
          shared_project_id,
          runtime_type,
          owner_user_id,
          label,
          endpoint_label,
          health,
          capabilities_json,
          provider_label,
          unavailable_reason,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (
          ${runtimeId},
          ${input.projectId},
          ${input.type},
          ${user.user.userId},
          ${input.label},
          ${input.endpointLabel ?? null},
          ${input.health},
          ${encodeStringArrayJson(input.capabilities)},
          ${input.providerLabel ?? null},
          ${input.unavailableReason ?? null},
          ${createdAt},
          ${originalCreatedAt},
          ${createdAt}
        )
        ON CONFLICT (runtime_id)
        DO UPDATE SET
          runtime_type = excluded.runtime_type,
          label = excluded.label,
          endpoint_label = excluded.endpoint_label,
          health = excluded.health,
          capabilities_json = excluded.capabilities_json,
          provider_label = excluded.provider_label,
          unavailable_reason = excluded.unavailable_reason,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `;
      const rows = yield* sql<RuntimeRow>`
        SELECT
          runtime_id AS "runtimeId",
          shared_project_id AS "sharedProjectId",
          runtime_type AS "runtimeType",
          owner_user_id AS "ownerUserId",
          label,
          endpoint_label AS "endpointLabel",
          health,
          capabilities_json AS "capabilitiesJson",
          provider_label AS "providerLabel",
          unavailable_reason AS "unavailableReason",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_runtimes
        WHERE runtime_id = ${runtimeId}
      `;
      return toRuntime(rows[0]!);
    }).pipe(Effect.mapError(asSharedProjectsError("upsert shared runtime")));

  const upsertEnvironment: SharedProjectsShape["upsertEnvironment"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can change shared project environments.",
      );
      const validationStatus = validateSharedEnvironmentUrl(input.baseUrl);
      const updatedAt = yield* nowIso;
      const environmentId = input.environmentId ?? SharedProjectEnvironmentId.make(newId("env"));
      const existingRows = yield* sql<{ readonly createdAt: string }>`
        SELECT created_at AS "createdAt"
        FROM shared_project_environments
        WHERE environment_id = ${environmentId}
          AND shared_project_id = ${input.projectId}
        LIMIT 1
      `;
      const envCountRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM shared_project_environments
        WHERE shared_project_id = ${input.projectId}
      `;
      const shouldBeDefault = input.isDefault || (envCountRows[0]?.count ?? 0) === 0;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (shouldBeDefault) {
            yield* sql`
              UPDATE shared_project_environments
              SET is_default = 0
              WHERE shared_project_id = ${input.projectId}
            `;
          }
          yield* sql`
            INSERT INTO shared_project_environments (
              environment_id,
              shared_project_id,
              name,
              environment_type,
              base_url,
              is_default,
              validation_status,
              last_validated_at,
              source,
              created_at,
              updated_at
            )
            VALUES (
              ${environmentId},
              ${input.projectId},
              ${input.name},
              ${input.type},
              ${input.baseUrl},
              ${shouldBeDefault ? 1 : 0},
              ${validationStatus},
              ${updatedAt},
              'manual',
              ${existingRows[0]?.createdAt ?? updatedAt},
              ${updatedAt}
            )
            ON CONFLICT (environment_id)
            DO UPDATE SET
              name = excluded.name,
              environment_type = excluded.environment_type,
              base_url = excluded.base_url,
              is_default = excluded.is_default,
              validation_status = excluded.validation_status,
              last_validated_at = excluded.last_validated_at,
              updated_at = excluded.updated_at
          `;
          yield* ensureEnvironmentDefault(input.projectId);
        }),
      );
      const rows = yield* sql<EnvironmentRow>`
        SELECT
          environment_id AS "environmentId",
          shared_project_id AS "sharedProjectId",
          name,
          environment_type AS "environmentType",
          base_url AS "baseUrl",
          is_default AS "isDefault",
          validation_status AS "validationStatus",
          last_validated_at AS "lastValidatedAt",
          source,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_project_environments
        WHERE environment_id = ${environmentId}
      `;
      return toEnvironment(rows[0]!);
    }).pipe(Effect.mapError(asSharedProjectsError("upsert shared environment")));

  const setDefaultEnvironment: SharedProjectsShape["setDefaultEnvironment"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can change the default environment.",
      );
      const exists = yield* sql<{ readonly environmentId: string }>`
        SELECT environment_id AS "environmentId"
        FROM shared_project_environments
        WHERE shared_project_id = ${input.projectId}
          AND environment_id = ${input.environmentId}
        LIMIT 1
      `;
      if (!exists[0]) {
        return yield* new SharedProjectsError({
          message: "Environment was not found.",
          status: 404,
        });
      }
      const updatedAt = yield* nowIso;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE shared_project_environments
            SET is_default = 0
            WHERE shared_project_id = ${input.projectId}
          `;
          yield* sql`
            UPDATE shared_project_environments
            SET is_default = 1,
                updated_at = ${updatedAt}
            WHERE environment_id = ${input.environmentId}
          `;
        }),
      );
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("set shared default environment")));

  const upsertDeployAssociation: SharedProjectsShape["upsertDeployAssociation"] = (user, input) =>
    Effect.gen(function* () {
      const { row } = yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can change branch deploy associations.",
      );
      const envRows = yield* sql<{ readonly environmentId: string }>`
        SELECT environment_id AS "environmentId"
        FROM shared_project_environments
        WHERE shared_project_id = ${input.projectId}
          AND environment_id = ${input.environmentId}
        LIMIT 1
      `;
      if (!envRows[0]) {
        return yield* new SharedProjectsError({
          message: "Environment was not found.",
          status: 404,
        });
      }
      const existingRows = input.deployId
        ? yield* sql<DeployRow>`
            SELECT
              deploy_id AS "deployId",
              shared_project_id AS "sharedProjectId",
              branch,
              environment_id AS "environmentId",
              deploy_url AS "deployUrl",
              deployed_sha AS "deployedSha",
              source,
              last_checked_state AS "lastCheckedState",
              last_checked_at AS "lastCheckedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM shared_deploy_associations
            WHERE deploy_id = ${input.deployId}
              AND shared_project_id = ${input.projectId}
            LIMIT 1
          `
        : yield* sql<DeployRow>`
            SELECT
              deploy_id AS "deployId",
              shared_project_id AS "sharedProjectId",
              branch,
              environment_id AS "environmentId",
              deploy_url AS "deployUrl",
              deployed_sha AS "deployedSha",
              source,
              last_checked_state AS "lastCheckedState",
              last_checked_at AS "lastCheckedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM shared_deploy_associations
            WHERE shared_project_id = ${input.projectId}
              AND branch = ${input.branch}
              AND environment_id = ${input.environmentId}
            LIMIT 1
          `;
      const existing = existingRows[0];
      const deployId =
        input.deployId ??
        (existing
          ? SharedDeployAssociationId.make(existing.deployId)
          : SharedDeployAssociationId.make(newId("dep")));
      const updatedAt = yield* nowIso;
      const state = resolveDeployState({
        currentHeadSha: row.currentHeadSha,
        deployedSha: input.deployedSha ?? null,
      });
      yield* sql`
        INSERT INTO shared_deploy_associations (
          deploy_id,
          shared_project_id,
          branch,
          environment_id,
          deploy_url,
          deployed_sha,
          source,
          last_checked_state,
          last_checked_at,
          created_at,
          updated_at
        )
        VALUES (
          ${deployId},
          ${input.projectId},
          ${input.branch},
          ${input.environmentId},
          ${input.deployUrl},
          ${input.deployedSha ?? null},
          'manual',
          ${state},
          ${updatedAt},
          ${existing?.createdAt ?? updatedAt},
          ${updatedAt}
        )
        ON CONFLICT (deploy_id)
        DO UPDATE SET
          branch = excluded.branch,
          environment_id = excluded.environment_id,
          deploy_url = excluded.deploy_url,
          deployed_sha = excluded.deployed_sha,
          last_checked_state = excluded.last_checked_state,
          last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at
      `;
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("upsert shared deploy association")));

  const syncRemoteRuntime: SharedProjectsShape["syncRemoteRuntime"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can sync remote runtime deploy metadata.",
      );
      const runtimeRows = yield* sql<RuntimeRow>`
        SELECT
          runtime_id AS "runtimeId",
          shared_project_id AS "sharedProjectId",
          runtime_type AS "runtimeType",
          owner_user_id AS "ownerUserId",
          label,
          endpoint_label AS "endpointLabel",
          health,
          capabilities_json AS "capabilitiesJson",
          provider_label AS "providerLabel",
          unavailable_reason AS "unavailableReason",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_runtimes
        WHERE shared_project_id = ${input.projectId}
          AND runtime_type <> 'local'
          AND endpoint_label IS NOT NULL
          AND health = 'healthy'
        ORDER BY updated_at DESC
      `;
      const candidates = runtimeRows
        .map(toRuntime)
        .filter(
          (runtime) =>
            runtime.endpointLabel !== null &&
            validateSharedEnvironmentUrl(runtime.endpointLabel) !== "invalid-url",
        );
      if (candidates.length === 0) {
        return yield* new SharedProjectsError({
          message: "No healthy remote runtime with a valid endpoint was found.",
          status: 404,
        });
      }
      const updatedAt = yield* nowIso;
      yield* sql.withTransaction(
        Effect.forEach(
          candidates,
          (runtime) =>
            Effect.gen(function* () {
              const existing = yield* sql<{ readonly environmentId: string }>`
                SELECT environment_id AS "environmentId"
                FROM shared_project_environments
                WHERE shared_project_id = ${input.projectId}
                  AND base_url = ${runtime.endpointLabel}
                LIMIT 1
              `;
              if (existing[0]) return;
              const envCountRows = yield* sql<{ readonly count: number }>`
                SELECT COUNT(*) AS "count"
                FROM shared_project_environments
                WHERE shared_project_id = ${input.projectId}
              `;
              const isDefault = (envCountRows[0]?.count ?? 0) === 0 ? 1 : 0;
              yield* sql`
                INSERT INTO shared_project_environments (
                  environment_id,
                  shared_project_id,
                  name,
                  environment_type,
                  base_url,
                  is_default,
                  validation_status,
                  last_validated_at,
                  source,
                  created_at,
                  updated_at
                )
                VALUES (
                  ${SharedProjectEnvironmentId.make(newId("env"))},
                  ${input.projectId},
                  ${runtime.type === "ssh-vps" ? "VPS Staging" : runtime.label},
                  ${runtime.type === "ssh-vps" ? "vps-staging" : "preview"},
                  ${runtime.endpointLabel},
                  ${isDefault},
                  'unknown',
                  ${updatedAt},
                  'runtime-sync',
                  ${updatedAt},
                  ${updatedAt}
                )
              `;
            }),
          { concurrency: 1 },
        ),
      );
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("sync shared remote runtime")));

  return {
    listForUser,
    publishLocalProject,
    getDetail,
    getBootstrapManifest,
    syncContext,
    createInvite,
    claimInvite,
    updateMemberRole,
    removeMember,
    publishThread,
    updateThreadVisibility,
    appendThreadMessage,
    upsertRuntime,
    upsertEnvironment,
    setDefaultEnvironment,
    upsertDeployAssociation,
    syncRemoteRuntime,
  } satisfies SharedProjectsShape;
});

export const SharedProjectsLive = Layer.effect(SharedProjects, makeSharedProjects()).pipe(
  Layer.provide(ProcessRunner.layer),
);
