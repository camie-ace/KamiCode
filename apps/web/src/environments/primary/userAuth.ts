import type { KamiUser, UserAuthSessionState } from "@t3tools/contracts";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type UserAuthGateState =
  | { status: "disabled" }
  | { status: "requires-login"; provider: "github"; errorMessage?: string }
  | { status: "authenticated"; provider: "github"; user: KamiUser };

const DISABLED_USER_AUTH_GATE_STATE = { status: "disabled" } as const;

let userAuthBootstrapPromise: Promise<UserAuthGateState> | null = null;
let resolvedAuthenticatedUserAuthGateState: UserAuthGateState | null = null;

export async function fetchUserAuthSessionState(): Promise<UserAuthSessionState> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/user/session"), {
    credentials: "include",
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`Failed to load GitHub login state (${response.status}).`);
  }
  return (await response.json()) as UserAuthSessionState;
}

function toUserAuthGateState(session: UserAuthSessionState): UserAuthGateState {
  if (!session.enabled) {
    return { status: "disabled" };
  }

  if (!session.authenticated) {
    return {
      status: "requires-login",
      provider: session.provider,
    };
  }

  return {
    status: "authenticated",
    provider: session.provider,
    user: session.user,
  };
}

export async function resolveInitialUserAuthGateState(): Promise<UserAuthGateState> {
  if (resolvedAuthenticatedUserAuthGateState?.status === "authenticated") {
    return resolvedAuthenticatedUserAuthGateState;
  }

  if (userAuthBootstrapPromise) {
    return userAuthBootstrapPromise;
  }

  const nextPromise = fetchUserAuthSessionState()
    .then(toUserAuthGateState)
    .catch(() => DISABLED_USER_AUTH_GATE_STATE);
  userAuthBootstrapPromise = nextPromise;
  return nextPromise
    .then((result) => {
      if (result.status === "authenticated") {
        resolvedAuthenticatedUserAuthGateState = result;
      }
      return result;
    })
    .finally(() => {
      if (userAuthBootstrapPromise === nextPromise) {
        userAuthBootstrapPromise = null;
      }
    });
}

export function startGitHubUserLogin(): void {
  window.location.href = resolvePrimaryEnvironmentHttpUrl("/api/user/auth/github/start");
}

export async function logoutGitHubUser(): Promise<void> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/user/logout"), {
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Failed to sign out (${response.status}).`);
  }
  resolvedAuthenticatedUserAuthGateState = null;
  userAuthBootstrapPromise = null;
}

export function __resetUserAuthBootstrapForTests() {
  userAuthBootstrapPromise = null;
  resolvedAuthenticatedUserAuthGateState = null;
}
