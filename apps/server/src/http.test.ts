// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  isLoopbackHostname,
  listTestHarnessRuns,
  resolveDevRedirectUrl,
  resolveTestHarnessArtifactPath,
  resolveTestHarnessTraceViewerAssetPath,
} from "./http.ts";
import { createBrowserHarnessProjectKey } from "./testing/browserHarness.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("test harness artifact routing", () => {
  it("allows artifact files under the state test-harness directory", () => {
    const stateDir = NodePath.resolve("state");
    const artifactPath = NodePath.join(
      stateDir,
      "test-harness",
      "projects",
      "project-1",
      "runs",
      "run-1",
      "trace.zip",
    );

    expect(resolveTestHarnessArtifactPath({ stateDir, artifactPath })).toBe(artifactPath);
  });

  it("rejects files outside the test-harness directory", () => {
    expect(
      resolveTestHarnessArtifactPath({
        stateDir: NodePath.resolve("state"),
        artifactPath: NodePath.resolve("state", "secrets", "session.json"),
      }),
    ).toBeNull();
  });
});

describe("test harness trace viewer routing", () => {
  it("serves bundled Playwright trace viewer assets", () => {
    const indexPath = resolveTestHarnessTraceViewerAssetPath({ relativePath: "/index.html" });

    expect(indexPath).toMatch(/traceViewer[\\/]+index\.html$/);
  });

  it("rejects traversal outside bundled trace viewer assets", () => {
    expect(resolveTestHarnessTraceViewerAssetPath({ relativePath: "/../package.json" })).toBeNull();
  });
});

describe("test harness run history", () => {
  it("lists recent project runs from app state summaries", async () => {
    const stateDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kamicode-runs-test-"));
    const cwd = NodePath.join(NodeOS.tmpdir(), "kami-project");
    const projectKey = createBrowserHarnessProjectKey({ cwd });
    const runDir = NodePath.join(stateDir, "test-harness", "projects", projectKey, "runs", "run-1");
    const screenshotPath = NodePath.join(runDir, "screenshots", "01-final.png");
    await NodeFSP.mkdir(NodePath.dirname(screenshotPath), { recursive: true });
    await NodeFSP.writeFile(screenshotPath, "");
    await NodeFSP.writeFile(
      NodePath.join(runDir, "summary.json"),
      JSON.stringify({
        runId: "run-1",
        projectId: projectKey,
        environmentId: "default",
        status: "failed",
        success: false,
        url: "http://127.0.0.1:5733",
        finalUrl: "http://127.0.0.1:5733/pair",
        title: "KamiCode (Dev)",
        goal: "Validate chat UI",
        artifactsDir: runDir,
        summaryPath: NodePath.join(runDir, "summary.json"),
        markdownPath: NodePath.join(runDir, "summary.md"),
        tracePath: NodePath.join(runDir, "trace.zip"),
        consolePath: NodePath.join(runDir, "console.json"),
        networkPath: NodePath.join(runDir, "network.json"),
        storageStatePath: NodePath.join(
          stateDir,
          "test-harness",
          "projects",
          projectKey,
          "default.storageState.json",
        ),
        artifactPaths: {
          trace: NodePath.join(runDir, "trace.zip"),
          screenshots: [screenshotPath],
          consoleLog: NodePath.join(runDir, "console.json"),
          networkLog: NodePath.join(runDir, "network.json"),
          storageState: NodePath.join(
            stateDir,
            "test-harness",
            "projects",
            projectKey,
            "default.storageState.json",
          ),
          summary: NodePath.join(runDir, "summary.json"),
          markdown: NodePath.join(runDir, "summary.md"),
        },
        evidenceSummary: "Pairing screen was visible.",
        doneSummary: "Chat UI was blocked by pairing.",
        screenshots: [{ label: "final", path: screenshotPath }],
        steps: [],
        observations: [],
        consoleMessages: [{ type: "warning", text: "slow", location: {} }],
        pageErrors: ["boom"],
        failedRequests: ["GET /missing 404"],
        startedAt: "2026-05-27T18:19:16.786Z",
        completedAt: "2026-05-27T18:19:20.000Z",
        durationMs: 3214,
      }),
    );

    const response = await listTestHarnessRuns({ stateDir, cwd });

    expect(response.runs).toHaveLength(1);
    expect(response.runs[0]).toMatchObject({
      runId: "run-1",
      status: "fail",
      goal: "Validate chat UI",
      outputSummary: "Chat UI was blocked by pairing.",
      finalUrl: "http://127.0.0.1:5733/pair",
      title: "KamiCode (Dev)",
      networkFailures: ["GET /missing 404"],
    });
    expect(response.runs[0]?.screenshots[0]?.path).toBe(screenshotPath);
    expect(response.runs[0]?.consoleErrors).toEqual(["[warning] slow", "[pageerror] boom"]);
  });

  it("returns an empty run list when a project has no test harness state", async () => {
    const stateDir = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "kamicode-runs-empty-test-"),
    );

    await expect(
      listTestHarnessRuns({
        stateDir,
        cwd: NodePath.join(NodeOS.tmpdir(), "missing-project"),
      }),
    ).resolves.toEqual({ runs: [] });
  });
});
