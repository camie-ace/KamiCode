import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  browserHarnessResultToEvidenceRunResult,
  browserHarnessStatusToEvidenceStatus,
  createPlaywrightEvidenceRunner,
  type BrowserHarnessRunner,
} from "./evidenceRunner.ts";
import type { BrowserHarnessRunInput, BrowserHarnessRunResult } from "./browserHarness.ts";

function makeBrowserHarnessResult(input: BrowserHarnessRunInput): BrowserHarnessRunResult {
  return {
    runId: "run-1",
    projectId: input.projectId ?? "cwd-project",
    environmentId: input.environmentId ?? "default",
    status: "passed",
    success: true,
    url: input.url,
    finalUrl: `${input.url}/done`,
    title: "Done",
    goal: input.goal ?? null,
    artifactsDir: "C:\\state\\runs\\run-1",
    summaryPath: "C:\\state\\runs\\run-1\\summary.json",
    markdownPath: "C:\\state\\runs\\run-1\\summary.md",
    tracePath: "C:\\state\\runs\\run-1\\trace.zip",
    consolePath: "C:\\state\\runs\\run-1\\console.json",
    networkPath: "C:\\state\\runs\\run-1\\network.json",
    storageStatePath: "C:\\state\\default.storageState.json",
    artifactPaths: {
      trace: "C:\\state\\runs\\run-1\\trace.zip",
      screenshots: ["C:\\state\\runs\\run-1\\screenshots\\01.png"],
      consoleLog: "C:\\state\\runs\\run-1\\console.json",
      networkLog: "C:\\state\\runs\\run-1\\network.json",
      storageState: "C:\\state\\default.storageState.json",
      summary: "C:\\state\\runs\\run-1\\summary.json",
      markdown: "C:\\state\\runs\\run-1\\summary.md",
    },
    evidenceSummary: "Evidence captured.",
    screenshots: [{ label: "final", path: "C:\\state\\runs\\run-1\\screenshots\\01.png" }],
    steps: [{ name: "Open", status: "passed", durationMs: 10 }],
    observations: [
      {
        runId: "run-1",
        stepId: "finish",
        url: `${input.url}/done`,
        title: "Done",
        screenshotId: "C:\\state\\runs\\run-1\\screenshots\\01.png",
        domSummary: "url=http://localhost:3000/done; title=Done",
        visibleTextSample: ["Done"],
        consoleErrors: ["[warning] noisy"],
        networkFailures: ["GET http://localhost:3000/missing 404"],
        timing: {
          actionStartedAt: "2026-05-26T00:00:00.000Z",
          actionEndedAt: "2026-05-26T00:00:00.010Z",
          durationMs: 10,
        },
      },
    ],
    consoleMessages: [{ type: "warning", text: "noisy" }],
    pageErrors: ["boom"],
    failedRequests: ["GET http://localhost:3000/missing 404"],
    doneSummary: "Feature works.",
    startedAt: "2026-05-26T00:00:00.000Z",
    completedAt: "2026-05-26T00:00:00.020Z",
    durationMs: 20,
  };
}

describe("evidenceRunner", () => {
  it("normalizes browser harness statuses", () => {
    NodeAssert.equal(browserHarnessStatusToEvidenceStatus("passed"), "pass");
    NodeAssert.equal(browserHarnessStatusToEvidenceStatus("failed"), "fail");
    NodeAssert.equal(browserHarnessStatusToEvidenceStatus("blocked"), "blocked");
    NodeAssert.equal(browserHarnessStatusToEvidenceStatus("error"), "error");
  });

  it("maps Playwright browser harness results to generic evidence results", () => {
    const result = browserHarnessResultToEvidenceRunResult(
      makeBrowserHarnessResult({
        url: "http://localhost:3000",
        goal: "prove completion",
      }),
    );

    NodeAssert.equal(result.runner, "playwright");
    NodeAssert.equal(result.status, "pass");
    NodeAssert.equal(result.outputSummary, "Feature works.");
    NodeAssert.equal(result.artifactPaths.trace?.endsWith("trace.zip"), true);
    NodeAssert.equal(result.artifactPaths.video, undefined);
    NodeAssert.equal(result.videos.length, 0);
    NodeAssert.equal(result.consoleErrors.length, 2);
    NodeAssert.equal(result.networkFailures[0], "GET http://localhost:3000/missing 404");
    NodeAssert.equal(result.observations[0]?.screenshotPath?.endsWith("01.png"), true);
  });

  it("keeps the current Playwright harness behind a runner boundary", async () => {
    const calls: BrowserHarnessRunInput[] = [];
    const runHarness: BrowserHarnessRunner = async (input) => {
      calls.push(input);
      return makeBrowserHarnessResult(input);
    };

    const runner = createPlaywrightEvidenceRunner({ runHarness });
    const result = await runner.run({
      url: "http://localhost:3000",
      projectId: "project-1",
    });

    NodeAssert.equal(runner.kind, "playwright");
    NodeAssert.equal(calls.length, 1);
    NodeAssert.equal(calls[0]?.projectId, "project-1");
    NodeAssert.equal(result.runner, "playwright");
  });
});
