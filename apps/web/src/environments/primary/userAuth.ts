import type { KamiUser, UserAuthSessionState } from "@t3tools/contracts";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type UserAuthGateState =
  | { status: "disabled" }
  | { status: "requires-login"; provider: "github"; errorMessage?: string }
  | { status: "authenticated"; provider: "github"; user: KamiUser };

const DISABLED_USER_AUTH_GATE_STATE = { status: "disabled" } as const;
const DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS = 1_000;
const DESKTOP_GITHUB_LOGIN_TIMEOUT_MS = 10 * 60_000;

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

function waitForDesktopGitHubLoginPoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function startDesktopGitHubUserLogin(): Promise<boolean> {
  const bridge = window.desktopBridge;
  if (!bridge) {
    return false;
  }

  const startResponse = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/user/auth/github/desktop/start"),
    {
      credentials: "include",
      method: "POST",
    },
  );
  if (!startResponse.ok) {
    throw new Error(`Failed to start GitHub login (${startResponse.status}).`);
  }

  const start = (await startResponse.json()) as {
    readonly authorizationUrl?: unknown;
    readonly handoffId?: unknown;
  };
  if (typeof start.authorizationUrl !== "string" || typeof start.handoffId !== "string") {
    throw new Error("GitHub login start response was invalid.");
  }

  const opened = await bridge.openExternal(start.authorizationUrl);
  if (!opened) {
    return false;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < DESKTOP_GITHUB_LOGIN_TIMEOUT_MS) {
    await waitForDesktopGitHubLoginPoll(DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS);
    const sessionResponse = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/api/user/auth/github/desktop/session", {
        handoffId: start.handoffId,
      }),
      {
        credentials: "include",
        redirect: "manual",
      },
    );

    if (sessionResponse.status === 202) {
      continue;
    }

    if (!sessionResponse.ok) {
      let message = `GitHub login failed (${sessionResponse.status}).`;
      try {
        const payload = (await sessionResponse.json()) as { readonly message?: unknown };
        if (typeof payload.message === "string" && payload.message.trim().length > 0) {
          message = payload.message;
        }
      } catch {
        // Keep the status-based fallback.
      }
      throw new Error(message);
    }

    const session = (await sessionResponse.json()) as {
      readonly status?: unknown;
      readonly sessionState?: UserAuthSessionState;
    };
    if (session.status !== "authenticated" || !session.sessionState?.authenticated) {
      throw new Error("GitHub login completed with an invalid session response.");
    }

    resolvedAuthenticatedUserAuthGateState = toUserAuthGateState(session.sessionState);
    userAuthBootstrapPromise = null;
    return true;
  }

  throw new Error("Timed out waiting for GitHub login to complete.");
}

export async function startGitHubUserLogin(): Promise<void> {
  if (await startDesktopGitHubUserLogin()) {
    window.location.reload();
    return;
  }

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
