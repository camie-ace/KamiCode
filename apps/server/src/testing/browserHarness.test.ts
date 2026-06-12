// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as Fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  createBrowserHarnessProjectKey,
  createBrowserHarnessRunId,
  detectBrowserHarnessAuthGate,
  formatBrowserHarnessCliOutput,
  formatBrowserHarnessMarkdown,
  runBrowserHarness,
  resolveBrowserHarnessRunPaths,
  sanitizeBrowserHarnessSegment,
  shouldBlockBrowserHarnessAuthGate,
  type BrowserHarnessRunResult,
} from "./browserHarness.ts";

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
  }
  return body;
}

async function startAuthenticatedKamiCodeFixture(): Promise<{
  readonly url: string;
  readonly wasCredentialExchanged: () => boolean;
  readonly close: () => Promise<void>;
}> {
  let credentialExchanged = false;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/api/auth/bootstrap") {
      void readRequestBody(request).then((body) => {
        const parsed = JSON.parse(body || "{}") as { readonly credential?: string };
        if (parsed.credential !== "good-pairing-token") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Invalid bootstrap credential." }));
          return;
        }

        credentialExchanged = true;
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "kami_session=ok; Path=/; SameSite=Lax",
        });
        response.end(JSON.stringify({ authenticated: true }));
      });
      return;
    }

    if (requestUrl.pathname === "/pair") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
