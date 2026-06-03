import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { KamiUser, KamiUserId } from "./userAuth.ts";

export const SharedProjectId = TrimmedNonEmptyString.pipe(Schema.brand("SharedProjectId"));
export type SharedProjectId = typeof SharedProjectId.Type;

export const SharedProjectInviteCode = TrimmedNonEmptyString.pipe(
  Schema.brand("SharedProjectInviteCode"),
);
export type SharedProjectInviteCode = typeof SharedProjectInviteCode.Type;

export const SharedThreadId = TrimmedNonEmptyString.pipe(Schema.brand("SharedThreadId"));
export type SharedThreadId = typeof SharedThreadId.Type;

export const SharedRuntimeId = TrimmedNonEmptyString.pipe(Schema.brand("SharedRuntimeId"));
export type SharedRuntimeId = typeof SharedRuntimeId.Type;

export const SharedProjectEnvironmentId = TrimmedNonEmptyString.pipe(
  Schema.brand("SharedProjectEnvironmentId"),
);
export type SharedProjectEnvironmentId = typeof SharedProjectEnvironmentId.Type;

export const SharedDeployAssociationId = TrimmedNonEmptyString.pipe(
  Schema.brand("SharedDeployAssociationId"),
);
export type SharedDeployAssociationId = typeof SharedDeployAssociationId.Type;

export const SharedProjectRole = Schema.Literals(["owner", "admin", "member", "viewer"]);
export type SharedProjectRole = typeof SharedProjectRole.Type;

export const SharedProjectInviteStatus = Schema.Literals([
  "pending",
  "claimed",
  "expired",
  "revoked",
]);
export type SharedProjectInviteStatus = typeof SharedProjectInviteStatus.Type;

export const SharedThreadVisibility = Schema.Literals(["private", "shared"]);
export type SharedThreadVisibility = typeof SharedThreadVisibility.Type;

export const SharedRuntimeType = Schema.Literals(["local", "ssh-vps", "hosted-worker"]);
export type SharedRuntimeType = typeof SharedRuntimeType.Type;

export const SharedRuntimeHealth = Schema.Literals(["healthy", "unavailable", "unknown"]);
export type SharedRuntimeHealth = typeof SharedRuntimeHealth.Type;

export const SharedEnvironmentType = Schema.Literals([
  "local-dev",
  "preview",
  "vps-staging",
  "production",
  "custom",
]);
export type SharedEnvironmentType = typeof SharedEnvironmentType.Type;

export const SharedEnvironmentValidationStatus = Schema.Literals([
  "unknown",
  "reachable",
  "unreachable",
  "invalid-url",
]);
export type SharedEnvironmentValidationStatus = typeof SharedEnvironmentValidationStatus.Type;

export const SharedDeployState = Schema.Literals(["current", "stale", "unknown"]);
export type SharedDeployState = typeof SharedDeployState.Type;

export const SharedRepositoryState = Schema.Struct({
  canonicalKey: Schema.NullOr(Schema.String),
  remoteUrl: Schema.NullOr(Schema.String),
  remoteName: Schema.NullOr(Schema.String),
  defaultBranch: Schema.NullOr(Schema.String),
  currentBranch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
});
export type SharedRepositoryState = typeof SharedRepositoryState.Type;

export const SharedContextInstruction = Schema.Struct({
  path: TrimmedNonEmptyString,
  content: Schema.String,
});
export type SharedContextInstruction = typeof SharedContextInstruction.Type;

export const SharedContextScript = Schema.Struct({
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
});
export type SharedContextScript = typeof SharedContextScript.Type;

