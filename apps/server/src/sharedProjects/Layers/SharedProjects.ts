import {
  ChatAttachment as ChatAttachmentSchema,
  CheckpointRef,
  CommandId,
  EventId,
  KamiUserId,
  MessageId,
  ModelSelection as ModelSelectionSchema,
  OrchestrationCheckpointFile as OrchestrationCheckpointFileSchema,
  OrchestrationProposedPlan as OrchestrationProposedPlanSchema,
  ProjectId,
  ProviderInteractionMode as ProviderInteractionModeSchema,
  RuntimeMode as RuntimeModeSchema,
  SharedContextBundle as SharedContextBundleSchema,
  SharedSessionSnapshot as SharedSessionSnapshotSchema,
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
  SharedSshCredentialId,
  SharedThreadId,
  SharedThreadVisibility,
  type ImportSharedThreadLinkInput,
  type ResolveSharedThreadShareInput,
  type ResolvedSharedThreadShare,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointStatus,
  type OrchestrationCommand,
  type OrchestrationProposedPlan,
  type OrchestrationThreadActivityTone,
  type ProviderInteractionMode,
  type RuntimeMode,
  type SharedContextBundle,
  type SharedDeployAssociation,
  type ImportSharedThreadResult,
  type ChatAttachment,
  type SharedProjectBootstrapManifest,
  type SharedProjectClaimResult,
  type SharedProjectDetail,
  type SharedProjectEnvironment,
  type SharedProjectInvite,
  type SharedProjectListResult,
  type SharedProjectMember,
  type SharedProjectSshCredential,
  type SharedProjectSummary,
  type SharedRepositoryState,
  type SharedRuntime,
  type SharedSessionSnapshot,
  type SharedSshAuthType,
  type SharedThread,
  type UpsertSharedSshCredentialInput,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import type { AuthenticatedUser } from "../../userAuth/Services/UserAuth.ts";
import { importSharedThreadSnapshot } from "../importSharedThreadSnapshot.ts";
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
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = NodeCrypto;
const MAX_CONTEXT_FILE_BYTES = 40_000;
const MAX_CONTEXT_ITEMS = 80;
const SSH_SECRET_KEY_NAME = "shared-project-ssh-credentials";
const SSH_SECRET_KEY_BYTES = 32;
const SSH_SECRET_ALGORITHM = "aes-256-gcm";
const IMPORTED_SHARED_SESSION_TITLE_PREFIX = "Imported: ";

const ContextBundleJson = Schema.fromJsonString(SharedContextBundleSchema);
const ThreadCodeStateJson = Schema.fromJsonString(SharedThreadCodeStateSchema);
const ThreadMessagesJson = Schema.fromJsonString(Schema.Array(SharedThreadMessageSchema));
const SessionSnapshotJson = Schema.fromJsonString(SharedSessionSnapshotSchema);
const StringArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));
const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    scripts: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const SshCredentialSecretJson = Schema.fromJsonString(
  Schema.Struct({
    password: Schema.NullOr(Schema.String),
    privateKey: Schema.NullOr(Schema.String),
    passphrase: Schema.NullOr(Schema.String),
  }),
);
const SshSecretEnvelopeJson = Schema.fromJsonString(
  Schema.Struct({
    v: Schema.Literal(1),
    alg: Schema.Literal(SSH_SECRET_ALGORITHM),
    iv: Schema.String,
    tag: Schema.String,
    data: Schema.String,
  }),
);

