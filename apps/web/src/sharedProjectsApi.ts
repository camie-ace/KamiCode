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
  ResolveSharedThreadShareInput,
  RemoveSharedProjectMemberInput,
  RemoveSharedSshCredentialInput,
  SetSharedDefaultEnvironmentInput,
  SharedProjectBootstrapManifest,
  SharedProjectClaimResult,
  SharedProjectCurrentUser,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectId,
  SharedProjectInvite,
  SharedProjectListResult,
  SharedProjectSshCredential,
  SharedRuntime,
  ResolvedSharedThreadShare,
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

import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

type SharedProjectApiErrorBody = {
  readonly error?: unknown;
};

type SharedProjectRequestOptions = {
  readonly profileId?: string | null | undefined;
};

async function decodeSharedProjectResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let message = `Shared project request failed (${response.status}).`;
  try {
    const payload = (await response.json()) as SharedProjectApiErrorBody;
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      message = payload.error;
    }
  } catch {
    // Keep the status-based fallback.
  }
  throw new Error(message);
}

function sharedProjectUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(resolvePrimaryEnvironmentHttpUrl(path));
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function sharedProjectGet<T>(
  path: string,
  params?: Record<string, string>,
  options?: SharedProjectRequestOptions,
): Promise<T> {
  const headers =
    options?.profileId && options.profileId.trim().length > 0
      ? { "x-kamicode-shared-collaboration-profile-id": options.profileId }
      : null;
  const response = await fetch(sharedProjectUrl(path, params), {
    credentials: "include",
    redirect: "manual",
    ...(headers ? { headers } : {}),
  });
  return decodeSharedProjectResponse<T>(response);
}

async function sharedProjectPost<T>(
  path: string,
  body: unknown,
  options?: SharedProjectRequestOptions,
): Promise<T> {
  const response = await fetch(sharedProjectUrl(path), {
    credentials: "include",
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.profileId && options.profileId.trim().length > 0
        ? { "x-kamicode-shared-collaboration-profile-id": options.profileId }
        : {}),
    },
    body: JSON.stringify(body),
  });
  return decodeSharedProjectResponse<T>(response);
}

export function fetchSharedProjectCurrentUser(): Promise<SharedProjectCurrentUser> {
  return sharedProjectGet("/api/shared-projects/current-user");
}

export function listSharedProjects(
  options?: SharedProjectRequestOptions,
): Promise<SharedProjectListResult> {
  return sharedProjectGet("/api/shared-projects", undefined, options);
}

export function publishLocalProject(
  input: PublishLocalProjectInput,
  options?: SharedProjectRequestOptions,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/publish", input, options);
}

export function fetchSharedProjectDetail(
  projectId: SharedProjectId,
  options?: SharedProjectRequestOptions,
): Promise<SharedProjectDetail> {
  return sharedProjectGet("/api/shared-projects/detail", { projectId }, options);
}

export function fetchSharedProjectBootstrap(
  projectId: SharedProjectId,
): Promise<SharedProjectBootstrapManifest> {
  return sharedProjectGet("/api/shared-projects/bootstrap", { projectId });
}

export function syncSharedProjectContext(
  input: SyncSharedProjectContextInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/context/sync", input);
}

export function createSharedProjectInvite(
  input: CreateSharedProjectInviteInput,
): Promise<SharedProjectInvite> {
  return sharedProjectPost("/api/shared-projects/invites", input);
}

export function claimSharedProjectInvite(
  input: ClaimSharedProjectInviteInput,
): Promise<SharedProjectClaimResult> {
  return sharedProjectPost("/api/shared-projects/invites/claim", input);
}

export function updateSharedProjectMemberRole(
  input: UpdateSharedProjectMemberRoleInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/members/role", input);
}

export function removeSharedProjectMember(
  input: RemoveSharedProjectMemberInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/members/remove", input);
}

export function deleteSharedProject(
  input: DeleteSharedProjectInput,
): Promise<DeleteSharedProjectResult> {
  return sharedProjectPost("/api/shared-projects/delete", input);
}

export function publishSharedThread(
  input: PublishSharedThreadInput,
  options?: SharedProjectRequestOptions,
): Promise<SharedThread> {
  return sharedProjectPost("/api/shared-projects/threads/publish", input, options);
}

export function updateSharedThreadVisibility(
  input: UpdateSharedThreadVisibilityInput,
): Promise<SharedThread> {
  return sharedProjectPost("/api/shared-projects/threads/visibility", input);
}

export function importSharedThread(
  input: ImportSharedThreadInput,
  options?: SharedProjectRequestOptions,
): Promise<ImportSharedThreadResult> {
  return sharedProjectPost("/api/shared-projects/threads/import", input, options);
}

export function resolveSharedThreadShare(
  input: ResolveSharedThreadShareInput,
  options?: SharedProjectRequestOptions,
): Promise<ResolvedSharedThreadShare> {
  return sharedProjectPost("/api/shared-projects/threads/resolve", input, options);
}

export function importSharedThreadLink(
  input: ImportSharedThreadLinkInput,
  options?: SharedProjectRequestOptions,
): Promise<ImportSharedThreadResult> {
  return sharedProjectPost("/api/shared-projects/threads/import-link", input, options);
}

export function appendSharedThreadMessage(
  input: AppendSharedThreadMessageInput,
): Promise<SharedThread> {
  return sharedProjectPost("/api/shared-projects/threads/messages", input);
}

export function upsertSharedRuntime(input: UpsertSharedRuntimeInput): Promise<SharedRuntime> {
  return sharedProjectPost("/api/shared-projects/runtimes", input);
}

export function upsertSharedSshCredential(
  input: UpsertSharedSshCredentialInput,
): Promise<SharedProjectSshCredential> {
  return sharedProjectPost("/api/shared-projects/ssh-credentials", input);
}

export function removeSharedSshCredential(
  input: RemoveSharedSshCredentialInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/ssh-credentials/remove", input);
}

export function upsertSharedEnvironment(
  input: UpsertSharedEnvironmentInput,
): Promise<SharedProjectEnvironment> {
  return sharedProjectPost("/api/shared-projects/environments", input);
}

export function setSharedDefaultEnvironment(
  input: SetSharedDefaultEnvironmentInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/environments/default", input);
}

export function upsertSharedDeployAssociation(
  input: UpsertSharedDeployAssociationInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/deploys", input);
}

export function syncSharedRemoteRuntime(
  input: SyncSharedRemoteRuntimeInput,
): Promise<SharedProjectDetail> {
  return sharedProjectPost("/api/shared-projects/sync-remote-runtime", input);
}
