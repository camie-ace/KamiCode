import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import { describe, it } from "vitest";

import {
  formatBrowserHarnessDynamicToolResult,
  runBrowserHarnessDynamicTool,
  shouldAutoUseKamiCodePairingAuth,
  type BrowserHarnessRunner,
} from "./browserHarnessDynamicTool.ts";
import type { BrowserHarnessRunInput, BrowserHarnessRunResult } from "./browserHarness.ts";

function makeRunResult(input: BrowserHarnessRunInput): BrowserHarnessRunResult {
  return {
    runId: "run-1",
    projectId: input.projectId ?? "cwd-project",
    environmentId: input.environmentId ?? "default",
    status: "passed",
    success: true,
    url: input.url,
    finalUrl: input.url,
    title: "App",
    goal: input.goal ?? null,
    artifactsDir: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1",
    summaryPath: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\summary.json",
    markdownPath: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\summary.md",
    tracePath: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\trace.zip",
    consolePath: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\console.json",
    networkPath: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\network.json",
    storageStatePath: "C:\\state\\test-harness\\projects\\cwd-project\\default.storageState.json",
    artifactPaths: {
      trace: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\trace.zip",
      screenshots: [
        "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\screenshots\\01.png",
      ],
      consoleLog: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\console.json",
      networkLog: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\network.json",
      storageState: "C:\\state\\test-harness\\projects\\cwd-project\\default.storageState.json",
      summary: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\summary.json",
      markdown: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\summary.md",
    },
    evidenceSummary: "1 observation(s), 1 screenshot(s), trace recorded.",
    screenshots: [
      {
        label: "initial",
        path: "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\screenshots\\01.png",
      },
    ],
    steps: [
      {
        name: "Open target URL",
        status: "passed",
        durationMs: 12,
      },
    ],
    observations: [
      {
        runId: "run-1",
        stepId: "open-target-url",
        url: input.url,
        title: "App",
        screenshotId:
          "C:\\state\\test-harness\\projects\\cwd-project\\runs\\run-1\\screenshots\\01.png",
        domSummary: "url=http://localhost:3000; title=App; visibleTextLines=1; sample=Hello",
        visibleTextSample: ["Hello"],
        consoleErrors: [],
        networkFailures: [],
        timing: {
          actionStartedAt: "2026-05-25T00:00:00.000Z",
          actionEndedAt: "2026-05-25T00:00:00.012Z",
          durationMs: 12,
        },
      },
    ],
    consoleMessages: [],
    pageErrors: [],
    failedRequests: [],
    startedAt: "2026-05-25T00:00:00.000Z",
    completedAt: "2026-05-25T00:00:00.020Z",
    durationMs: 20,
  };
}

function readInputText(response: ReturnType<typeof formatBrowserHarnessDynamicToolResult>): string {
  const item = response.contentItems[0];
  assert.ok(item);
  assert.equal(item.type, "inputText");
  return item.text;
}