const encodeContextBundleJson = Schema.encodeSync(ContextBundleJson);
const decodeContextBundleJson = Schema.decodeUnknownSync(ContextBundleJson);
const encodeThreadCodeStateJson = Schema.encodeSync(ThreadCodeStateJson);
const decodeThreadCodeStateJson = Schema.decodeUnknownSync(ThreadCodeStateJson);
const encodeThreadMessagesJson = Schema.encodeSync(ThreadMessagesJson);
const decodeThreadMessagesJson = Schema.decodeUnknownSync(ThreadMessagesJson);
const encodeSessionSnapshotJson = Schema.encodeSync(SessionSnapshotJson);
const decodeSessionSnapshotJson = Schema.decodeUnknownSync(SessionSnapshotJson);
const encodeStringArrayJson = Schema.encodeSync(StringArrayJson);
const decodeStringArrayJson = Schema.decodeUnknownSync(StringArrayJson);
const decodePackageJson = Schema.decodeUnknownSync(PackageJson);
const encodeSshSecretJson = Schema.encodeSync(SshCredentialSecretJson);
const encodeSshEnvelopeJson = Schema.encodeSync(SshSecretEnvelopeJson);
const decodeChatAttachment = Schema.decodeUnknownSync(ChatAttachmentSchema);
const decodeModelSelection = Schema.decodeUnknownSync(ModelSelectionSchema);
const decodeProviderInteractionMode = Schema.decodeUnknownSync(ProviderInteractionModeSchema);
const decodeRuntimeMode = Schema.decodeUnknownSync(RuntimeModeSchema);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownSync(OrchestrationProposedPlanSchema);
const decodeOrchestrationCheckpointFile = Schema.decodeUnknownSync(
  OrchestrationCheckpointFileSchema,
);

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
  readonly shareCode: string | null;
  readonly allowedGithubLoginsJson: string;
  readonly codeStateJson: string;
  readonly messagesJson: string;
  readonly sessionSnapshotJson: string | null;
  readonly lastRuntimeId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

function newShareCode(): string {
  return `share_${randomUUID().replace(/-/gu, "")}`;
}

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
  readonly sshCredentialId: string | null;
  readonly unavailableReason: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SshCredentialRow = {
  readonly sshCredentialId: string;
  readonly sharedProjectId: string;
  readonly label: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authType: string;
  readonly encryptedSecretJson: string;
  readonly secretUpdatedAt: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
};

type SshCredentialSecret = {
  readonly password: string | null;
  readonly privateKey: string | null;
  readonly passphrase: string | null;
};