<title>KamiCode Pair</title>
<h1>Pair with this environment</h1>
<script>
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token) {
    fetch("/api/auth/bootstrap", {
      body: JSON.stringify({ credential: token }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST"
    }).then((response) => {
      if (!response.ok) throw new Error("Pairing failed");
      location.href = "/";
    });
  }
</script>`);
      return;
    }

    if (!request.headers.cookie?.includes("kami_session=ok")) {
      response.writeHead(302, { location: "/pair" });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
<title>KamiCode Chat</title>
<h1>General Greeting</h1>
<main>Ask anything, @tag files/folders, $use skills, or / for commands</main>`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    wasCredentialExchanged: () => credentialExchanged,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("browserHarness", () => {
  it("sanitizes filesystem path segments", () => {
    expect(sanitizeBrowserHarnessSegment(" Upload flow: big files / auth ")).toBe(
      "Upload-flow-big-files-auth",
    );
    expect(sanitizeBrowserHarnessSegment("   ")).toBe("run");
  });

  it("creates deterministic run ids when inputs are supplied", () => {
    expect(
      createBrowserHarnessRunId({
        now: new Date("2026-01-02T03:04:05.006Z"),
        randomId: "abcdef12-3456-7890",
      }),
    ).toBe("2026-01-02T03-04-05-006Z-abcdef12");
  });

  it("derives stable project keys from explicit project ids or cwd", () => {
    expect(
      createBrowserHarnessProjectKey({
        cwd: path.resolve("tmp", "project"),
        projectId: " Project: Kami / Core ",
      }),
    ).toBe("Project-Kami-Core");

    expect(createBrowserHarnessProjectKey({ cwd: path.resolve("tmp", "project") })).toMatch(
      /^cwd-[a-f0-9]{12}$/,
    );
  });

  it("resolves app-data project-scoped artifact and storage paths", () => {
    const cwd = path.resolve("tmp", "project");
    const stateDir = path.resolve("tmp", "kamicode-state");
    const paths = resolveBrowserHarnessRunPaths({
      cwd,
      stateDir,
      projectId: "kami-project",
      url: "http://localhost:5173",
    });

    expect(paths.cwd).toBe(cwd);
    expect(paths.stateRoot).toBe(stateDir);
    expect(paths.projectKey).toBe("kami-project");
    expect(paths.projectStateDir).toBe(
      path.join(stateDir, "test-harness", "projects", "kami-project"),
    );
    expect(paths.artifactsDir).toContain(path.join(paths.projectStateDir, "runs"));
    expect(paths.screenshotsDir).toBe(path.join(paths.artifactsDir, "screenshots"));
    expect(paths.summaryPath).toBe(path.join(paths.artifactsDir, "summary.json"));
    expect(paths.markdownPath).toBe(path.join(paths.artifactsDir, "summary.md"));
    expect(paths.tracePath).toBe(path.join(paths.artifactsDir, "trace.zip"));
    expect(paths.consolePath).toBe(path.join(paths.artifactsDir, "console.json"));
    expect(paths.networkPath).toBe(path.join(paths.artifactsDir, "network.json"));
    expect(paths.storageStatePath).toBe(
      path.join(paths.projectStateDir, "default.storageState.json"),
    );
    expect(paths.scriptPath).toBe(null);
  });

  it("does not fall back to repo-tracked .kamicode storage when app state is absent", () => {
    const cwd = path.resolve("tmp", "project");
    const paths = resolveBrowserHarnessRunPaths({
      cwd,
      url: "http://localhost:5173",
    });

    expect(paths.stateRoot).not.toBe(path.join(cwd, ".kamicode"));
    expect(paths.artifactsDir).not.toContain(path.join(cwd, ".kamicode"));
    expect(paths.storageStatePath).not.toContain(path.join(cwd, ".kamicode"));
  });

  it("formats concise CLI and markdown summaries", () => {
    const result: BrowserHarnessRunResult = {
      runId: "run-1",
      status: "passed",
      success: true,
      url: "http://localhost:5173",
      finalUrl: "http://localhost:5173/dashboard",
      title: "Dashboard",
      goal: "Check upload flow",
      artifactsDir: "artifacts",
      summaryPath: "artifacts/summary.json",
      markdownPath: "artifacts/summary.md",
      tracePath: "artifacts/trace.zip",
      consolePath: "artifacts/console.json",
      networkPath: "artifacts/network.json",
      storageStatePath: "state/test-harness/projects/kami-project/default.storageState.json",
      artifactPaths: {
        trace: "artifacts/trace.zip",
        screenshots: ["artifacts/final.png"],
        consoleLog: "artifacts/console.json",
        networkLog: "artifacts/network.json",
        storageState: "state/test-harness/projects/kami-project/default.storageState.json",
        summary: "artifacts/summary.json",
        markdown: "artifacts/summary.md",
      },
      evidenceSummary: "1 observation, 1 screenshot, trace recorded.",
      projectId: "kami-project",
      environmentId: "default",
      screenshots: [{ label: "final", path: "artifacts/final.png" }],
      steps: [{ name: "Open target URL", status: "passed", durationMs: 123 }],
      observations: [
        {
          runId: "run-1",
          stepId: "finish",
          url: "http://localhost:5173/dashboard",
          title: "Dashboard",
          screenshotId: "artifacts/final.png",
          domSummary: "url=http://localhost:5173/dashboard; title=Dashboard",
          visibleTextSample: ["Dashboard"],
          consoleErrors: [],
          networkFailures: [],
          timing: {
            actionStartedAt: "2026-01-01T00:00:00.000Z",
            actionEndedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1000,
          },
        },
      ],
      consoleMessages: [],
      pageErrors: [],
      failedRequests: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
    };

    expect(formatBrowserHarnessCliOutput(result)).toContain("Browser test PASSED");
    expect(formatBrowserHarnessCliOutput(result)).toContain("Screenshot: artifacts/final.png");
    expect(formatBrowserHarnessCliOutput(result)).toContain("Console: artifacts/console.json");
    expect(formatBrowserHarnessMarkdown(result)).toContain("Goal: Check upload flow");
    expect(formatBrowserHarnessMarkdown(result)).toContain("PASSED Open target URL");
    expect(formatBrowserHarnessMarkdown(result)).toContain("## Observations");
  });

  it("detects auth gates that would otherwise be mistaken for feature evidence", () => {
    const authGate = detectBrowserHarnessAuthGate({
      url: "http://localhost:5173/login",
      visibleTextSample: ["Login", "Email", "Password"],
    });

    expect(authGate.detected).toBe(true);
    expect(
      shouldBlockBrowserHarnessAuthGate({
        status: "passed",
        authGate,
        authExpectation: "authenticated",
        goal: "Validate dashboard upload controls",
      }),
    ).toBe(true);
    expect(
      shouldBlockBrowserHarnessAuthGate({
        status: "passed",
        authGate,
        authExpectation: "anonymous",
        goal: "Validate login form",
      }),
    ).toBe(false);
  });

  it("fails bare assert actions instead of treating natural language as verified", async () => {
    const result = await runBrowserHarness({
      url: `data:text/html,${encodeURIComponent("<title>Assert Smoke</title><h1>Hello</h1>")}`,
      headless: true,
      recordVideo: false,
      timeoutMs: 5_000,
      projectId: "assert-smoke",
      actions: [
        {
          type: "assert",
          description: "The page says hello",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain(
      "Assert action requires at least one machine-checkable field",
    );
  }, 30_000);

  it("passes assert actions with machine-checkable text and title expectations", async () => {
    const result = await runBrowserHarness({
      url: `data:text/html,${encodeURIComponent("<title>Assert Smoke</title><h1>Hello</h1>")}`,
      headless: true,
      recordVideo: false,
      timeoutMs: 5_000,
      projectId: "assert-smoke",
      actions: [
        {
          type: "assert",
          description: "The page says hello",
          text: "Hello",
          titleIncludes: "Assert Smoke",
        },
        {
          type: "done",
          summary: "Machine-checkable assert passed.",
          result: "pass",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.errorMessage).toBeUndefined();
  }, 30_000);

  it("uses a KamiCode pairing credential to recover from /pair and reach the app UI", async () => {
    const fixture = await startAuthenticatedKamiCodeFixture();
    const stateDir = await Fs.mkdtemp(path.join(os.tmpdir(), "kamicode-harness-auth-"));

    try {
      const result = await runBrowserHarness({
        url: fixture.url,
        stateDir,
        headless: true,
        projectId: "auth-pairing-smoke",
        auth: {
          type: "kamicode-pairing",
          credential: "good-pairing-token",
        },
        actions: [
          {
            type: "assert",
            description: "Chat shell is visible after pairing",
            text: "General Greeting",
            titleIncludes: "KamiCode Chat",
          },
          {
            type: "done",
            summary: "KamiCode pairing auth reached the app shell.",
            result: "pass",
          },
        ],
      });

      if (!fixture.wasCredentialExchanged() || !result.success) {
        throw new Error(
          JSON.stringify(
            {
              credentialExchanged: fixture.wasCredentialExchanged(),
              consoleMessages: result.consoleMessages,
              errorMessage: result.errorMessage,
              failedRequests: result.failedRequests,
              finalUrl: result.finalUrl,
              pageErrors: result.pageErrors,
              observations: result.observations.map((observation) => ({
                stepId: observation.stepId,
                title: observation.title,
                url: observation.url,
                visibleTextSample: observation.visibleTextSample,
              })),
              steps: result.steps,
              title: result.title,
            },
            null,
            2,
          ),
        );
      }

      expect({
        credentialExchanged: fixture.wasCredentialExchanged(),
        errorMessage: result.errorMessage,
        finalUrl: result.finalUrl,
        steps: result.steps,
        success: result.success,
        title: result.title,
      }).toMatchObject({
        credentialExchanged: true,
        success: true,
        title: "KamiCode Chat",
      });
      expect(result.finalUrl).not.toContain("/pair");
      expect(result.observations.at(-1)?.visibleTextSample).toContain("General Greeting");
    } finally {
      await fixture.close();
      await Fs.rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
