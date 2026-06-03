import type {
  AppendSharedThreadMessageInput,
  ClaimSharedProjectInviteInput,
  CreateSharedProjectInviteInput,
  PublishLocalProjectInput,
  PublishSharedThreadInput,
  RemoveSharedProjectMemberInput,
  SetSharedDefaultEnvironmentInput,
  SharedProjectBootstrapManifest,
  SharedProjectClaimResult,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectId,
  SharedProjectInvite,
  SharedProjectListResult,
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
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

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
  readonly publishThread: (
    user: AuthenticatedUser,
    input: PublishSharedThreadInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly updateThreadVisibility: (
    user: AuthenticatedUser,
    input: UpdateSharedThreadVisibilityInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly appendThreadMessage: (
    user: AuthenticatedUser,
    input: AppendSharedThreadMessageInput,
  ) => Effect.Effect<SharedThread, SharedProjectsError>;
  readonly upsertRuntime: (
    user: AuthenticatedUser,
    input: UpsertSharedRuntimeInput,
  ) => Effect.Effect<SharedRuntime, SharedProjectsError>;
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
