// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createBrowserHarnessProjectKey,
  createBrowserHarnessRunId,
  formatBrowserHarnessCliOutput,
  formatBrowserHarnessMarkdown,
  runBrowserHarness,
  resolveBrowserHarnessRunPaths,
  sanitizeBrowserHarnessSegment,
  type BrowserHarnessRunResult,
} from "./browserHarness.ts";

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
    expect(paths.storageStatePath).toBe(path.join(paths.projectStateDir, "default.storageState.json"));
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

  it(
    "fails bare assert actions instead of treating natural language as verified",
    async () => {
      const result = await runBrowserHarness({
        url: "data:text/html,<title>Assert Smoke</title><h1>Hello</h1>",
        headless: true,
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
    },
    15_000,
  );

  it(
    "passes assert actions with machine-checkable text and title expectations",
    async () => {
      const result = await runBrowserHarness({
        url: "data:text/html,<title>Assert Smoke</title><h1>Hello</h1>",
        headless: true,
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
    },
    15_000,
  );
});
