// @effect-diagnostics globalDate:off - standalone non-Effect service; uses wall-clock Date directly.
import type {
  KamiUserId,
  ProjectId,
  SharedContextBundle,
  SharedDeployAssociation,
  SharedDeployAssociationId,
  SharedDeployState,
  SharedEnvironmentType,
  SharedEnvironmentValidationStatus,
  SharedProjectBootstrapManifest,
  SharedProjectClaimResult,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectEnvironmentId,
  SharedProjectId,
  SharedProjectInvite,
  SharedProjectInviteCode,
  SharedProjectListResult,
  SharedProjectMember,
  SharedProjectRole,
  SharedProjectSummary,
  SharedRepositoryState,
  SharedRuntime,
  SharedRuntimeHealth,
  SharedRuntimeId,
  SharedRuntimeType,
  SharedSessionSnapshot,
  SharedThread,
  SharedThreadCodeState,
  SharedThreadId,
  SharedThreadMessage,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import type { Pool } from "pg";

import type { AuthenticatedUser } from "./auth.ts";
import { query, withTransaction, type DbClient } from "./db.ts";
import { HttpError } from "./errors.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface SharedProjectArtifact {
  readonly id: string;
  readonly projectId: SharedProjectId;
  readonly kind: string;
  readonly name: string;
  readonly mediaType: string | null;
  readonly metadata: JsonRecord;
  readonly content: unknown | null;
  readonly uri: string | null;
  readonly createdByUserId: KamiUserId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HostedSharedProjectDetail extends SharedProjectDetail {
  readonly artifacts: readonly SharedProjectArtifact[];
}

export interface HostedSharedProjectBootstrapManifest extends SharedProjectBootstrapManifest {
  readonly artifacts: readonly SharedProjectArtifact[];
}

interface SharedProjectRow {
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
  readonly dirty: boolean;
  readonly contextJson: unknown | null;
  readonly contextSyncedAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface ProjectAccessRow extends SharedProjectRow {
  readonly role: string;
}

interface MemberRow {
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly githubId: string;
  readonly githubLogin: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly role: string;
  readonly joinedAt: Date | string;
  readonly invitedByUserId: string | null;
}

interface InviteRow {
  readonly inviteCode: string;
  readonly sharedProjectId: string;
  readonly invitedGithubLogin: string;
  readonly invitedGithubId: string | null;
  readonly role: string;
  readonly invitedByUserId: string;
  readonly createdAt: Date | string;
  readonly expiresAt: Date | string;
  readonly claimedAt: Date | string | null;
  readonly claimedByUserId: string | null;
  readonly revokedAt: Date | string | null;
}

interface ThreadRow {
  readonly sharedThreadId: string;
  readonly sharedProjectId: string;
  readonly localThreadId: string | null;
  readonly createdByUserId: string;
  readonly title: string;
  readonly visibility: string;
  readonly codeStateJson: unknown;
  readonly messagesJson: unknown;
  readonly sessionSnapshotJson: unknown | null;
  readonly lastRuntimeId: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface RuntimeRow {
  readonly runtimeId: string;
  readonly sharedProjectId: string;
  readonly runtimeType: string;
  readonly ownerUserId: string;
  readonly label: string;
  readonly endpointLabel: string | null;
  readonly health: string;
  readonly capabilitiesJson: unknown;
  readonly providerLabel: string | null;
  readonly unavailableReason: string | null;
  readonly lastSeenAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface EnvironmentRow {
  readonly environmentId: string;
  readonly sharedProjectId: string;
  readonly name: string;
  readonly environmentType: string;
  readonly baseUrl: string;
  readonly isDefault: boolean;
  readonly validationStatus: string;
  readonly lastValidatedAt: Date | string | null;
  readonly source: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface DeployRow {
  readonly deployId: string;
  readonly sharedProjectId: string;
  readonly branch: string;
  readonly environmentId: string;
  readonly deployUrl: string;
  readonly deployedSha: string | null;
  readonly source: string;
  readonly lastCheckedState: string;
  readonly lastCheckedAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

interface ArtifactRow {
  readonly artifactId: string;
  readonly sharedProjectId: string;
  readonly kind: string;
  readonly name: string;
  readonly mediaType: string | null;
  readonly metadataJson: unknown;
  readonly contentJson: unknown | null;
  readonly uri: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

const ROLE_RANK: Record<SharedProjectRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

const emptyRepository: SharedRepositoryState = {
  canonicalKey: null,
  remoteUrl: null,
  remoteName: null,
  defaultBranch: null,
  currentBranch: null,
  headSha: null,
  dirty: false,
};

function nowIso(): string {
  return new Date().toISOString();
}

function futureIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function newId(prefix: string): string {
  return `${prefix}_${NodeCrypto.randomUUID()}`;
}

function newInviteCode(): SharedProjectInviteCode {
  return `spc_${NodeCrypto.randomUUID().replaceAll("-", "").slice(0, 24)}` as SharedProjectInviteCode;
}

function normalizeGitHubLogin(login: string): string {
  return login.trim().replace(/^@/u, "").toLowerCase();
}

function roleFromDb(value: string): SharedProjectRole {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer"
    ? value
    : "viewer";
}

function roleAtLeast(role: SharedProjectRole, minimum: SharedProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function canManageSharedProject(role: SharedProjectRole): boolean {
  return roleAtLeast(role, "admin");
}

function canEditSharedWork(role: SharedProjectRole): boolean {
  return roleAtLeast(role, "member");
}

function validateSharedEnvironmentUrl(url: string): SharedEnvironmentValidationStatus {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid-url";
    return "unknown";
  } catch {
    return "invalid-url";
  }
}

function resolveDeployState(input: {
  readonly currentHeadSha: string | null;
  readonly deployedSha: string | null;
}): SharedDeployState {
  if (!input.currentHeadSha || !input.deployedSha) return "unknown";
  return input.currentHeadSha === input.deployedSha ? "current" : "stale";
}

function resolveInviteStatus(
  invite: Pick<SharedProjectInvite, "claimedAt" | "revokedAt" | "expiresAt">,
  now: string,
): SharedProjectInvite["status"] {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.claimedAt !== null) return "claimed";
  if (invite.expiresAt <= now) return "expired";
  return "pending";
}

function readRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Expected a JSON object request body.");
  }
  return value as JsonRecord;
}

function readString(input: JsonRecord, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing ${key}.`);
  }
  return value.trim();
}

function readOptionalString(input: JsonRecord, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${key} must be a string.`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(input: JsonRecord, key: string): readonly string[] {
  const value = input[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readRepository(input: JsonRecord): SharedRepositoryState {
  const value = input.repository;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyRepository;
  }
  const record = value as JsonRecord;
  return {
    canonicalKey: typeof record.canonicalKey === "string" ? record.canonicalKey : null,
    remoteUrl: typeof record.remoteUrl === "string" ? record.remoteUrl : null,
    remoteName: typeof record.remoteName === "string" ? record.remoteName : null,
    defaultBranch: typeof record.defaultBranch === "string" ? record.defaultBranch : null,
    currentBranch: typeof record.currentBranch === "string" ? record.currentBranch : null,
    headSha: typeof record.headSha === "string" ? record.headSha : null,
    dirty: record.dirty === true,
  };
}

function readContextBundle(input: JsonRecord): SharedContextBundle | null {
  const value = input.contextBundle;
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "contextBundle must be an object when provided.");
  }
  return value as SharedContextBundle;
}

function jsonArray<T>(value: unknown, fallback: readonly T[]): readonly T[] {
  if (Array.isArray(value)) return value as readonly T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as readonly T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function jsonRecord(value: unknown): JsonRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function jsonbParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function toRepositoryState(row: SharedProjectRow): SharedRepositoryState {
  return {
    canonicalKey: row.repoCanonicalKey,
    remoteUrl: row.repoRemoteUrl,
    remoteName: row.repoRemoteName,
    defaultBranch: row.defaultBranch,
    currentBranch: row.currentBranch,
    headSha: row.currentHeadSha,
    dirty: row.dirty,
  };
}

function toProjectSummary(row: ProjectAccessRow): SharedProjectSummary {
  return {
    id: row.sharedProjectId as SharedProjectId,
    sourceProjectId: row.sourceProjectId === null ? null : (row.sourceProjectId as ProjectId),
    name: row.name,
    ownerUserId: row.ownerUserId as KamiUserId,
    ownerGithubLogin: row.ownerGithubLogin,
    role: roleFromDb(row.role),
    repository: toRepositoryState(row),
    contextSyncedAt: iso(row.contextSyncedAt),
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

function toMember(row: MemberRow): SharedProjectMember {
  return {
    projectId: row.sharedProjectId as SharedProjectId,
    userId: row.userId as KamiUserId,
    githubId: row.githubId,
    githubLogin: row.githubLogin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    role: roleFromDb(row.role),
    joinedAt: iso(row.joinedAt) ?? row.joinedAt.toString(),
    invitedByUserId: row.invitedByUserId === null ? null : (row.invitedByUserId as KamiUserId),
  };
}

function toInvite(row: InviteRow, now: string): SharedProjectInvite {
  const invite = {
    code: row.inviteCode as SharedProjectInviteCode,
    projectId: row.sharedProjectId as SharedProjectId,
    githubLogin: row.invitedGithubLogin,
    githubId: row.invitedGithubId,
    role: roleFromDb(row.role),
    invitedByUserId: row.invitedByUserId as KamiUserId,
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    expiresAt: iso(row.expiresAt) ?? row.expiresAt.toString(),
    claimedAt: iso(row.claimedAt),
    claimedByUserId: row.claimedByUserId === null ? null : (row.claimedByUserId as KamiUserId),
    revokedAt: iso(row.revokedAt),
    status: "pending" as const,
  };
  return { ...invite, status: resolveInviteStatus(invite, now) };
}

function toThread(row: ThreadRow): SharedThread {
  return {
    id: row.sharedThreadId as SharedThreadId,
    projectId: row.sharedProjectId as SharedProjectId,
    localThreadId: row.localThreadId === null ? null : (row.localThreadId as ThreadId),
    createdByUserId: row.createdByUserId as KamiUserId,
    title: row.title,
    visibility: row.visibility === "shared" ? "shared" : "private",
    codeState: jsonRecord(row.codeStateJson) as unknown as SharedThreadCodeState,
    messages: jsonArray<SharedThreadMessage>(row.messagesJson, []) as SharedThreadMessage[],
    sessionSnapshot:
      row.sessionSnapshotJson === null
        ? null
        : (jsonRecord(row.sessionSnapshotJson) as unknown as SharedSessionSnapshot),
    lastRuntimeId: row.lastRuntimeId === null ? null : (row.lastRuntimeId as SharedRuntimeId),
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

function toRuntime(row: RuntimeRow): SharedRuntime {
  const type: SharedRuntimeType =
    row.runtimeType === "ssh-vps" || row.runtimeType === "hosted-worker"
      ? row.runtimeType
      : "local";
  const health: SharedRuntimeHealth =
    row.health === "healthy" || row.health === "unavailable" ? row.health : "unknown";
  return {
    id: row.runtimeId as SharedRuntimeId,
    projectId: row.sharedProjectId as SharedProjectId,
    type,
    ownerUserId: row.ownerUserId as KamiUserId,
    label: row.label,
    endpointLabel: row.endpointLabel,
    health,
    capabilities: jsonArray<string>(row.capabilitiesJson, []) as string[],
    providerLabel: row.providerLabel,
    sshCredentialId: null,
    unavailableReason: row.unavailableReason,
    lastSeenAt: iso(row.lastSeenAt),
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

function toEnvironment(row: EnvironmentRow): SharedProjectEnvironment {
  const type: SharedEnvironmentType =
    row.environmentType === "local-dev" ||
    row.environmentType === "preview" ||
    row.environmentType === "vps-staging" ||
    row.environmentType === "production"
      ? row.environmentType
      : "custom";
  const validationStatus: SharedEnvironmentValidationStatus =
    row.validationStatus === "reachable" ||
    row.validationStatus === "unreachable" ||
    row.validationStatus === "invalid-url"
      ? row.validationStatus
      : "unknown";
  return {
    id: row.environmentId as SharedProjectEnvironmentId,
    projectId: row.sharedProjectId as SharedProjectId,
    name: row.name,
    type,
    baseUrl: row.baseUrl,
    isDefault: row.isDefault,
    validationStatus,
    lastValidatedAt: iso(row.lastValidatedAt),
    source: row.source === "runtime-sync" || row.source === "deploy-sync" ? row.source : "manual",
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

function toDeploy(row: DeployRow): SharedDeployAssociation {
  return {
    id: row.deployId as SharedDeployAssociationId,
    projectId: row.sharedProjectId as SharedProjectId,
    branch: row.branch,
    environmentId: row.environmentId as SharedProjectEnvironmentId,
    deployUrl: row.deployUrl,
    deployedSha: row.deployedSha,
    source: row.source === "runtime-sync" || row.source === "deploy-sync" ? row.source : "manual",
    state:
      row.lastCheckedState === "current" || row.lastCheckedState === "stale"
        ? row.lastCheckedState
        : "unknown",
    lastCheckedAt: iso(row.lastCheckedAt),
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

function toArtifact(row: ArtifactRow): SharedProjectArtifact {
  return {
    id: row.artifactId,
    projectId: row.sharedProjectId as SharedProjectId,
    kind: row.kind,
    name: row.name,
    mediaType: row.mediaType,
    metadata: jsonRecord(row.metadataJson),
    content: row.contentJson,
    uri: row.uri,
    createdByUserId: row.createdByUserId as KamiUserId,
    createdAt: iso(row.createdAt) ?? row.createdAt.toString(),
    updatedAt: iso(row.updatedAt) ?? row.updatedAt.toString(),
  };
}

export class SharedProjectsStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listForUser(user: AuthenticatedUser): Promise<SharedProjectListResult> {
    const rows = await query<ProjectAccessRow>(
      this.#pool,
      `
        SELECT ${projectAccessSelect}
        FROM shared_projects p
        JOIN shared_project_members m ON m.shared_project_id = p.shared_project_id
        WHERE (
            m.user_id = $1
            OR m.github_id = $2
            OR LOWER(m.github_login) = $3
          )
          AND m.removed_at IS NULL
        ORDER BY p.updated_at DESC
      `,
      [user.user.userId, user.user.githubId, normalizeGitHubLogin(user.user.githubLogin)],
    );
    return { projects: rows.map(toProjectSummary) };
  }

  async publishLocalProject(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const createdAt = nowIso();
    const sourceProjectId = readOptionalString(input, "sourceProjectId");
    const name = readString(input, "name");
    const repository = readRepository(input);
    const contextBundle = readContextBundle(input);
    const contextSyncedAt = contextBundle?.syncedAt ?? null;

    const existingRows =
      sourceProjectId === null
        ? []
        : await query<{ sharedProjectId: string }>(
            this.#pool,
            `
              SELECT shared_project_id AS "sharedProjectId"
              FROM shared_projects
              WHERE owner_user_id = $1
                AND source_project_id = $2
              LIMIT 1
            `,
            [user.user.userId, sourceProjectId],
          );

    const projectId = (existingRows[0]?.sharedProjectId ?? newId("sp")) as SharedProjectId;

    await withTransaction(this.#pool, async (client) => {
      if (existingRows.length === 0) {
        await query(
          client,
          `
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
          `,
          [
            projectId,
            sourceProjectId,
            name,
            user.user.userId,
            user.user.githubId,
            normalizeGitHubLogin(user.user.githubLogin),
            repository.canonicalKey,
            repository.remoteUrl,
            repository.remoteName,
            repository.defaultBranch,
            repository.currentBranch,
            repository.headSha,
            repository.dirty,
            jsonbParam(contextBundle),
            contextSyncedAt,
            createdAt,
          ],
        );
        await this.#insertOwnerRuntime(client, user, projectId, createdAt);
      } else {
        await query(
          client,
          `
            UPDATE shared_projects
            SET name = $2,
                repo_canonical_key = $3,
                repo_remote_url = $4,
                repo_remote_name = $5,
                default_branch = $6,
                current_branch = $7,
                current_head_sha = $8,
                dirty = $9,
                context_json = $10,
                context_synced_at = $11,
                updated_at = $12
            WHERE shared_project_id = $1
          `,
          [
            projectId,
            name,
            repository.canonicalKey,
            repository.remoteUrl,
            repository.remoteName,
            repository.defaultBranch,
            repository.currentBranch,
            repository.headSha,
            repository.dirty,
            jsonbParam(contextBundle),
            contextSyncedAt,
            createdAt,
          ],
        );
      }

      await this.#upsertMember(client, {
        projectId,
        user,
        role: "owner",
        joinedAt: createdAt,
        invitedByUserId: null,
      });
    });

    return this.getDetail(user, projectId);
  }

  async getDetail(
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ): Promise<HostedSharedProjectDetail> {
    const access = await this.#loadProjectAccess(user, projectId);
    return this.#loadDetailFromAccess(user, access);
  }

  async getBootstrapManifest(
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ): Promise<HostedSharedProjectBootstrapManifest> {
    const detail = await this.getDetail(user, projectId);
    return {
      project: detail.project,
      contextBundle: detail.contextBundle,
      threads: detail.threads.filter((thread) => thread.visibility === "shared"),
      runtimes: detail.runtimes,
      sshCredentials: [],
      environments: detail.environments,
      deploys: detail.deploys,
      artifacts: detail.artifacts,
    };
  }

  async syncContext(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can sync shared project context.",
    );
    const repository = readRepository(input);
    const contextBundle = readContextBundle(input);
    const updatedAt = contextBundle?.syncedAt ?? nowIso();
    await query(
      this.#pool,
      `
        UPDATE shared_projects
        SET repo_canonical_key = $2,
            repo_remote_url = $3,
            repo_remote_name = $4,
            default_branch = $5,
            current_branch = $6,
            current_head_sha = $7,
            dirty = $8,
            context_json = $9,
            context_synced_at = $10,
            updated_at = $11
        WHERE shared_project_id = $1
      `,
      [
        projectId,
        repository.canonicalKey,
        repository.remoteUrl,
        repository.remoteName,
        repository.defaultBranch,
        repository.currentBranch,
        repository.headSha,
        repository.dirty,
        jsonbParam(contextBundle),
        contextBundle?.syncedAt ?? null,
        updatedAt,
      ],
    );
    return this.getDetail(user, projectId);
  }

  async createInvite(user: AuthenticatedUser, rawInput: unknown): Promise<SharedProjectInvite> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const role = readString(input, "role") as SharedProjectRole;
    if (role === "owner") {
      throw new HttpError(400, "Invitees cannot be granted owner access with an invite code.");
    }
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can invite project members.",
    );
    const createdAt = nowIso();
    const expiresAt = futureIso(INVITE_TTL_MS);
    const code = newInviteCode();
    const githubLogin = normalizeGitHubLogin(readString(input, "githubLogin"));
    const githubId = readOptionalString(input, "githubId");

    await query(
      this.#pool,
      `
        INSERT INTO shared_project_invites (
          invite_code,
          shared_project_id,
          invited_github_login,
          invited_github_id,
          role,
          invited_by_user_id,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [code, projectId, githubLogin, githubId, role, user.user.userId, createdAt, expiresAt],
    );

    const rows = await this.#loadInviteRows("WHERE invite_code = $1", [code]);
    return toInvite(rows[0]!, createdAt);
  }

  async claimInvite(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<
    SharedProjectClaimResult & { readonly bootstrap: HostedSharedProjectBootstrapManifest }
  > {
    const input = readRecord(rawInput);
    const code = readString(input, "code") as SharedProjectInviteCode;
    const rows = await this.#loadInviteRows("WHERE invite_code = $1 LIMIT 1", [code]);
    const inviteRow = rows[0];
    if (!inviteRow) throw new HttpError(404, "Invite code was not found.");

    const now = nowIso();
    const status = resolveInviteStatus(
      {
        claimedAt: iso(inviteRow.claimedAt),
        revokedAt: iso(inviteRow.revokedAt),
        expiresAt: iso(inviteRow.expiresAt) ?? inviteRow.expiresAt.toString(),
      },
      now,
    );
    if (status !== "pending") {
      throw new HttpError(
        409,
        status === "claimed"
          ? "Invite code has already been claimed."
          : status === "expired"
            ? "Invite code has expired."
            : "Invite code has been revoked.",
      );
    }

    const invitedLogin = normalizeGitHubLogin(inviteRow.invitedGithubLogin);
    const actualLogin = normalizeGitHubLogin(user.user.githubLogin);
    if (
      (inviteRow.invitedGithubId !== null && inviteRow.invitedGithubId !== user.user.githubId) ||
      invitedLogin !== actualLogin
    ) {
      throw new HttpError(
        403,
        `This invite was created for @${invitedLogin}, but you are signed in as @${actualLogin}.`,
      );
    }

    const claimedAt = nowIso();
    const projectId = inviteRow.sharedProjectId as SharedProjectId;
    await withTransaction(this.#pool, async (client) => {
      await query(
        client,
        `
          UPDATE shared_project_invites
          SET claimed_at = $2,
              claimed_by_user_id = $3
          WHERE invite_code = $1
            AND claimed_at IS NULL
            AND revoked_at IS NULL
        `,
        [code, claimedAt, user.user.userId],
      );
      await this.#upsertMember(client, {
        projectId,
        user,
        role: roleFromDb(inviteRow.role),
        joinedAt: claimedAt,
        invitedByUserId: inviteRow.invitedByUserId,
      });
    });

    const detail = await this.getDetail(user, projectId);
    return {
      project: detail.project,
      bootstrap: {
        project: detail.project,
        contextBundle: detail.contextBundle,
        threads: detail.threads.filter((thread) => thread.visibility === "shared"),
        runtimes: detail.runtimes,
        sshCredentials: [],
        environments: detail.environments,
        deploys: detail.deploys,
        artifacts: detail.artifacts,
      },
    };
  }

  async updateMemberRole(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const targetUserId = readString(input, "userId");
    const role = readString(input, "role") as SharedProjectRole;
    if (role === "owner") throw new HttpError(400, "Project ownership transfer is not available.");
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can change project roles.",
    );
    const rows = await query<{ role: string }>(
      this.#pool,
      `
        SELECT role
        FROM shared_project_members
        WHERE shared_project_id = $1
          AND user_id = $2
          AND removed_at IS NULL
        LIMIT 1
      `,
      [projectId, targetUserId],
    );
    const target = rows[0];
    if (!target) throw new HttpError(404, "Member was not found.");
    if (target.role === "owner") throw new HttpError(400, "The owner role cannot be changed.");
    await query(
      this.#pool,
      "UPDATE shared_project_members SET role = $3 WHERE shared_project_id = $1 AND user_id = $2",
      [projectId, targetUserId, role],
    );
    return this.getDetail(user, projectId);
  }

  async removeMember(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const targetUserId = readString(input, "userId");
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can remove project members.",
    );
    const rows = await query<{ role: string }>(
      this.#pool,
      `
        SELECT role
        FROM shared_project_members
        WHERE shared_project_id = $1
          AND user_id = $2
          AND removed_at IS NULL
        LIMIT 1
      `,
      [projectId, targetUserId],
    );
    const target = rows[0];
    if (!target) throw new HttpError(404, "Member was not found.");
    if (target.role === "owner") throw new HttpError(400, "The project owner cannot be removed.");
    const removedAt = nowIso();
    await withTransaction(this.#pool, async (client) => {
      await query(
        client,
        `
          UPDATE shared_project_members
          SET removed_at = $3
          WHERE shared_project_id = $1
            AND user_id = $2
        `,
        [projectId, targetUserId, removedAt],
      );
      await query(
        client,
        `
          UPDATE shared_project_invites
          SET revoked_at = $3
          WHERE shared_project_id = $1
            AND claimed_by_user_id = $2
            AND revoked_at IS NULL
        `,
        [projectId, targetUserId, removedAt],
      );
    });
    return this.getDetail(user, projectId);
  }

  async deleteProject(user: AuthenticatedUser, rawInput: unknown): Promise<{ readonly ok: true }> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      (role) => role === "owner",
      "Only the project owner can stop sharing this project.",
    );
    await query(
      this.#pool,
      `
        DELETE FROM shared_projects
        WHERE shared_project_id = $1
          AND owner_user_id = $2
      `,
      [projectId, user.user.userId],
    );
    return { ok: true };
  }

  async publishThread(user: AuthenticatedUser, rawInput: unknown): Promise<SharedThread> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canEditSharedWork,
      "Viewers cannot publish shared session snapshots.",
    );
    const localThreadId = readOptionalString(input, "localThreadId");
    const title = readString(input, "title");
    const visibility = readString(input, "visibility") === "private" ? "private" : "shared";
    const codeState =
      typeof input.codeState === "object" && input.codeState !== null
        ? (input.codeState as SharedThreadCodeState)
        : ({
            branch: null,
            headSha: null,
            dirty: false,
            patchAttached: false,
          } satisfies SharedThreadCodeState);
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const updatedAt = nowIso();

    const threadId = newId("st") as SharedThreadId;
    const sessionSnapshot =
      input.sessionSnapshot === null || input.sessionSnapshot === undefined
        ? null
        : jsonRecord(input.sessionSnapshot);

    await query(
      this.#pool,
      `
        INSERT INTO shared_threads (
          shared_thread_id,
          shared_project_id,
          local_thread_id,
          created_by_user_id,
          title,
          visibility,
          code_state_json,
          messages_json,
          session_snapshot_json,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      `,
      [
        threadId,
        projectId,
        localThreadId,
        user.user.userId,
        title,
        visibility,
        jsonbParam(codeState),
        jsonbParam(messages),
        jsonbParam(sessionSnapshot),
        updatedAt,
      ],
    );
    const rows = await this.#loadThreadRows("WHERE shared_thread_id = $1", [threadId]);
    return toThread(rows[0]!);
  }

  async updateThreadVisibility(user: AuthenticatedUser, rawInput: unknown): Promise<SharedThread> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const threadId = readString(input, "threadId") as SharedThreadId;
    const visibility = readString(input, "visibility") === "private" ? "private" : "shared";
    const { role } = await this.#requireRole(
      user,
      projectId,
      canEditSharedWork,
      "Viewers cannot change shared thread visibility.",
    );
    const rows = await this.#loadThreadRows(
      "WHERE shared_project_id = $1 AND shared_thread_id = $2 LIMIT 1",
      [projectId, threadId],
    );
    const thread = rows[0];
    if (!thread) throw new HttpError(404, "Shared thread was not found.");
    if (!roleAtLeast(role, "admin") && thread.createdByUserId !== user.user.userId) {
      throw new HttpError(
        403,
        "Only the thread publisher, project admins, and owners can change this thread visibility.",
      );
    }
    const updatedAt = nowIso();
    await query(
      this.#pool,
      "UPDATE shared_threads SET visibility = $2, updated_at = $3 WHERE shared_thread_id = $1",
      [threadId, visibility, updatedAt],
    );
    return toThread({ ...thread, visibility, updatedAt });
  }

  async appendThreadMessage(_user: AuthenticatedUser, _rawInput: unknown): Promise<SharedThread> {
    throw new HttpError(
      400,
      "Shared sessions are snapshot-only. Import the snapshot locally, continue locally, then create a new snapshot share.",
    );
  }

  async upsertRuntime(user: AuthenticatedUser, rawInput: unknown): Promise<SharedRuntime> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canEditSharedWork,
      "Viewers cannot attach runtimes to a shared project.",
    );
    const updatedAt = nowIso();
    const runtimeId = (readOptionalString(input, "runtimeId") ?? newId("rt")) as SharedRuntimeId;
    const type = readString(input, "type");
    const label = readString(input, "label");
    const endpointLabel = readOptionalString(input, "endpointLabel");
    const health = readString(input, "health");
    const capabilities = readStringArray(input, "capabilities");
    const providerLabel = readOptionalString(input, "providerLabel");
    const unavailableReason = readOptionalString(input, "unavailableReason");
    await query(
      this.#pool,
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11)
        ON CONFLICT (runtime_id)
        DO UPDATE SET runtime_type = excluded.runtime_type,
                      label = excluded.label,
                      endpoint_label = excluded.endpoint_label,
                      health = excluded.health,
                      capabilities_json = excluded.capabilities_json,
                      provider_label = excluded.provider_label,
                      unavailable_reason = excluded.unavailable_reason,
                      last_seen_at = excluded.last_seen_at,
                      updated_at = excluded.updated_at
        WHERE shared_runtimes.shared_project_id = excluded.shared_project_id
      `,
      [
        runtimeId,
        projectId,
        type,
        user.user.userId,
        label,
        endpointLabel,
        health,
        jsonbParam(capabilities),
        providerLabel,
        unavailableReason,
        updatedAt,
      ],
    );
    const rows = await this.#loadRuntimeRows("WHERE runtime_id = $1 AND shared_project_id = $2", [
      runtimeId,
      projectId,
    ]);
    if (!rows[0]) throw new HttpError(409, "Runtime id is already used by another project.");
    return toRuntime(rows[0]!);
  }

  async upsertEnvironment(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<SharedProjectEnvironment> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can change shared project environments.",
    );
    const environmentId = (readOptionalString(input, "environmentId") ??
      newId("env")) as SharedProjectEnvironmentId;
    const name = readString(input, "name");
    const type = readString(input, "type");
    const baseUrl = readString(input, "baseUrl");
    const isDefault = input.isDefault === true;
    const validationStatus = validateSharedEnvironmentUrl(baseUrl);
    const updatedAt = nowIso();
    await withTransaction(this.#pool, async (client) => {
      const countRows = await query<{ count: string }>(
        client,
        "SELECT COUNT(*) AS count FROM shared_project_environments WHERE shared_project_id = $1",
        [projectId],
      );
      const shouldBeDefault = isDefault || Number.parseInt(countRows[0]?.count ?? "0", 10) === 0;
      if (shouldBeDefault) {
        await query(
          client,
          "UPDATE shared_project_environments SET is_default = FALSE WHERE shared_project_id = $1",
          [projectId],
        );
      }
      await query(
        client,
        `
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $8, $8)
          ON CONFLICT (environment_id)
          DO UPDATE SET name = excluded.name,
                        environment_type = excluded.environment_type,
                        base_url = excluded.base_url,
                        is_default = excluded.is_default,
                        validation_status = excluded.validation_status,
                        last_validated_at = excluded.last_validated_at,
                        updated_at = excluded.updated_at
          WHERE shared_project_environments.shared_project_id = excluded.shared_project_id
        `,
        [
          environmentId,
          projectId,
          name,
          type,
          baseUrl,
          shouldBeDefault,
          validationStatus,
          updatedAt,
        ],
      );
      await this.#ensureEnvironmentDefault(client, projectId);
    });
    const rows = await this.#loadEnvironmentRows(
      "WHERE environment_id = $1 AND shared_project_id = $2",
      [environmentId, projectId],
    );
    if (!rows[0]) throw new HttpError(409, "Environment id is already used by another project.");
    return toEnvironment(rows[0]!);
  }

  async setDefaultEnvironment(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const environmentId = readString(input, "environmentId") as SharedProjectEnvironmentId;
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can change the default environment.",
    );
    const exists = await this.#loadEnvironmentRows(
      "WHERE shared_project_id = $1 AND environment_id = $2 LIMIT 1",
      [projectId, environmentId],
    );
    if (!exists[0]) throw new HttpError(404, "Environment was not found.");
    const updatedAt = nowIso();
    await withTransaction(this.#pool, async (client) => {
      await query(
        client,
        "UPDATE shared_project_environments SET is_default = FALSE WHERE shared_project_id = $1",
        [projectId],
      );
      await query(
        client,
        "UPDATE shared_project_environments SET is_default = TRUE, updated_at = $2 WHERE environment_id = $1",
        [environmentId, updatedAt],
      );
    });
    return this.getDetail(user, projectId);
  }

  async upsertDeployAssociation(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    const { row } = await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can change branch deploy associations.",
    );
    const environmentId = readString(input, "environmentId") as SharedProjectEnvironmentId;
    const envRows = await this.#loadEnvironmentRows(
      "WHERE shared_project_id = $1 AND environment_id = $2 LIMIT 1",
      [projectId, environmentId],
    );
    if (!envRows[0]) throw new HttpError(404, "Environment was not found.");
    const branch = readString(input, "branch");
    const deployUrl = readString(input, "deployUrl");
    const deployedSha = readOptionalString(input, "deployedSha");
    const deployId = (readOptionalString(input, "deployId") ??
      newId("dep")) as SharedDeployAssociationId;
    const updatedAt = nowIso();
    const state = resolveDeployState({ currentHeadSha: row.currentHeadSha, deployedSha });
    await query(
      this.#pool,
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $8, $8)
        ON CONFLICT (deploy_id)
        DO UPDATE SET branch = excluded.branch,
                      environment_id = excluded.environment_id,
                      deploy_url = excluded.deploy_url,
                      deployed_sha = excluded.deployed_sha,
                      last_checked_state = excluded.last_checked_state,
                      last_checked_at = excluded.last_checked_at,
                      updated_at = excluded.updated_at
        WHERE shared_deploy_associations.shared_project_id = excluded.shared_project_id
      `,
      [deployId, projectId, branch, environmentId, deployUrl, deployedSha, state, updatedAt],
    );
    const rows = await this.#loadDeployRows("WHERE deploy_id = $1 AND shared_project_id = $2", [
      deployId,
      projectId,
    ]);
    if (!rows[0])
      throw new HttpError(409, "Deploy association id is already used by another project.");
    return this.getDetail(user, projectId);
  }

  async syncRemoteRuntime(
    user: AuthenticatedUser,
    rawInput: unknown,
  ): Promise<HostedSharedProjectDetail> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canManageSharedProject,
      "Only owners and admins can sync remote runtime deploy metadata.",
    );
    const runtimeRows = await this.#loadRuntimeRows(
      `
        WHERE shared_project_id = $1
          AND runtime_type <> 'local'
          AND endpoint_label IS NOT NULL
          AND health = 'healthy'
        ORDER BY updated_at DESC
      `,
      [projectId],
    );
    const candidates = runtimeRows
      .map(toRuntime)
      .filter(
        (runtime) =>
          runtime.endpointLabel !== null &&
          validateSharedEnvironmentUrl(runtime.endpointLabel) !== "invalid-url",
      );
    if (candidates.length === 0) {
      throw new HttpError(404, "No healthy remote runtime with a valid endpoint was found.");
    }
    const updatedAt = nowIso();
    await withTransaction(this.#pool, async (client) => {
      for (const runtime of candidates) {
        const existing = await query<{ environmentId: string }>(
          client,
          `
            SELECT environment_id AS "environmentId"
            FROM shared_project_environments
            WHERE shared_project_id = $1
              AND base_url = $2
            LIMIT 1
          `,
          [projectId, runtime.endpointLabel],
        );
        if (existing[0]) continue;
        const countRows = await query<{ count: string }>(
          client,
          "SELECT COUNT(*) AS count FROM shared_project_environments WHERE shared_project_id = $1",
          [projectId],
        );
        const isDefault = Number.parseInt(countRows[0]?.count ?? "0", 10) === 0;
        await query(
          client,
          `
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
            VALUES ($1, $2, $3, $4, $5, $6, 'unknown', $7, 'runtime-sync', $7, $7)
          `,
          [
            newId("env"),
            projectId,
            runtime.type === "ssh-vps" ? "VPS Staging" : runtime.label,
            runtime.type === "ssh-vps" ? "vps-staging" : "preview",
            runtime.endpointLabel,
            isDefault,
            updatedAt,
          ],
        );
      }
    });
    return this.getDetail(user, projectId);
  }

  async upsertArtifact(user: AuthenticatedUser, rawInput: unknown): Promise<SharedProjectArtifact> {
    const input = readRecord(rawInput);
    const projectId = readString(input, "projectId") as SharedProjectId;
    await this.#requireRole(
      user,
      projectId,
      canEditSharedWork,
      "Viewers cannot publish shared project artifacts.",
    );
    const artifactId = readOptionalString(input, "artifactId") ?? newId("art");
    const kind = readString(input, "kind");
    const name = readString(input, "name");
    const mediaType = readOptionalString(input, "mediaType");
    const metadata = jsonRecord(input.metadata);
    const content = input.content ?? null;
    const uri = readOptionalString(input, "uri");
    const updatedAt = nowIso();
    await query(
      this.#pool,
      `
        INSERT INTO shared_project_artifacts (
          artifact_id,
          shared_project_id,
          kind,
          name,
          media_type,
          metadata_json,
          content_json,
          uri,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        ON CONFLICT (artifact_id)
        DO UPDATE SET kind = excluded.kind,
                      name = excluded.name,
                      media_type = excluded.media_type,
                      metadata_json = excluded.metadata_json,
                      content_json = excluded.content_json,
                      uri = excluded.uri,
                      updated_at = excluded.updated_at
        WHERE shared_project_artifacts.shared_project_id = excluded.shared_project_id
      `,
      [
        artifactId,
        projectId,
        kind,
        name,
        mediaType,
        jsonbParam(metadata),
        jsonbParam(content),
        uri,
        user.user.userId,
        updatedAt,
      ],
    );
    const rows = await this.#loadArtifactRows("WHERE artifact_id = $1 AND shared_project_id = $2", [
      artifactId,
      projectId,
    ]);
    if (!rows[0]) throw new HttpError(409, "Artifact id is already used by another project.");
    return toArtifact(rows[0]!);
  }

  async #loadProjectAccess(
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ): Promise<ProjectAccessRow> {
    const rows = await query<ProjectAccessRow>(
      this.#pool,
      `
        SELECT ${projectAccessSelect}
        FROM shared_projects p
        JOIN shared_project_members m ON m.shared_project_id = p.shared_project_id
        WHERE p.shared_project_id = $1
          AND (
            m.user_id = $2
            OR m.github_id = $3
            OR LOWER(m.github_login) = $4
          )
          AND m.removed_at IS NULL
        LIMIT 1
      `,
      [
        projectId,
        user.user.userId,
        user.user.githubId,
        normalizeGitHubLogin(user.user.githubLogin),
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new HttpError(
        404,
        "Shared project was not found or is not available to this GitHub account.",
      );
    }
    return row;
  }

  async #requireRole(
    user: AuthenticatedUser,
    projectId: SharedProjectId,
    predicate: (role: SharedProjectRole) => boolean,
    message: string,
  ): Promise<{ readonly row: ProjectAccessRow; readonly role: SharedProjectRole }> {
    const row = await this.#loadProjectAccess(user, projectId);
    const role = roleFromDb(row.role);
    if (!predicate(role)) throw new HttpError(403, message);
    return { row, role };
  }

  async #loadDetailFromAccess(
    user: AuthenticatedUser,
    access: ProjectAccessRow,
  ): Promise<HostedSharedProjectDetail> {
    const projectId = access.sharedProjectId as SharedProjectId;
    const role = roleFromDb(access.role);
    const [
      memberRows,
      inviteRows,
      threadRows,
      runtimeRows,
      environmentRows,
      deployRows,
      artifactRows,
    ] = await Promise.all([
      this.#loadMemberRows(projectId),
      canManageSharedProject(role)
        ? this.#loadInviteRows("WHERE shared_project_id = $1 ORDER BY created_at DESC", [projectId])
        : Promise.resolve([]),
      this.#loadThreadRows("WHERE shared_project_id = $1 ORDER BY updated_at DESC", [projectId]),
      this.#loadRuntimeRows("WHERE shared_project_id = $1 ORDER BY created_at ASC", [projectId]),
      this.#loadEnvironmentRows(
        "WHERE shared_project_id = $1 ORDER BY is_default DESC, created_at ASC",
        [projectId],
      ),
      this.#loadDeployRows("WHERE shared_project_id = $1 ORDER BY updated_at DESC", [projectId]),
      this.#loadArtifactRows("WHERE shared_project_id = $1 ORDER BY updated_at DESC", [projectId]),
    ]);
    const now = nowIso();
    const canSeePrivateThreads = roleAtLeast(role, "admin");
    return {
      project: toProjectSummary(access),
      contextBundle:
        access.contextJson === null ? null : (access.contextJson as SharedContextBundle),
      members: memberRows.map(toMember),
      invites: inviteRows.map((row) => toInvite(row, now)),
      threads: threadRows
        .map(toThread)
        .filter(
          (thread) =>
            thread.visibility === "shared" ||
            canSeePrivateThreads ||
            thread.createdByUserId === user.user.userId,
        ),
      runtimes: runtimeRows.map(toRuntime),
      sshCredentials: [],
      environments: environmentRows.map(toEnvironment),
      deploys: deployRows.map(toDeploy),
      artifacts: artifactRows.map(toArtifact),
    };
  }

  async #insertOwnerRuntime(
    client: DbClient,
    user: AuthenticatedUser,
    projectId: SharedProjectId,
    createdAt: string,
  ): Promise<void> {
    await query(
      client,
      `
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
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'local', $3, 'Local desktop', 'This device', 'healthy', $4, $5, $6, $6, $6)
      `,
      [
        newId("rt"),
        projectId,
        user.user.userId,
        jsonbParam(["execute", "test", "sync"]),
        "User-local provider profile",
        createdAt,
      ],
    );
  }

  async #upsertMember(
    client: DbClient,
    input: {
      readonly projectId: SharedProjectId;
      readonly user: AuthenticatedUser;
      readonly role: SharedProjectRole;
      readonly joinedAt: string;
      readonly invitedByUserId: string | null;
    },
  ): Promise<void> {
    await query(
      client,
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
        ON CONFLICT (shared_project_id, user_id)
        DO UPDATE SET github_id = excluded.github_id,
                      github_login = excluded.github_login,
                      display_name = excluded.display_name,
                      avatar_url = excluded.avatar_url,
                      role = excluded.role,
                      removed_at = NULL
      `,
      [
        input.projectId,
        input.user.user.userId,
        input.user.user.githubId,
        normalizeGitHubLogin(input.user.user.githubLogin),
        input.user.user.displayName,
        input.user.user.avatarUrl,
        input.role,
        input.joinedAt,
        input.invitedByUserId,
      ],
    );
  }

  async #ensureEnvironmentDefault(client: DbClient, projectId: SharedProjectId): Promise<void> {
    const defaultRows = await query<{ environmentId: string }>(
      client,
      `
        SELECT environment_id AS "environmentId"
        FROM shared_project_environments
        WHERE shared_project_id = $1
          AND is_default = TRUE
        LIMIT 1
      `,
      [projectId],
    );
    if (defaultRows.length > 0) return;
    const firstRows = await query<{ environmentId: string }>(
      client,
      `
        SELECT environment_id AS "environmentId"
        FROM shared_project_environments
        WHERE shared_project_id = $1
        ORDER BY created_at ASC, environment_id ASC
        LIMIT 1
      `,
      [projectId],
    );
    const first = firstRows[0];
    if (!first) return;
    await query(
      client,
      "UPDATE shared_project_environments SET is_default = TRUE WHERE environment_id = $1",
      [first.environmentId],
    );
  }

  async #loadMemberRows(projectId: SharedProjectId): Promise<MemberRow[]> {
    return query<MemberRow>(
      this.#pool,
      `
        SELECT shared_project_id AS "sharedProjectId",
               user_id AS "userId",
               github_id AS "githubId",
               github_login AS "githubLogin",
               display_name AS "displayName",
               avatar_url AS "avatarUrl",
               role,
               joined_at AS "joinedAt",
               invited_by_user_id AS "invitedByUserId"
        FROM shared_project_members
        WHERE shared_project_id = $1
          AND removed_at IS NULL
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                 github_login ASC
      `,
      [projectId],
    );
  }

  async #loadInviteRows(whereSql: string, values: readonly unknown[]): Promise<InviteRow[]> {
    return query<InviteRow>(
      this.#pool,
      `
        SELECT invite_code AS "inviteCode",
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
        ${whereSql}
      `,
      values,
    );
  }

  async #loadThreadRows(whereSql: string, values: readonly unknown[]): Promise<ThreadRow[]> {
    return query<ThreadRow>(
      this.#pool,
      `
        SELECT shared_thread_id AS "sharedThreadId",
               shared_project_id AS "sharedProjectId",
               local_thread_id AS "localThreadId",
               created_by_user_id AS "createdByUserId",
               title,
               visibility,
               code_state_json AS "codeStateJson",
               messages_json AS "messagesJson",
               session_snapshot_json AS "sessionSnapshotJson",
               last_runtime_id AS "lastRuntimeId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"
        FROM shared_threads
        ${whereSql}
      `,
      values,
    );
  }

  async #loadRuntimeRows(whereSql: string, values: readonly unknown[]): Promise<RuntimeRow[]> {
    return query<RuntimeRow>(
      this.#pool,
      `
        SELECT runtime_id AS "runtimeId",
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
        ${whereSql}
      `,
      values,
    );
  }

  async #loadEnvironmentRows(
    whereSql: string,
    values: readonly unknown[],
  ): Promise<EnvironmentRow[]> {
    return query<EnvironmentRow>(
      this.#pool,
      `
        SELECT environment_id AS "environmentId",
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
        ${whereSql}
      `,
      values,
    );
  }

  async #loadDeployRows(whereSql: string, values: readonly unknown[]): Promise<DeployRow[]> {
    return query<DeployRow>(
      this.#pool,
      `
        SELECT deploy_id AS "deployId",
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
        ${whereSql}
      `,
      values,
    );
  }

  async #loadArtifactRows(whereSql: string, values: readonly unknown[]): Promise<ArtifactRow[]> {
    return query<ArtifactRow>(
      this.#pool,
      `
        SELECT artifact_id AS "artifactId",
               shared_project_id AS "sharedProjectId",
               kind,
               name,
               media_type AS "mediaType",
               metadata_json AS "metadataJson",
               content_json AS "contentJson",
               uri,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"
        FROM shared_project_artifacts
        ${whereSql}
      `,
      values,
    );
  }
}

const projectAccessSelect = `
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
`;