type SshSecretEnvelope = {
  readonly v: 1;
  readonly alg: typeof SSH_SECRET_ALGORITHM;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
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

function sshAuthTypeFromDb(value: string): SharedSshAuthType {
  return value === "password" || value === "private-key" ? value : "agent";
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

function decodeUnknownOrNull<T>(decode: (value: unknown) => T, value: unknown): T | null {
  try {
    return decode(value);
  } catch {
    return null;
  }
}

function newCommandId(scope: string): CommandId {
  return CommandId.make(`shared-import:${scope}:${randomUUID()}`);
}

function newLocalThreadId(): ThreadId {
  return ThreadId.make(randomUUID());
}

function newLocalMessageId(): MessageId {
  return MessageId.make(randomUUID());
}

function newLocalEventId(): EventId {
  return EventId.make(randomUUID());
}

function importThreadTitle(title: string): string {
  const trimmed = title.trim();
  return `${IMPORTED_SHARED_SESSION_TITLE_PREFIX}${trimmed.length > 0 ? trimmed : "shared session"}`;
}

function runtimeModeOrDefault(value: unknown): RuntimeMode {
  return decodeUnknownOrNull(decodeRuntimeMode, value) ?? "full-access";
}

function interactionModeOrDefault(value: unknown): ProviderInteractionMode {
  return decodeUnknownOrNull(decodeProviderInteractionMode, value) ?? "default";
}

function activityToneOrDefault(value: string): OrchestrationThreadActivityTone {
  return value === "info" || value === "tool" || value === "approval" || value === "error"
    ? value
    : "info";
}

function checkpointStatusOrDefault(value: string): OrchestrationCheckpointStatus {
  return value === "ready" || value === "missing" || value === "error" ? value : "missing";
}

function nonNegativeNumber(value: unknown): OrchestrationCheckpointFile["additions"] {
  return (
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  ) as OrchestrationCheckpointFile["additions"];
}

function normalizeCheckpointFile(value: unknown): OrchestrationCheckpointFile | null {
  const decoded = decodeUnknownOrNull(decodeOrchestrationCheckpointFile, value);
  if (decoded) {
    return decoded;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (path.length === 0) {
    return null;
  }
  const kind =
    typeof record.kind === "string" && record.kind.trim().length > 0
      ? record.kind.trim()
      : "modified";
  return {
    path,
    kind,
    additions: nonNegativeNumber(record.additions),
    deletions: nonNegativeNumber(record.deletions),
  };
}

function normalizeMessageAttachment(value: unknown): ChatAttachment | null {
  return decodeUnknownOrNull(decodeChatAttachment, value);
}

function decodeImportedProposedPlan(value: unknown): OrchestrationProposedPlan | null {
  const decoded = decodeUnknownOrNull(decodeOrchestrationProposedPlan, value);
  if (!decoded) {
    return null;
  }
  return {
    ...decoded,
    id: newId("imported_plan"),
    implementationThreadId: null,
  };
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
    shareCode: row.shareCode,
    allowedGithubLogins: decodeJsonOr(decodeStringArrayJson, row.allowedGithubLoginsJson, []),
    codeState: decodeJsonOr(decodeThreadCodeStateJson, row.codeStateJson, {
      branch: null,
      headSha: null,
      dirty: false,
      patchAttached: false,
    }),
    messages: decodeJsonOr(decodeThreadMessagesJson, row.messagesJson, []),
    sessionSnapshot: row.sessionSnapshotJson
      ? decodeJsonOr<SharedSessionSnapshot | null>(
          decodeSessionSnapshotJson,
          row.sessionSnapshotJson,
          null,
        )
      : null,
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
    sshCredentialId:
      row.sshCredentialId === null ? null : SharedSshCredentialId.make(row.sshCredentialId),
    unavailableReason: row.unavailableReason,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSshCredential(
  row: SshCredentialRow,
  secret: SshCredentialSecret,
): SharedProjectSshCredential {
  return {
    id: SharedSshCredentialId.make(row.sshCredentialId),
    projectId: SharedProjectId.make(row.sharedProjectId),
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: sshAuthTypeFromDb(row.authType),
    secretState: {
      hasPassword: secret.password !== null,
      hasPrivateKey: secret.privateKey !== null,
      hasPassphrase: secret.passphrase !== null,
    },
    createdByUserId: KamiUserId.make(row.createdByUserId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    secretUpdatedAt: row.secretUpdatedAt,
    lastUsedAt: row.lastUsedAt,
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

function normalizeSecretValue(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return value.trim().length > 0 ? value : null;
}

function parseSshSecret(value: string): SshCredentialSecret {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid SSH credential secret payload.");
  }
  const record = parsed as Record<string, unknown>;
  return {
    password: typeof record.password === "string" ? record.password : null,
    privateKey: typeof record.privateKey === "string" ? record.privateKey : null,
    passphrase: typeof record.passphrase === "string" ? record.passphrase : null,
  };
}

function parseSshEnvelope(value: string): SshSecretEnvelope {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid SSH credential envelope.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== 1 ||
    record.alg !== SSH_SECRET_ALGORITHM ||
    typeof record.iv !== "string" ||
    typeof record.tag !== "string" ||
    typeof record.data !== "string"
  ) {
    throw new Error("Unsupported SSH credential envelope.");
  }
  return record as SshSecretEnvelope;
}

function encryptionKeyBuffer(key: Uint8Array): Buffer {
  if (key.byteLength !== SSH_SECRET_KEY_BYTES) {
    throw new Error("SSH credential encryption key has invalid length.");
  }
  return Buffer.from(key);
}

function encryptSshSecret(
  secret: SshCredentialSecret,
  key: Uint8Array,
): Effect.Effect<string, SharedProjectsError> {
  return Effect.try({
    try: () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv(SSH_SECRET_ALGORITHM, encryptionKeyBuffer(key), iv);
      const encrypted = Buffer.concat([
        cipher.update(encodeSshSecretJson(secret), "utf8"),
        cipher.final(),
      ]);
      return encodeSshEnvelopeJson({
        v: 1,
        alg: SSH_SECRET_ALGORITHM,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: encrypted.toString("base64"),
      } satisfies SshSecretEnvelope);
    },
    catch: (cause) =>
      new SharedProjectsError({
        message: "Failed to encrypt SSH credential.",
        status: 500,
        cause,
      }),
  });
}

function decryptSshSecret(
  encryptedSecretJson: string,
  key: Uint8Array,
): Effect.Effect<SshCredentialSecret, SharedProjectsError> {
  return Effect.try({
    try: () => {
      const envelope = parseSshEnvelope(encryptedSecretJson);
      const decipher = createDecipheriv(
        SSH_SECRET_ALGORITHM,
        encryptionKeyBuffer(key),
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return parseSshSecret(decrypted);
    },
    catch: (cause) =>
      new SharedProjectsError({
        message: "Failed to decrypt SSH credential metadata.",
        status: 500,
        cause,
      }),
  });
}

function isSshSecretEqual(left: SshCredentialSecret, right: SshCredentialSecret): boolean {
  return (
    left.password === right.password &&
    left.privateKey === right.privateKey &&
    left.passphrase === right.passphrase
  );
}

function buildSshSecret(
  input: UpsertSharedSshCredentialInput,
  existing: SshCredentialSecret | null,
): Effect.Effect<SshCredentialSecret, SharedProjectsError> {
  const existingSecret = existing ?? { password: null, privateKey: null, passphrase: null };
  if (input.authType === "agent") {
    return Effect.succeed({ password: null, privateKey: null, passphrase: null });
  }
  if (input.authType === "password") {
    const password = normalizeSecretValue(input.password, existingSecret.password);
    if (password === null) {
      return Effect.fail(
        new SharedProjectsError({
          message: "Password authentication requires a password before saving.",
          status: 400,
        }),
      );
    }
    return Effect.succeed({ password, privateKey: null, passphrase: null });
  }

  const privateKey = normalizeSecretValue(input.privateKey, existingSecret.privateKey);
  if (privateKey === null) {
    return Effect.fail(
      new SharedProjectsError({
        message: "Private key authentication requires a private key before saving.",
        status: 400,
      }),
    );
  }
  return Effect.succeed({
    password: null,
    privateKey,
    passphrase: normalizeSecretValue(input.passphrase, existingSecret.passphrase),
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
  processRunner: ProcessRunner.ProcessRunner["Service"],
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cwd, ...args],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);
  if (result._tag === "None" || result.value.code !== 0) return null;
  const value = result.value.stdout.trim();
  return value.length > 0 ? value : null;
});

const resolveRepositoryState = Effect.fn("SharedProjects.resolveRepositoryState")(function* (
  processRunner: ProcessRunner.ProcessRunner["Service"],
  repositoryIdentityResolver: RepositoryIdentityResolver["Service"],
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
  const secretStore = yield* ServerSecretStore;
  const sshEncryptionKey = yield* secretStore.getOrCreateRandom(
    SSH_SECRET_KEY_NAME,
    SSH_SECRET_KEY_BYTES,
  );

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
    const [
      memberRows,
      inviteRows,
      threadRows,
      runtimeRows,
      sshCredentialRows,
      environmentRows,
      deployRows,
    ] = yield* Effect.all([
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
            share_code AS "shareCode",
            allowed_github_logins_json AS "allowedGithubLoginsJson",
            code_state_json AS "codeStateJson",
            messages_json AS "messagesJson",
            session_snapshot_json AS "sessionSnapshotJson",
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
            ssh_credential_id AS "sshCredentialId",
            unavailable_reason AS "unavailableReason",
            last_seen_at AS "lastSeenAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM shared_runtimes
          WHERE shared_project_id = ${projectId}
          ORDER BY created_at ASC
        `,
      sql<SshCredentialRow>`
          SELECT
            ssh_credential_id AS "sshCredentialId",
            shared_project_id AS "sharedProjectId",
            label,
            host,
            port,
            username,
            auth_type AS "authType",
            encrypted_secret_json AS "encryptedSecretJson",
            secret_updated_at AS "secretUpdatedAt",
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            last_used_at AS "lastUsedAt"
          FROM shared_project_ssh_credentials
          WHERE shared_project_id = ${projectId}
          ORDER BY updated_at DESC
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
    const sshCredentials = yield* Effect.forEach(
      sshCredentialRows,
      (row) =>
        decryptSshSecret(row.encryptedSecretJson, sshEncryptionKey).pipe(
          Effect.map((secret) => toSshCredential(row, secret)),
        ),
      { concurrency: 1 },
    );
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
      sshCredentials,
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
        ${encodeStringArrayJson(["execute", "test"])},
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
        sshCredentials: detail.sshCredentials,
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
          sshCredentials: detail.sshCredentials,
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

  const deleteProject: SharedProjectsShape["deleteProject"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        (role) => role === "owner",
        "Only the project owner can stop sharing this project.",
      );
      yield* sql`
        DELETE FROM shared_projects
        WHERE shared_project_id = ${input.projectId}
          AND owner_user_id = ${user.user.userId}
      `;
      return { ok: true } as const;
    }).pipe(Effect.mapError(asSharedProjectsError("delete shared project")));

  const publishThread: SharedProjectsShape["publishThread"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canEditSharedWork,
        "Viewers cannot publish shared session snapshots.",
      );
      const updatedAt = yield* nowIso;
      const existingRows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          share_code AS "shareCode",
          allowed_github_logins_json AS "allowedGithubLoginsJson",
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          session_snapshot_json AS "sessionSnapshotJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE shared_project_id = ${input.projectId}
          AND local_thread_id = ${input.localThreadId}
        LIMIT 1
      `;
      const existingThread = existingRows[0] ?? null;
      const threadId = existingThread
        ? SharedThreadId.make(existingThread.sharedThreadId)
        : SharedThreadId.make(newId("st"));
      const messages = input.messages ?? [];
      const sessionSnapshot = input.sessionSnapshot ?? null;
      const normalizedGithubLogins = Array.from(
        new Set((input.allowedGithubLogins ?? []).map((login) => normalizeGitHubLogin(login))),
      );
      if (existingThread) {
        yield* sql`
          UPDATE shared_threads
          SET title = ${input.title},
              visibility = ${input.visibility},
              allowed_github_logins_json = ${encodeStringArrayJson(normalizedGithubLogins)},
              code_state_json = ${encodeThreadCodeStateJson(input.codeState)},
              messages_json = ${encodeThreadMessagesJson(messages)},
              session_snapshot_json = ${sessionSnapshot === null ? null : encodeSessionSnapshotJson(sessionSnapshot)},
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
            share_code,
            allowed_github_logins_json,
            code_state_json,
            messages_json,
            session_snapshot_json,
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
            ${newShareCode()},
            ${encodeStringArrayJson(normalizedGithubLogins)},
            ${encodeThreadCodeStateJson(input.codeState)},
            ${encodeThreadMessagesJson(messages)},
            ${sessionSnapshot === null ? null : encodeSessionSnapshotJson(sessionSnapshot)},
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
          share_code AS "shareCode",
          allowed_github_logins_json AS "allowedGithubLoginsJson",
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          session_snapshot_json AS "sessionSnapshotJson",
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
          share_code AS "shareCode",
          allowed_github_logins_json AS "allowedGithubLoginsJson",
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          session_snapshot_json AS "sessionSnapshotJson",
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

  const importThread: SharedProjectsShape["importThread"] = (user, input) =>
    Effect.gen(function* () {
      const access = yield* loadProjectAccess(user, input.projectId);
      const role = roleFromDb(access.role);
      const rows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          share_code AS "shareCode",
          allowed_github_logins_json AS "allowedGithubLoginsJson",
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          session_snapshot_json AS "sessionSnapshotJson",
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
      if (
        thread.visibility !== "shared" &&
        !roleAtLeast(role, "admin") &&
        thread.createdByUserId !== user.user.userId
      ) {
        return yield* new SharedProjectsError({
          message: "This shared session is private.",
          status: 403,
        });
      }
      const snapshot = thread.sessionSnapshotJson
        ? decodeJsonOr<SharedSessionSnapshot | null>(
            decodeSessionSnapshotJson,
            thread.sessionSnapshotJson,
            null,
          )
        : null;
      if (!snapshot) {
        return yield* new SharedProjectsError({
          message: "This shared session does not have an importable snapshot yet.",
          status: 400,
        });
      }
      return yield* importSharedThreadSnapshot({
        request: input,
        title: thread.title,
        snapshot,
        sourceSharedThreadId: input.threadId,
      });
    }).pipe(Effect.mapError(asSharedProjectsError("import shared thread")));

  const resolveSharedThreadShare: SharedProjectsShape["resolveSharedThreadShare"] = (
    user,
    shareCode,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<ThreadRow>`
        SELECT
          shared_thread_id AS "sharedThreadId",
          shared_project_id AS "sharedProjectId",
          local_thread_id AS "localThreadId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          share_code AS "shareCode",
          allowed_github_logins_json AS "allowedGithubLoginsJson",
          code_state_json AS "codeStateJson",
          messages_json AS "messagesJson",
          session_snapshot_json AS "sessionSnapshotJson",
          last_runtime_id AS "lastRuntimeId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_threads
        WHERE share_code = ${shareCode}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        return yield* new SharedProjectsError({
          message: "Shared session link was not found.",
          status: 404,
        });
      }
      const thread = toThread(row);
      if (
        thread.allowedGithubLogins.length > 0 &&
        !thread.allowedGithubLogins.includes(normalizeGitHubLogin(user.user.githubLogin))
      ) {
        return yield* new SharedProjectsError({
          message: "This shared session link is not available to your GitHub account.",
          status: 403,
        });
      }
      if (thread.visibility !== "shared" && thread.createdByUserId !== user.user.userId) {
        return yield* new SharedProjectsError({
          message: "This shared session is private.",
          status: 403,
        });
      }
      return {
        projectId: thread.projectId,
        thread,
      } satisfies ResolvedSharedThreadShare;
    }).pipe(Effect.mapError(asSharedProjectsError("resolve shared thread link")));

  const importThreadFromLink: SharedProjectsShape["importThreadFromLink"] = (user, input) =>
    Effect.gen(function* () {
      const resolved = yield* resolveSharedThreadShare(user, input.shareCode);
      if (!resolved.thread.sessionSnapshot) {
        return yield* new SharedProjectsError({
          message: "This shared session does not have an importable snapshot yet.",
          status: 400,
        });
      }
      return yield* importSharedThreadSnapshot({
        request: {
          projectId: resolved.projectId,
          threadId: resolved.thread.id,
          targetProjectId: input.targetProjectId,
        },
        title: resolved.thread.title,
        snapshot: resolved.thread.sessionSnapshot,
        sourceSharedThreadId: resolved.thread.id,
        targetProjectCwd: input.targetProjectCwd,
      });
    }).pipe(Effect.mapError(asSharedProjectsError("import shared thread link")));

  const appendThreadMessage: SharedProjectsShape["appendThreadMessage"] = () =>
    Effect.fail(
      new SharedProjectsError({
        message:
          "Shared sessions are snapshot-only. Import the snapshot locally, continue locally, then create a new snapshot share.",
        status: 400,
      }),
    );

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
      if (input.sshCredentialId !== undefined && input.sshCredentialId !== null) {
        if (input.type !== "ssh-vps") {
          return yield* new SharedProjectsError({
            message: "SSH credentials can only be attached to SSH/VPS runtimes.",
            status: 400,
          });
        }
        const credentialRows = yield* sql<{ readonly sshCredentialId: string }>`
          SELECT ssh_credential_id AS "sshCredentialId"
          FROM shared_project_ssh_credentials
          WHERE shared_project_id = ${input.projectId}
            AND ssh_credential_id = ${input.sshCredentialId}
          LIMIT 1
        `;
        if (!credentialRows[0]) {
          return yield* new SharedProjectsError({
            message: "SSH credential was not found.",
            status: 404,
          });
        }
      }
      const existingRows = yield* sql<{
        readonly sharedProjectId: string;
        readonly createdAt: string;
      }>`
        SELECT shared_project_id AS "sharedProjectId",
               created_at AS "createdAt"
        FROM shared_runtimes
        WHERE runtime_id = ${runtimeId}
        LIMIT 1
      `;
      const existing = existingRows[0];
      if (existing && existing.sharedProjectId !== input.projectId) {
        return yield* new SharedProjectsError({
          message: "Runtime id is already used by another shared project.",
          status: 409,
        });
      }
      const originalCreatedAt = existing?.createdAt ?? createdAt;
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
          ssh_credential_id,
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
          ${input.sshCredentialId ?? null},
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
          ssh_credential_id = excluded.ssh_credential_id,
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
          ssh_credential_id AS "sshCredentialId",
          unavailable_reason AS "unavailableReason",
          last_seen_at AS "lastSeenAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM shared_runtimes
        WHERE runtime_id = ${runtimeId}
      `;
      return toRuntime(rows[0]!);
    }).pipe(Effect.mapError(asSharedProjectsError("upsert shared runtime")));

  const upsertSshCredential: SharedProjectsShape["upsertSshCredential"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can manage shared SSH credentials.",
      );
      const updatedAt = yield* nowIso;
      const credentialId = input.credentialId ?? SharedSshCredentialId.make(newId("ssh"));
      const existingRows = yield* sql<SshCredentialRow>`
        SELECT
          ssh_credential_id AS "sshCredentialId",
          shared_project_id AS "sharedProjectId",
          label,
          host,
          port,
          username,
          auth_type AS "authType",
          encrypted_secret_json AS "encryptedSecretJson",
          secret_updated_at AS "secretUpdatedAt",
          created_by_user_id AS "createdByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_used_at AS "lastUsedAt"
        FROM shared_project_ssh_credentials
        WHERE shared_project_id = ${input.projectId}
          AND ssh_credential_id = ${credentialId}
        LIMIT 1
      `;
      const existing = existingRows[0] ?? null;
      const existingSecret =
        existing === null
          ? null
          : yield* decryptSshSecret(existing.encryptedSecretJson, sshEncryptionKey);
      const nextSecret = yield* buildSshSecret(input, existingSecret);
      const secretChanged =
        existingSecret === null || !isSshSecretEqual(existingSecret, nextSecret);
      const encryptedSecretJson = secretChanged
        ? yield* encryptSshSecret(nextSecret, sshEncryptionKey)
        : existing!.encryptedSecretJson;
      const secretUpdatedAt = secretChanged ? updatedAt : existing!.secretUpdatedAt;

      yield* sql`
        INSERT INTO shared_project_ssh_credentials (
          ssh_credential_id,
          shared_project_id,
          label,
          host,
          port,
          username,
          auth_type,
          encrypted_secret_json,
          secret_updated_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES (
          ${credentialId},
          ${input.projectId},
          ${input.label},
          ${input.host},
          ${input.port},
          ${input.username},
          ${input.authType},
          ${encryptedSecretJson},
          ${secretUpdatedAt},
          ${user.user.userId},
          ${existing?.createdAt ?? updatedAt},
          ${updatedAt}
        )
        ON CONFLICT (ssh_credential_id)
        DO UPDATE SET
          label = excluded.label,
          host = excluded.host,
          port = excluded.port,
          username = excluded.username,
          auth_type = excluded.auth_type,
          encrypted_secret_json = excluded.encrypted_secret_json,
          secret_updated_at = excluded.secret_updated_at,
          updated_at = excluded.updated_at
        WHERE shared_project_ssh_credentials.shared_project_id = excluded.shared_project_id
      `;
      const rows = yield* sql<SshCredentialRow>`
        SELECT
          ssh_credential_id AS "sshCredentialId",
          shared_project_id AS "sharedProjectId",
          label,
          host,
          port,
          username,
          auth_type AS "authType",
          encrypted_secret_json AS "encryptedSecretJson",
          secret_updated_at AS "secretUpdatedAt",
          created_by_user_id AS "createdByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_used_at AS "lastUsedAt"
        FROM shared_project_ssh_credentials
        WHERE shared_project_id = ${input.projectId}
          AND ssh_credential_id = ${credentialId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        return yield* new SharedProjectsError({
          message: "SSH credential id is already used by another shared project.",
          status: 409,
        });
      }
      const secret = yield* decryptSshSecret(row.encryptedSecretJson, sshEncryptionKey);
      return toSshCredential(row, secret);
    }).pipe(Effect.mapError(asSharedProjectsError("save shared SSH credential")));

  const removeSshCredential: SharedProjectsShape["removeSshCredential"] = (user, input) =>
    Effect.gen(function* () {
      yield* requireRole(
        user,
        input.projectId,
        canManageSharedProject,
        "Only owners and admins can remove shared SSH credentials.",
      );
      const credentialRows = yield* sql<{ readonly sshCredentialId: string }>`
        SELECT ssh_credential_id AS "sshCredentialId"
        FROM shared_project_ssh_credentials
        WHERE shared_project_id = ${input.projectId}
          AND ssh_credential_id = ${input.credentialId}
        LIMIT 1
      `;
      if (!credentialRows[0]) {
        return yield* new SharedProjectsError({
          message: "SSH credential was not found.",
          status: 404,
        });
      }
      const runtimeRows = yield* sql<{ readonly runtimeId: string }>`
        SELECT runtime_id AS "runtimeId"
        FROM shared_runtimes
        WHERE shared_project_id = ${input.projectId}
          AND ssh_credential_id = ${input.credentialId}
        LIMIT 1
      `;
      if (runtimeRows[0]) {
        return yield* new SharedProjectsError({
          message: "This SSH credential is still attached to a runtime.",
          status: 409,
        });
      }
      yield* sql`
        DELETE FROM shared_project_ssh_credentials
        WHERE shared_project_id = ${input.projectId}
          AND ssh_credential_id = ${input.credentialId}
      `;
      return yield* loadDetail(user, input.projectId);
    }).pipe(Effect.mapError(asSharedProjectsError("remove shared SSH credential")));

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
          ssh_credential_id AS "sshCredentialId",
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
    deleteProject,
    publishThread,
    updateThreadVisibility,
    importThread,
    importThreadFromLink,
    resolveSharedThreadShare,
    appendThreadMessage,
    upsertRuntime,
    upsertSshCredential,
    removeSshCredential,
    upsertEnvironment,
    setDefaultEnvironment,
    upsertDeployAssociation,
    syncRemoteRuntime,
  } satisfies SharedProjectsShape;
});

export const SharedProjectsLive = Layer.effect(SharedProjects, makeSharedProjects()).pipe(
  Layer.provide(ProcessRunner.layer),
);
