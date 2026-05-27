import {
  runBrowserHarness,
  type BrowserHarnessRunInput,
  type BrowserHarnessRunResult,
  type BrowserHarnessStatus,
} from "./browserHarness.ts";

export type EvidenceRunnerKind = "playwright" | "computer-use" | "hybrid";
export type EvidenceRunStatus = "pass" | "fail" | "blocked" | "error";

export interface EvidenceArtifactPaths {
  readonly trace?: string | undefined;
  readonly screenshots: ReadonlyArray<string>;
  readonly video?: string | undefined;
  readonly consoleLog?: string | undefined;
  readonly networkLog?: string | undefined;
  readonly storageState?: string | undefined;
  readonly summary?: string | undefined;
  readonly markdown?: string | undefined;
}

export interface EvidenceScreenshot {
  readonly label: string;
  readonly path: string;
}

export interface EvidenceVideo {
  readonly label: string;
  readonly path: string;
}

export interface EvidenceStep {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly durationMs: number;
  readonly errorMessage?: string | undefined;
}

export interface EvidenceObservation {
  readonly stepId: string;
  readonly url: string;
  readonly title?: string | undefined;
  readonly screenshotPath?: string | undefined;
  readonly domSummary?: string | undefined;
  readonly visibleTextSample: ReadonlyArray<string>;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly networkFailures: ReadonlyArray<string>;
  readonly timing?: {
    readonly actionStartedAt: string;
    readonly actionEndedAt: string;
    readonly durationMs: number;
  };
}

export interface EvidenceRunResult {
  readonly runner: EvidenceRunnerKind;
  readonly runId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly status: EvidenceRunStatus;
  readonly success: boolean;
  readonly goal: string | null;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly evidenceSummary: string;
  readonly outputSummary?: string | undefined;
  readonly artifactsDir: string;
  readonly artifactPaths: EvidenceArtifactPaths;
  readonly screenshots: ReadonlyArray<EvidenceScreenshot>;
  readonly videos: ReadonlyArray<EvidenceVideo>;
  readonly observations: ReadonlyArray<EvidenceObservation>;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly networkFailures: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<EvidenceStep>;
  readonly summaryPath?: string | undefined;
  readonly markdownPath?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface EvidenceRunner<Input> {
  readonly kind: EvidenceRunnerKind;
  readonly run: (input: Input) => Promise<EvidenceRunResult>;
}

export type BrowserHarnessRunner = (
  input: BrowserHarnessRunInput,
) => Promise<BrowserHarnessRunResult>;

export function browserHarnessStatusToEvidenceStatus(
  status: BrowserHarnessStatus,
): EvidenceRunStatus {
  switch (status) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    case "blocked":
      return "blocked";
    case "error":
      return "error";
  }
}

export function browserHarnessResultToEvidenceRunResult(
  result: BrowserHarnessRunResult,
): EvidenceRunResult {
  const consoleErrors = [
    ...result.consoleMessages
      .filter((message) => message.type === "error" || message.type === "warning")
      .map((message) => `[${message.type}] ${message.text}`),
    ...result.pageErrors.map((message) => `[pageerror] ${message}`),
  ];

  return {
    runner: "playwright",
    runId: result.runId,
    projectId: result.projectId,
    environmentId: result.environmentId,
    status: browserHarnessStatusToEvidenceStatus(result.status),
    success: result.success,
    goal: result.goal,
    url: result.url,
    finalUrl: result.finalUrl,
    title: result.title,
    evidenceSummary: result.evidenceSummary,
    outputSummary: result.doneSummary,
    artifactsDir: result.artifactsDir,
    artifactPaths: {
      trace: result.artifactPaths.trace,
      screenshots: result.artifactPaths.screenshots,
      consoleLog: result.artifactPaths.consoleLog,
      networkLog: result.artifactPaths.networkLog,
      storageState: result.artifactPaths.storageState,
      summary: result.artifactPaths.summary,
      markdown: result.artifactPaths.markdown,
    },
    screenshots: result.screenshots,
    videos: [],
    observations: result.observations.map((observation) => ({
      stepId: observation.stepId,
      url: observation.url,
      ...(observation.title ? { title: observation.title } : {}),
      ...(observation.screenshotId ? { screenshotPath: observation.screenshotId } : {}),
      domSummary: observation.domSummary,
      visibleTextSample: observation.visibleTextSample,
      consoleErrors: observation.consoleErrors,
      networkFailures: observation.networkFailures,
      timing: observation.timing,
    })),
    consoleErrors,
    networkFailures: result.failedRequests,
    steps: result.steps,
    summaryPath: result.summaryPath,
    markdownPath: result.markdownPath,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
  };
}

export function createPlaywrightEvidenceRunner(input?: {
  readonly runHarness?: BrowserHarnessRunner | undefined;
}): EvidenceRunner<BrowserHarnessRunInput> {
  const runHarness = input?.runHarness ?? runBrowserHarness;
  return {
    kind: "playwright",
    run: async (runInput) => browserHarnessResultToEvidenceRunResult(await runHarness(runInput)),
  };
}
