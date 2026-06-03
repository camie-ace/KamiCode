import type {
  SharedDeployState,
  SharedEnvironmentValidationStatus,
  SharedProjectInvite,
  SharedProjectRole,
} from "@t3tools/contracts";

const ROLE_RANK: Record<SharedProjectRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function normalizeGitHubLogin(login: string): string {
  return login.trim().replace(/^@/u, "").toLowerCase();
}

export function roleAtLeast(role: SharedProjectRole, minimum: SharedProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canManageSharedProject(role: SharedProjectRole): boolean {
  return roleAtLeast(role, "admin");
}

export function canEditSharedWork(role: SharedProjectRole): boolean {
  return roleAtLeast(role, "member");
}

export function canReadSharedProject(role: SharedProjectRole | null | undefined): boolean {
  return role !== null && role !== undefined;
}

export function validateSharedEnvironmentUrl(url: string): SharedEnvironmentValidationStatus {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "invalid-url";
    }
    return "unknown";
  } catch {
    return "invalid-url";
  }
}

export function resolveInviteStatus(
  invite: Pick<SharedProjectInvite, "claimedAt" | "revokedAt" | "expiresAt">,
  nowIso: string,
): SharedProjectInvite["status"] {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.claimedAt !== null) return "claimed";
  if (invite.expiresAt <= nowIso) return "expired";
  return "pending";
}

export function resolveDeployState(input: {
  readonly currentHeadSha: string | null;
  readonly deployedSha: string | null;
}): SharedDeployState {
  if (!input.currentHeadSha || !input.deployedSha) {
    return "unknown";
  }
  return input.currentHeadSha === input.deployedSha ? "current" : "stale";
}
