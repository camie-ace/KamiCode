import type { KamiUser, UserAuthSessionState } from "@t3tools/contracts";

import { readDesktopPrimaryBearerToken } from "./desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type UserAuthGateState =
  | { status: "disabled" }
  | { status: "requires-login"; provider: "github"; errorMessage?: string }
  | { status: "authenticated"; provider: "github"; user: KamiUser };

const GITHUB_DEVICE_LOGIN_POLL_INTERVAL_MS = 1_000;
const GITHUB_DEVICE_LOGIN_TIMEOUT_MS = 10 * 60_000;

export interface GitHubUserLoginOptions {
  readonly onDeviceCode?: (input: {
    readonly userCode: string;
    readonly verificationUri: string;
  }) => void;
}

let userAuthBootstrapPromise: Promise<UserAuthGateState> | null = null;
let resolvedAuthenticatedUserAuthGateState: UserAuthGateState | null = null;

function isDesktopRenderer(): boolean {
  return typeof window !== "undefined" && window.desktopBridge !== undefined;
}

function isSameOriginBrowserPrimary(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.origin.startsWith("http") &&
    new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin
  );
}

function resolvePrimaryUserAuthUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  if (!isDesktopRenderer()) {
    return resolvePrimaryEnvironmentHttpUrl(pathname, searchParams);
  }

  // Desktop production and development both expose the renderer through a
  // same-origin custom protocol. Its main-process proxy owns the local HTTP
  // cookie jar, so user-auth requests must travel through that proxy instead
  // of bypassing it with a cross-origin loopback fetch.
  const url = new URL(pathname, window.location.href);
  if (searchParams) {
    url.search = new URLSearchParams(searchParams).toString();
  }
  return url.toString();
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

  return fetch(resolvePrimaryUserAuthUrl(pathname, searchParams), {
    ...requestInit,
    headers,
    credentials: isDesktopRenderer() || isSameOriginBrowserPrimary() ? "include" : "omit",
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
    .catch(() => ({
      status: "requires-login" as const,
      provider: "github" as const,
      errorMessage: "KamiCode could not verify your GitHub profile. Reload to try again.",
    }));
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

function waitForGitHubDeviceLoginPoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeDevicePollIntervalMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(value, GITHUB_DEVICE_LOGIN_POLL_INTERVAL_MS)
    : GITHUB_DEVICE_LOGIN_POLL_INTERVAL_MS;
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

async function startDeviceGitHubUserLogin(options?: GitHubUserLoginOptions): Promise<boolean> {
  const bridge = window.desktopBridge;
  // Reserve a tab synchronously while the click still carries popup permission.
  // If the browser blocks it, the on-screen code includes a manual GitHub link.
  const browserLoginWindow = bridge ? null : (window.open?.("", "_blank") ?? null);

  const startResponse = await fetchPrimaryUserAuth("/api/user/auth/github/desktop/start", {
    method: "POST",
  }).catch((error) => {
    browserLoginWindow?.close();
    throw error;
  });
  if (!startResponse.ok) {
    browserLoginWindow?.close();
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
    browserLoginWindow?.close();
    throw new Error("GitHub login start response was invalid.");
  }

  if (typeof start.userCode === "string" && start.userCode.trim().length > 0) {
    options?.onDeviceCode?.({
      userCode: start.userCode,
      verificationUri: start.authorizationUrl,
    });
  }

  if (bridge) {
    const opened = await bridge.openExternal(start.authorizationUrl);
    if (!opened) {
      return false;
    }
  } else if (browserLoginWindow) {
    browserLoginWindow.opener = null;
    browserLoginWindow.location.href = start.authorizationUrl;
  }

  const startedAt = Date.now();
  let pollIntervalMs = normalizeDevicePollIntervalMs(start.pollIntervalMs);
  while (Date.now() - startedAt < GITHUB_DEVICE_LOGIN_TIMEOUT_MS) {
    await waitForGitHubDeviceLoginPoll(pollIntervalMs);
    const sessionResponse = await fetchPrimaryUserAuth("/api/user/auth/github/desktop/session", {
      searchParams: {
        handoffId: start.handoffId,
      },
    });

    if (sessionResponse.status === 202) {
      try {
        const payload = (await sessionResponse.json()) as { readonly pollIntervalMs?: unknown };
        pollIntervalMs = normalizeDevicePollIntervalMs(payload.pollIntervalMs);
      } catch {
        pollIntervalMs = GITHUB_DEVICE_LOGIN_POLL_INTERVAL_MS;
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
  if (await startDeviceGitHubUserLogin(options)) {
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
