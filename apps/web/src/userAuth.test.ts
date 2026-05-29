import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status: 200,
    ...init,
  });
}

type TestWindow = {
  location: URL;
  desktopBridge?: DesktopBridge;
};

function installTestBrowser(url: string) {
  const testWindow: TestWindow = {
    location: new URL(url),
  };

  vi.stubGlobal("window", testWindow);
  return testWindow;
}

describe("user auth bootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { __resetUserAuthBootstrapForTests } = await import("./environments/primary/userAuth");
    __resetUserAuthBootstrapForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns disabled when GitHub OAuth is not configured on the server", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        enabled: false,
        authenticated: false,
        provider: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialUserAuthGateState } = await import("./environments/primary/userAuth");

    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "disabled",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/user/session", {
      credentials: "include",
      redirect: "manual",
    });
  });

  it("fails closed when the GitHub login state endpoint is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialUserAuthGateState } = await import("./environments/primary/userAuth");

    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "disabled",
    });
  });

  it("fails closed when the GitHub login state endpoint redirects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialUserAuthGateState } = await import("./environments/primary/userAuth");

    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "disabled",
    });
  });

  it("requires GitHub login when configured but no user session exists", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        enabled: true,
        authenticated: false,
        provider: "github",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialUserAuthGateState } = await import("./environments/primary/userAuth");

    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "requires-login",
      provider: "github",
    });
  });

  it("memoizes authenticated GitHub user state", async () => {
    const user = {
      userId: "user-1",
      githubId: "123",
      githubLogin: "julius",
      displayName: "Julius",
      avatarUrl: "https://avatars.githubusercontent.com/u/123",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        enabled: true,
        authenticated: true,
        provider: "github",
        user,
        expiresAt: "2026-04-05T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { resolveInitialUserAuthGateState } = await import("./environments/primary/userAuth");

    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "authenticated",
      provider: "github",
      user,
    });
    await expect(resolveInitialUserAuthGateState()).resolves.toEqual({
      status: "authenticated",
      provider: "github",
      user,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts GitHub login against the primary environment in a browser tab", async () => {
    const testWindow = installTestBrowser("http://localhost/");

    const { startGitHubUserLogin } = await import("./environments/primary/userAuth");

    await startGitHubUserLogin();

    expect(testWindow.location.href).toBe("http://localhost/api/user/auth/github/start");
  });

  it("opens desktop GitHub login in the system browser and reloads after handoff completes", async () => {
    const testWindow = installTestBrowser("http://localhost/");
    const openExternal = vi.fn<DesktopBridge["openExternal"]>().mockResolvedValue(true);
    const reload = vi.fn();
    Object.defineProperty(testWindow.location, "reload", {
      configurable: true,
      value: reload,
    });
    testWindow.desktopBridge = {
      getLocalEnvironmentBootstrap: () => ({
        label: "Local environment",
        httpBaseUrl: "http://localhost:3773",
        wsBaseUrl: "ws://localhost:3773",
      }),
      openExternal,
    } as unknown as DesktopBridge;
    const user = {
      userId: "user-1",
      githubId: "123",
      githubLogin: "julius",
      displayName: "Julius",
      avatarUrl: "https://avatars.githubusercontent.com/u/123",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          authorizationUrl: "https://github.com/login/oauth/authorize?state=desktop",
          handoffId: "handoff-1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "authenticated",
          sessionState: {
            enabled: true,
            authenticated: true,
            provider: "github",
            user,
            expiresAt: "2026-04-05T00:00:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { startGitHubUserLogin } = await import("./environments/primary/userAuth");
    const loginPromise = startGitHubUserLogin();
    await vi.advanceTimersByTimeAsync(1_000);
    await loginPromise;

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3773/api/user/auth/github/desktop/start",
      {
        credentials: "include",
        method: "POST",
      },
    );
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize?state=desktop",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3773/api/user/auth/github/desktop/session?handoffId=handoff-1",
      {
        credentials: "include",
        redirect: "manual",
      },
    );
    expect(reload).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
