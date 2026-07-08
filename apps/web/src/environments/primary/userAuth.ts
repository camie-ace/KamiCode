import type { KamiUser, UserAuthSessionState } from "@t3tools/contracts";

import { readDesktopPrimaryBearerToken } from "./desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type UserAuthGateState =
  | { status: "disabled" }
  | { status: "requires-login"; provider: "github"; errorMessage?: string }
  | { status: "authenticated"; provider: "github"; user: KamiUser };

const DISABLED_USER_AUTH_GATE_STATE = { status: "disabled" } as const;
const DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS = 1_000;
const DESKTOP_GITHUB_LOGIN_TIMEOUT_MS = 10 * 60_000;

export interface GitHubUserLoginOptions {
  readonly onDesktopDeviceCode?: (input: {
    readonly userCode: string;
    readonly verificationUri: string;
  }) => void;
}

let userAuthBootstrapPromise: Promise<UserAuthGateState> | null = null;
let resolvedAuthenticatedUserAuthGateState: UserAuthGateState | null = null;

function isSameOriginBrowserPrimary(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.origin.startsWith("http") &&
    new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin
  );
}

async function fetchPrimaryUserAuth(
  pathname: string,
  init?: RequestInit & { readonly searchParams?: Record<string, string> },
): Promise<Response> {
  const { searchParams, ...requestInit } = init ?? {};
  const bearerToken = await readDesktopPrimaryBearerToken();
  const headers = new Headers(requestInit.headers);
  if (bearerToken) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  }

  return fetch(resolvePrimaryEnvironmentHttpUrl(pathname, searchParams), {
    ...requestInit,
    headers,
    credentials: isSameOriginBrowserPrimary() ? "include" : "omit",
    redirect: requestInit.redirect ?? "manual",
  });
}

export async function fetchUserAuthSessionState(): Promise<UserAuthSessionState> {
  const response = await fetchPrimaryUserAuth("/api/user/session");
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

function normalizeDesktopPollIntervalMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(value, DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS)
    : DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS;
}

async function readJsonErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      readonly error?: unknown;
      readonly message?: unknown;
    };
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : typeof payload.message === "string" && payload.message.trim().length > 0
          ? payload.message
          : null;
    return message ?? fallback;
  } catch {
    return fallback;
  }
}

async function startDesktopGitHubUserLogin(options?: GitHubUserLoginOptions): Promise<boolean> {
  const bridge = window.desktopBridge;
  if (!bridge) {
    return false;
  }

  const startResponse = await fetchPrimaryUserAuth("/api/user/auth/github/desktop/start", {
    method: "POST",
  });
  if (!startResponse.ok) {
    throw new Error(
      await readJsonErrorMessage(
        startResponse,
        `Failed to start GitHub login (${startResponse.status}).`,
      ),
    );
  }

  const start = (await startResponse.json()) as {
    readonly authorizationUrl?: unknown;
    readonly handoffId?: unknown;
    readonly userCode?: unknown;
    readonly pollIntervalMs?: unknown;
  };
  if (typeof start.authorizationUrl !== "string" || typeof start.handoffId !== "string") {
    throw new Error("GitHub login start response was invalid.");
  }

  if (typeof start.userCode === "string" && start.userCode.trim().length > 0) {
    options?.onDesktopDeviceCode?.({
      userCode: start.userCode,
      verificationUri: start.authorizationUrl,
    });
  }

  const opened = await bridge.openExternal(start.authorizationUrl);
  if (!opened) {
    return false;
  }

  const startedAt = Date.now();
  let pollIntervalMs = normalizeDesktopPollIntervalMs(start.pollIntervalMs);
  while (Date.now() - startedAt < DESKTOP_GITHUB_LOGIN_TIMEOUT_MS) {
    await waitForDesktopGitHubLoginPoll(pollIntervalMs);
    const sessionResponse = await fetchPrimaryUserAuth("/api/user/auth/github/desktop/session", {
      searchParams: {
        handoffId: start.handoffId,
      },
    });

    if (sessionResponse.status === 202) {
      try {
        const payload = (await sessionResponse.json()) as { readonly pollIntervalMs?: unknown };
        pollIntervalMs = normalizeDesktopPollIntervalMs(payload.pollIntervalMs);
      } catch {
        pollIntervalMs = DESKTOP_GITHUB_LOGIN_POLL_INTERVAL_MS;
      }
      continue;
    }

    if (!sessionResponse.ok) {
      throw new Error(
        await readJsonErrorMessage(
          sessionResponse,
          `GitHub login failed (${sessionResponse.status}).`,
        ),
      );
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

export async function startGitHubUserLogin(options?: GitHubUserLoginOptions): Promise<void> {
  if (await startDesktopGitHubUserLogin(options)) {
    window.location.reload();
    return;
  }

  window.location.href = resolvePrimaryEnvironmentHttpUrl("/api/user/auth/github/start");
}

export async function logoutGitHubUser(): Promise<void> {
  const response = await fetchPrimaryUserAuth("/api/user/logout", {
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