describe("runBrowserHarnessDynamicTool", () => {
  it("detects local KamiCode targets for automatic pairing auth", () => {
    assert.equal(
      shouldAutoUseKamiCodePairingAuth({
        url: "http://127.0.0.1:5733",
        canIssuePairingCredential: true,
      }),
      true,
    );
    assert.equal(
      shouldAutoUseKamiCodePairingAuth({
        url: "http://localhost:3000",
        canIssuePairingCredential: true,
      }),
      false,
    );
    assert.equal(
      shouldAutoUseKamiCodePairingAuth({
        url: "http://127.0.0.1:5733",
        auth: { type: "kamicode-pairing" },
        canIssuePairingCredential: true,
      }),
      false,
    );
  });

  it("validates arguments, runs the browser harness, and returns evidence", async () => {
    const calls: BrowserHarnessRunInput[] = [];
    const runner: BrowserHarnessRunner = async (input) => {
      calls.push(input);
      return makeRunResult(input);
    };

    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        stateDir: "C:\\state",
        runHarness: runner,
        rawArguments: {
          url: "http://localhost:3000",
          goal: "validate homepage",
          projectId: "project-1",
          environmentId: "local",
          headless: true,
          timeoutMs: 1000,
          actions: [
            { type: "assert", description: "Home text is visible", text: "Hello" },
            { type: "done", summary: "Home page loaded", result: "pass" },
          ],
        },
      }),
    );

    assert.equal(response.success, true);
    assert.equal(calls.length, 1);
    assert.deepStrictEqual(calls[0], {
      url: "http://localhost:3000",
      cwd: "C:\\project",
      stateDir: "C:\\state",
      goal: "validate homepage",
      projectId: "project-1",
      environmentId: "local",
      headless: true,
      timeoutMs: 1000,
      actions: [
        { type: "assert", description: "Home text is visible", text: "Hello" },
        { type: "done", summary: "Home page loaded", result: "pass" },
      ],
    });

    const body = JSON.parse(readInputText(response)) as {
      readonly status: string;
      readonly artifactPaths: { readonly trace: string };
      readonly observations: ReadonlyArray<{ readonly stepId: string }>;
    };
    assert.equal(body.status, "pass");
    assert.equal(body.artifactPaths.trace.endsWith("trace.zip"), true);
    assert.equal(body.observations[0]?.stepId, "open-target-url");
  });

  it("returns a failed tool response for invalid arguments", async () => {
    let called = false;
    const runner: BrowserHarnessRunner = async (input) => {
      called = true;
      return makeRunResult(input);
    };

    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        runHarness: runner,
        rawArguments: {
          goal: "missing url and actions",
        },
      }),
    );

    assert.equal(response.success, false);
    assert.equal(called, false);
    assert.match(readInputText(response), /Invalid kami_test_harness arguments/);
  });

  it("requests a runtime-issued KamiCode pairing credential when auth is requested", async () => {
    const calls: BrowserHarnessRunInput[] = [];
    const runner: BrowserHarnessRunner = async (input) => {
      calls.push(input);
      return makeRunResult(input);
    };

    let issued = 0;
    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        runHarness: runner,
        issueKamiCodePairingCredential: () => {
          issued += 1;
          return Effect.succeed("issued-harness-token");
        },
        rawArguments: {
          url: "http://127.0.0.1:5733",
          goal: "validate KamiCode chat shell",
          auth: { type: "kamicode-pairing" },
          actions: [{ type: "screenshot", label: "chat-shell" }],
        },
      }),
    );

    assert.equal(response.success, true);
    assert.equal(issued, 1);
    assert.deepStrictEqual(calls[0]?.auth, {
      type: "kamicode-pairing",
      credential: "issued-harness-token",
      required: true,
    });
    assert.equal(calls[0]?.timeoutMs, 60_000);
  });

  it("automatically requests KamiCode pairing auth for the local KamiCode dev URL", async () => {
    const calls: BrowserHarnessRunInput[] = [];
    const runner: BrowserHarnessRunner = async (input) => {
      calls.push(input);
      return makeRunResult(input);
    };

    let issued = 0;
    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        runHarness: runner,
        issueKamiCodePairingCredential: () => {
          issued += 1;
          return Effect.succeed("auto-issued-harness-token");
        },
        rawArguments: {
          url: "http://127.0.0.1:5733",
          goal: "validate KamiCode chat shell",
          actions: [{ type: "screenshot", label: "chat-shell" }],
        },
      }),
    );

    assert.equal(response.success, true);
    assert.equal(issued, 1);
    assert.deepStrictEqual(calls[0]?.auth, {
      type: "kamicode-pairing",
      credential: "auto-issued-harness-token",
      required: true,
    });
    assert.equal(calls[0]?.timeoutMs, 60_000);
  });

  it("returns a friendly error when the model omits the URL", async () => {
    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        rawArguments: {
          url: " ",
          actions: [{ type: "screenshot", label: "missing-url" }],
        },
      }),
    );

    assert.equal(response.success, false);
    assert.match(readInputText(response), /Missing test URL/);
  });

  it("does not let the model request KamiCode auth when the runtime cannot issue it", async () => {
    let called = false;
    const runner: BrowserHarnessRunner = async (input) => {
      called = true;
      return makeRunResult(input);
    };

    const response = await Effect.runPromise(
      runBrowserHarnessDynamicTool({
        cwd: "C:\\project",
        runHarness: runner,
        rawArguments: {
          url: "http://127.0.0.1:5733",
          auth: { type: "kamicode-pairing" },
          actions: [{ type: "screenshot", label: "chat-shell" }],
        },
      }),
    );

    assert.equal(response.success, false);
    assert.equal(called, false);
    assert.match(readInputText(response), /cannot issue a harness credential/);
  });
});