export const SharedContextEnvironmentVariable = Schema.Struct({
  file: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type SharedContextEnvironmentVariable = typeof SharedContextEnvironmentVariable.Type;

export const SharedContextBundle = Schema.Struct({
  syncedAt: IsoDateTime,
  includedCategories: Schema.Array(TrimmedNonEmptyString),
  excludedCategories: Schema.Array(TrimmedNonEmptyString),
  projectMemory: Schema.NullOr(Schema.String),
  instructions: Schema.Array(SharedContextInstruction),
  packageManager: Schema.NullOr(TrimmedNonEmptyString),
  scripts: Schema.Array(SharedContextScript),
  environmentVariables: Schema.Array(SharedContextEnvironmentVariable),
});
export type SharedContextBundle = typeof SharedContextBundle.Type;

export const SharedProjectMember = Schema.Struct({
  projectId: SharedProjectId,
  userId: KamiUserId,
  githubId: TrimmedNonEmptyString,
  githubLogin: TrimmedNonEmptyString,
  displayName: Schema.NullOr(TrimmedNonEmptyString),
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
  role: SharedProjectRole,
  joinedAt: IsoDateTime,
  invitedByUserId: Schema.NullOr(KamiUserId),
});
export type SharedProjectMember = typeof SharedProjectMember.Type;

export const SharedProjectInvite = Schema.Struct({
  code: SharedProjectInviteCode,
  projectId: SharedProjectId,
  githubLogin: TrimmedNonEmptyString,
  githubId: Schema.NullOr(TrimmedNonEmptyString),
  role: SharedProjectRole,
  invitedByUserId: KamiUserId,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  claimedAt: Schema.NullOr(IsoDateTime),
  claimedByUserId: Schema.NullOr(KamiUserId),
  revokedAt: Schema.NullOr(IsoDateTime),
  status: SharedProjectInviteStatus,
});
export type SharedProjectInvite = typeof SharedProjectInvite.Type;

export const SharedProjectSummary = Schema.Struct({
  id: SharedProjectId,
  sourceProjectId: Schema.NullOr(ProjectId),
  name: TrimmedNonEmptyString,
  ownerUserId: KamiUserId,
  ownerGithubLogin: TrimmedNonEmptyString,
  role: SharedProjectRole,
  repository: SharedRepositoryState,
  contextSyncedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedProjectSummary = typeof SharedProjectSummary.Type;

export const SharedThreadMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  authorGithubLogin: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type SharedThreadMessage = typeof SharedThreadMessage.Type;

export const SharedThreadCodeState = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
  patchAttached: Schema.Boolean,
});
export type SharedThreadCodeState = typeof SharedThreadCodeState.Type;

export const SharedThread = Schema.Struct({
  id: SharedThreadId,
  projectId: SharedProjectId,
  localThreadId: Schema.NullOr(ThreadId),
  createdByUserId: KamiUserId,
  title: TrimmedNonEmptyString,
  visibility: SharedThreadVisibility,
  codeState: SharedThreadCodeState,
  messages: Schema.Array(SharedThreadMessage),
  lastRuntimeId: Schema.NullOr(SharedRuntimeId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedThread = typeof SharedThread.Type;

export const SharedRuntime = Schema.Struct({
  id: SharedRuntimeId,
  projectId: SharedProjectId,
  type: SharedRuntimeType,
  ownerUserId: KamiUserId,
  label: TrimmedNonEmptyString,
  endpointLabel: Schema.NullOr(TrimmedNonEmptyString),
  health: SharedRuntimeHealth,
  capabilities: Schema.Array(TrimmedNonEmptyString),
  providerLabel: Schema.NullOr(TrimmedNonEmptyString),
  unavailableReason: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedRuntime = typeof SharedRuntime.Type;

export const SharedProjectEnvironment = Schema.Struct({
  id: SharedProjectEnvironmentId,
  projectId: SharedProjectId,
  name: TrimmedNonEmptyString,
  type: SharedEnvironmentType,
  baseUrl: TrimmedNonEmptyString,
  isDefault: Schema.Boolean,
  validationStatus: SharedEnvironmentValidationStatus,
  lastValidatedAt: Schema.NullOr(IsoDateTime),
  source: Schema.Literals(["manual", "runtime-sync", "deploy-sync"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedProjectEnvironment = typeof SharedProjectEnvironment.Type;

export const SharedDeployAssociation = Schema.Struct({
  id: SharedDeployAssociationId,
  projectId: SharedProjectId,
  branch: TrimmedNonEmptyString,
  environmentId: SharedProjectEnvironmentId,
  deployUrl: TrimmedNonEmptyString,
  deployedSha: Schema.NullOr(TrimmedNonEmptyString),
  source: Schema.Literals(["manual", "runtime-sync", "deploy-sync"]),
  state: SharedDeployState,
  lastCheckedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedDeployAssociation = typeof SharedDeployAssociation.Type;

export const SharedProjectDetail = Schema.Struct({
  project: SharedProjectSummary,
  contextBundle: Schema.NullOr(SharedContextBundle),
  members: Schema.Array(SharedProjectMember),
  invites: Schema.Array(SharedProjectInvite),
  threads: Schema.Array(SharedThread),
  runtimes: Schema.Array(SharedRuntime),
  environments: Schema.Array(SharedProjectEnvironment),
  deploys: Schema.Array(SharedDeployAssociation),
});
export type SharedProjectDetail = typeof SharedProjectDetail.Type;

export const SharedProjectBootstrapManifest = Schema.Struct({
  project: SharedProjectSummary,
  contextBundle: Schema.NullOr(SharedContextBundle),
  threads: Schema.Array(SharedThread),
  runtimes: Schema.Array(SharedRuntime),
  environments: Schema.Array(SharedProjectEnvironment),
  deploys: Schema.Array(SharedDeployAssociation),
});
export type SharedProjectBootstrapManifest = typeof SharedProjectBootstrapManifest.Type;

export const PublishLocalProjectInput = Schema.Struct({
  sourceProjectId: ProjectId,
  name: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
});
export type PublishLocalProjectInput = typeof PublishLocalProjectInput.Type;

export const SyncSharedProjectContextInput = Schema.Struct({
  projectId: SharedProjectId,
  cwd: TrimmedNonEmptyString,
});
export type SyncSharedProjectContextInput = typeof SyncSharedProjectContextInput.Type;

export const CreateSharedProjectInviteInput = Schema.Struct({
  projectId: SharedProjectId,
  githubLogin: TrimmedNonEmptyString,
  githubId: Schema.optional(TrimmedNonEmptyString),
  role: SharedProjectRole,
});
export type CreateSharedProjectInviteInput = typeof CreateSharedProjectInviteInput.Type;

export const ClaimSharedProjectInviteInput = Schema.Struct({
  code: SharedProjectInviteCode,
});
export type ClaimSharedProjectInviteInput = typeof ClaimSharedProjectInviteInput.Type;

export const UpdateSharedProjectMemberRoleInput = Schema.Struct({
  projectId: SharedProjectId,
  userId: KamiUserId,
  role: SharedProjectRole,
});
export type UpdateSharedProjectMemberRoleInput = typeof UpdateSharedProjectMemberRoleInput.Type;

export const RemoveSharedProjectMemberInput = Schema.Struct({
  projectId: SharedProjectId,
  userId: KamiUserId,
});
export type RemoveSharedProjectMemberInput = typeof RemoveSharedProjectMemberInput.Type;

export const PublishSharedThreadInput = Schema.Struct({
  projectId: SharedProjectId,
  localThreadId: ThreadId,
  title: TrimmedNonEmptyString,
  visibility: SharedThreadVisibility,
  codeState: SharedThreadCodeState,
  messages: Schema.optional(Schema.Array(SharedThreadMessage)),
});
export type PublishSharedThreadInput = typeof PublishSharedThreadInput.Type;

export const UpdateSharedThreadVisibilityInput = Schema.Struct({
  projectId: SharedProjectId,
  threadId: SharedThreadId,
  visibility: SharedThreadVisibility,
});
export type UpdateSharedThreadVisibilityInput = typeof UpdateSharedThreadVisibilityInput.Type;

export const AppendSharedThreadMessageInput = Schema.Struct({
  projectId: SharedProjectId,
  threadId: SharedThreadId,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  runtimeId: Schema.optional(SharedRuntimeId),
});
export type AppendSharedThreadMessageInput = typeof AppendSharedThreadMessageInput.Type;

export const UpsertSharedRuntimeInput = Schema.Struct({
  projectId: SharedProjectId,
  runtimeId: Schema.optional(SharedRuntimeId),
  type: SharedRuntimeType,
  label: TrimmedNonEmptyString,
  endpointLabel: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  health: SharedRuntimeHealth,
  capabilities: Schema.Array(TrimmedNonEmptyString),
  providerLabel: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  unavailableReason: Schema.optional(Schema.NullOr(Schema.String)),
});
export type UpsertSharedRuntimeInput = typeof UpsertSharedRuntimeInput.Type;

export const UpsertSharedEnvironmentInput = Schema.Struct({
  projectId: SharedProjectId,
  environmentId: Schema.optional(SharedProjectEnvironmentId),
  name: TrimmedNonEmptyString,
  type: SharedEnvironmentType,
  baseUrl: TrimmedNonEmptyString,
  isDefault: Schema.Boolean,
});
export type UpsertSharedEnvironmentInput = typeof UpsertSharedEnvironmentInput.Type;

export const SetSharedDefaultEnvironmentInput = Schema.Struct({
  projectId: SharedProjectId,
  environmentId: SharedProjectEnvironmentId,
});
export type SetSharedDefaultEnvironmentInput = typeof SetSharedDefaultEnvironmentInput.Type;

export const UpsertSharedDeployAssociationInput = Schema.Struct({
  projectId: SharedProjectId,
  deployId: Schema.optional(SharedDeployAssociationId),
  branch: TrimmedNonEmptyString,
  environmentId: SharedProjectEnvironmentId,
  deployUrl: TrimmedNonEmptyString,
  deployedSha: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type UpsertSharedDeployAssociationInput = typeof UpsertSharedDeployAssociationInput.Type;

export const SyncSharedRemoteRuntimeInput = Schema.Struct({
  projectId: SharedProjectId,
});
export type SyncSharedRemoteRuntimeInput = typeof SyncSharedRemoteRuntimeInput.Type;

export const SharedProjectListResult = Schema.Struct({
  projects: Schema.Array(SharedProjectSummary),
});
export type SharedProjectListResult = typeof SharedProjectListResult.Type;

export const SharedProjectClaimResult = Schema.Struct({
  project: SharedProjectSummary,
  bootstrap: SharedProjectBootstrapManifest,
});
export type SharedProjectClaimResult = typeof SharedProjectClaimResult.Type;

export const SharedProjectCurrentUser = Schema.Struct({
  user: KamiUser,
});
export type SharedProjectCurrentUser = typeof SharedProjectCurrentUser.Type;
