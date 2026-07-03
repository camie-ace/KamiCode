import type {
  AppendSharedThreadMessageInput,
  ClaimSharedProjectInviteInput,
  CreateSharedProjectInviteInput,
  DeleteSharedProjectInput,
  DeleteSharedProjectResult,
  ImportSharedThreadInput,
  ImportSharedThreadLinkInput,
  ImportSharedThreadResult,
  PublishLocalProjectInput,
  PublishSharedThreadInput,
  RemoveSharedProjectMemberInput,
  RemoveSharedSshCredentialInput,
  SetSharedDefaultEnvironmentInput,
  SharedProjectBootstrapManifest,
  SharedProjectClaimResult,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectId,
  SharedProjectInvite,
  SharedProjectListResult,
  ResolvedSharedThreadShare,
  SharedProjectSshCredential,
  SharedProjectSummary,
  SharedRuntime,
  SharedThread,
  SyncSharedProjectContextInput,
  SyncSharedRemoteRuntimeInput,
  UpdateSharedProjectMemberRoleInput,
  UpdateSharedThreadVisibilityInput,
  UpsertSharedDeployAssociationInput,
  UpsertSharedEnvironmentInput,
  UpsertSharedRuntimeInput,
  UpsertSharedSshCredentialInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type * as ProcessRunner from "../../processRunner.ts";
import type { AuthenticatedUser } from "../../userAuth/Services/UserAuth.ts";

export class SharedProjectsError extends Data.TaggedError("SharedProjectsError")<{
  readonly message: string;
  readonly status?: 400 | 401 | 403 | 404 | 409 | 500;
  readonly cause?: unknown;
}> {}

export interface SharedProjectsShape {
  readonly listForUser: (
    user: AuthenticatedUser,
  ) => Effect.Effect<SharedProjectListResult, SharedProjectsError>;
  readonly publishLocalProject: (
    user: AuthenticatedUser,
    input: PublishLocalProjectInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly getDetail: (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly getBootstrapManifest: (
    user: AuthenticatedUser,
    projectId: SharedProjectId,
  ) => Effect.Effect<SharedProjectBootstrapManifest, SharedProjectsError>;
  readonly syncContext: (
    user: AuthenticatedUser,
    input: SyncSharedProjectContextInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly createInvite: (
    user: AuthenticatedUser,
    input: CreateSharedProjectInviteInput,
  ) => Effect.Effect<SharedProjectInvite, SharedProjectsError>;
  readonly claimInvite: (
    user: AuthenticatedUser,
    input: ClaimSharedProjectInviteInput,
  ) => Effect.Effect<SharedProjectClaimResult, SharedProjectsError>;
  readonly updateMemberRole: (
    user: AuthenticatedUser,
    input: UpdateSharedProjectMemberRoleInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly removeMember: (
    user: AuthenticatedUser,
    input: RemoveSharedProjectMemberInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly deleteProject: (
    user: AuthenticatedUser,
    input: DeleteSharedProjectInput,
  ) => Effect.Effect<DeleteSharedProjectResult, SharedProjectsError>;
  readonly publishThread: (
    user: AuthenticatedUser,
    input: PublishSharedThreadInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly updateThreadVisibility: (
    user: AuthenticatedUser,
    input: UpdateSharedThreadVisibilityInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly importThread: (
    user: AuthenticatedUser,
    input: ImportSharedThreadInput,
  ) => Effect.Effect<
    ImportSharedThreadResult,
    SharedProjectsError,
    OrchestrationEngineService | ProcessRunner.ProcessRunner
  >;
  readonly importThreadFromLink: (
    user: AuthenticatedUser,
    input: ImportSharedThreadLinkInput,
  ) => Effect.Effect<
    ImportSharedThreadResult,
    SharedProjectsError,
    OrchestrationEngineService | ProcessRunner.ProcessRunner
  >;
  readonly resolveSharedThreadShare: (
    user: AuthenticatedUser,
    shareCode: string,
  ) => Effect.Effect<ResolvedSharedThreadShare, SharedProjectsError>;
  readonly appendThreadMessage: (
    user: AuthenticatedUser,
    input: AppendSharedThreadMessageInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly upsertRuntime: (
    user: AuthenticatedUser,
    input: UpsertSharedRuntimeInput,
  ) => Effect.Effect<SharedRuntime, SharedProjectsError>;
  readonly upsertSshCredential: (
    user: AuthenticatedUser,
    input: UpsertSharedSshCredentialInput,
  ) => Effect.Effect<SharedProjectSshCredential, SharedProjectsError>;
  readonly removeSshCredential: (
    user: AuthenticatedUser,
    input: RemoveSharedSshCredentialInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly upsertEnvironment: (
    user: AuthenticatedUser,
    input: UpsertSharedEnvironmentInput,
  ) => Effect.Effect<SharedProjectEnvironment, SharedProjectsError>;
  readonly setDefaultEnvironment: (
    user: AuthenticatedUser,
    input: SetSharedDefaultEnvironmentInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly upsertDeployAssociation: (
    user: AuthenticatedUser,
    input: UpsertSharedDeployAssociationInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
  readonly syncRemoteRuntime: (
    user: AuthenticatedUser,
    input: SyncSharedRemoteRuntimeInput,
  ) => Effect.Effect<SharedProjectDetail, SharedProjectsError>;
}

export class SharedProjects extends Context.Service<SharedProjects, SharedProjectsShape>()(
  "t3/sharedProjects/Services/SharedProjects",
) {}

export type {
  SharedProjectBootstrapManifest,
  SharedProjectClaimResult,
  SharedProjectDetail,
  SharedProjectSummary,
};
