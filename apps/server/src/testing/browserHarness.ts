// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalDate:off globalTimers:off
import crypto from "node:crypto";
import * as Fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type BrowserHarnessBrowser = "chromium" | "firefox" | "webkit";
export type BrowserHarnessStatus = "passed" | "failed" | "blocked" | "error";

export type TestHarnessAction =
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "click"; readonly selector?: string; readonly text?: string }
  | { readonly type: "type"; readonly selector?: string; readonly text: string }
  | { readonly type: "select"; readonly selector?: string; readonly value: string }
  | { readonly type: "wait"; readonly ms?: number; readonly text?: string }
  | {
      readonly type: "assert";
      readonly description: string;
      readonly selector?: string;
      readonly text?: string;
      readonly urlIncludes?: string;
      readonly titleIncludes?: string;
    }
  | { readonly type: "screenshot"; readonly label?: string }
  | { readonly type: "scroll"; readonly direction: "up" | "down" }
  | { readonly type: "done"; readonly summary: string; readonly result: "pass" | "fail" | "blocked" };

export interface TestHarnessObservation {
  readonly runId: string;
  readonly stepId: string;
  readonly url: string;
  readonly title?: string;
  readonly screenshotId?: string;
  readonly domSummary: string;
  readonly visibleTextSample: ReadonlyArray<string>;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly networkFailures: ReadonlyArray<string>;
  readonly timing: {
    readonly actionStartedAt: string;
    readonly actionEndedAt: string;
    readonly durationMs: number;
  };
}

export interface BrowserHarnessRunInput {
  readonly url: string;
  readonly goal?: string | undefined;
  readonly cwd?: string | undefined;
  readonly stateDir?: string | undefined;
  readonly projectId?: string | undefined;
  readonly environmentId?: string | undefined;
  readonly artifactsDir?: string | undefined;
  readonly storageStatePath?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly actions?: ReadonlyArray<TestHarnessAction> | undefined;
  readonly browser?: BrowserHarnessBrowser | undefined;
  readonly headless?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly lingerMs?: number | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
}

export interface BrowserHarnessStep {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly durationMs: number;
  readonly errorMessage?: string;
}

export interface BrowserHarnessScreenshot {
  readonly label: string;
  readonly path: string;
}

export interface BrowserHarnessConsoleMessage {
  readonly type: string;
  readonly text: string;
  readonly location?: {
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
}

export interface BrowserHarnessArtifactPaths {
  readonly trace: string;
  readonly screenshots: ReadonlyArray<string>;
  readonly consoleLog: string;
  readonly networkLog: string;
  readonly storageState: string;
  readonly summary: string;
  readonly markdown: string;
}

export interface BrowserHarnessRunResult {
  readonly runId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly status: BrowserHarnessStatus;
  readonly success: boolean;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly goal: string | null;
  readonly artifactsDir: string;
  readonly summaryPath: string;
  readonly markdownPath: string;
  readonly tracePath: string;
  readonly consolePath: string;
  readonly networkPath: string;
  readonly storageStatePath: string;
  readonly artifactPaths: BrowserHarnessArtifactPaths;
  readonly evidenceSummary: string;
  readonly screenshots: ReadonlyArray<BrowserHarnessScreenshot>;
  readonly steps: ReadonlyArray<BrowserHarnessStep>;
  readonly observations: ReadonlyArray<TestHarnessObservation>;
  readonly consoleMessages: ReadonlyArray<BrowserHarnessConsoleMessage>;
  readonly pageErrors: ReadonlyArray<string>;
  readonly failedRequests: ReadonlyArray<string>;
  readonly doneSummary?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface BrowserHarnessRunPaths {
  readonly cwd: string;
  readonly runId: string;
  readonly projectKey: string;
  readonly environmentId: string;
  readonly stateRoot: string;
  readonly projectStateDir: string;
  readonly artifactsDir: string;
  readonly screenshotsDir: string;
  readonly summaryPath: string;
  readonly markdownPath: string;
  readonly tracePath: string;
  readonly consolePath: string;
  readonly networkPath: string;
  readonly storageStatePath: string;
  readonly scriptPath: string | null;
}

export interface BrowserHarnessScriptContext {
  readonly page: PlaywrightPage;
  readonly context: PlaywrightBrowserContext;
  readonly artifactsDir: string;
  readonly input: BrowserHarnessRunInput;
  readonly step: <A>(name: string, run: () => Promise<A>) => Promise<A>;
  readonly screenshot: (label: string) => Promise<string>;
}

type BrowserHarnessScript = (context: BrowserHarnessScriptContext) => Promise<void> | void;

interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
  location(): {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
}

interface PlaywrightRequest {
  method(): string;
  url(): string;
  failure(): { errorText: string } | null;
}

interface PlaywrightKeyboard {
  type(text: string): Promise<void>;
}

interface PlaywrightMouse {
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

interface PlaywrightLocator {
  first(): PlaywrightLocator;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible"; timeout?: number }): Promise<void>;
  innerText(options?: { timeout?: number }): Promise<string>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): PlaywrightLocator;
  getByText(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  keyboard: PlaywrightKeyboard;
  mouse: PlaywrightMouse;
  close(): Promise<void>;
  on(event: "console", handler: (message: PlaywrightConsoleMessage) => void): void;
  on(event: "pageerror", handler: (error: unknown) => void): void;
  on(event: "requestfailed", handler: (request: PlaywrightRequest) => void): void;
}

interface PlaywrightTracing {
  start(options: { screenshots: boolean; snapshots: boolean; sources: boolean }): Promise<void>;
  stop(options: { path: string }): Promise<void>;
}

interface PlaywrightBrowserContext {
  tracing: PlaywrightTracing;
  setDefaultTimeout(timeoutMs: number): void;
  setDefaultNavigationTimeout(timeoutMs: number): void;
  newPage(): Promise<PlaywrightPage>;
  storageState(options: { path: string }): Promise<unknown>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options: {
    viewport: { readonly width: number; readonly height: number };
    acceptDownloads: boolean;
    userAgent: string;
    storageState?: string;
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightBrowserType {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}

type PlaywrightModule = Record<BrowserHarnessBrowser, PlaywrightBrowserType>;

const DEFAULT_BROWSER: BrowserHarnessBrowser = "chromium";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_LINGER_MS = 0;
const DEFAULT_VIEWPORT = { width: 1440, height: 960 } as const;
const DEFAULT_ENVIRONMENT_ID = "default";
const FALLBACK_STATE_ROOT = path.join(os.tmpdir(), "kamicode");

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function sanitizeBrowserHarnessSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : "run";
}

export function createBrowserHarnessRunId(input?: {
  readonly now?: Date;
  readonly randomId?: string;
}): string {
  const now = input?.now ?? new Date();
  const randomId = input?.randomId ?? crypto.randomUUID();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${sanitizeBrowserHarnessSegment(randomId).slice(0, 8)}`;
}

export function createBrowserHarnessProjectKey(input: {
  readonly cwd: string;
  readonly projectId?: string | undefined;
}): string {
  const explicitProjectId = normalizeOptionalText(input.projectId);
  if (explicitProjectId) {
    return sanitizeBrowserHarnessSegment(explicitProjectId);
  }

  const cwdHash = crypto
    .createHash("sha256")
    .update(path.resolve(input.cwd).toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return `cwd-${cwdHash}`;
}

function resolveFromCwd(cwd: string, maybeRelativePath: string): string {
  return path.isAbsolute(maybeRelativePath)
    ? path.normalize(maybeRelativePath)
    : path.resolve(cwd, maybeRelativePath);
}

export function resolveBrowserHarnessRunPaths(input: BrowserHarnessRunInput): BrowserHarnessRunPaths {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const runId = createBrowserHarnessRunId();
  const stateRoot = resolveFromCwd(cwd, normalizeOptionalText(input.stateDir) ?? FALLBACK_STATE_ROOT);
  const projectKey = createBrowserHarnessProjectKey({ cwd, projectId: input.projectId });
  const environmentId = sanitizeBrowserHarnessSegment(
    normalizeOptionalText(input.environmentId) ?? DEFAULT_ENVIRONMENT_ID,
  );
  const projectStateDir = path.join(stateRoot, "test-harness", "projects", projectKey);
  const artifactsDirOverride = normalizeOptionalText(input.artifactsDir);
  const artifactsRoot = artifactsDirOverride
    ? resolveFromCwd(cwd, artifactsDirOverride)
    : path.join(projectStateDir, "runs");
  const artifactsDir = path.join(artifactsRoot, runId);
  const storageStatePathOverride = normalizeOptionalText(input.storageStatePath);
  const storageStatePath = storageStatePathOverride
    ? resolveFromCwd(cwd, storageStatePathOverride)
    : path.join(projectStateDir, "default.storageState.json");
  const scriptPath = normalizeOptionalText(input.scriptPath);

  return {
    cwd,
    runId,
    projectKey,
    environmentId,
    stateRoot,
    projectStateDir,
    artifactsDir,
    screenshotsDir: path.join(artifactsDir, "screenshots"),
    summaryPath: path.join(artifactsDir, "summary.json"),
    markdownPath: path.join(artifactsDir, "summary.md"),
    tracePath: path.join(artifactsDir, "trace.zip"),
    consolePath: path.join(artifactsDir, "console.json"),
    networkPath: path.join(artifactsDir, "network.json"),
    storageStatePath,
    scriptPath: scriptPath ? resolveFromCwd(cwd, scriptPath) : null,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await Fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBunRuntime(): boolean {
  return "Bun" in (globalThis as Record<string, unknown>);
}

async function loadBrowserHarnessScript(scriptPath: string): Promise<BrowserHarnessScript> {
  const scriptUrl = `${pathToFileURL(scriptPath).href}?t=${Date.now()}`;
  const module = (await import(scriptUrl)) as {
    readonly default?: unknown;
    readonly run?: unknown;
  };
  const script = typeof module.default === "function" ? module.default : module.run;
  if (typeof script !== "function") {
    throw new Error(`Harness script '${scriptPath}' must export a default function or run().`);
  }
  return script as BrowserHarnessScript;
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await Fs.mkdir(path.dirname(pathname), { recursive: true });
  await Fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function actionStepName(action: TestHarnessAction): string {
  switch (action.type) {
    case "navigate":
      return `Navigate to ${action.url}`;
    case "click":
      return action.selector
        ? `Click ${action.selector}`
        : `Click text "${truncateText(action.text ?? "", 80)}"`;
    case "type":
      return action.selector ? `Type into ${action.selector}` : "Type with keyboard";
    case "select":
      return `Select ${action.value} in ${action.selector ?? "unspecified selector"}`;
    case "wait":
      return action.text
        ? `Wait for text "${truncateText(action.text, 80)}"`
        : `Wait ${action.ms ?? 1000}ms`;
    case "assert":
      return `Assert ${action.description}`;
    case "screenshot":
      return `Capture screenshot${action.label ? ` ${action.label}` : ""}`;
    case "scroll":
      return `Scroll ${action.direction}`;
    case "done":
      return `Finish test as ${action.result}`;
  }
}

function actionStepId(index: number, action: TestHarnessAction): string {
  return `${String(index + 1).padStart(2, "0")}-${sanitizeBrowserHarnessSegment(action.type)}`;
}

function collectConsoleErrors(input: {
  readonly consoleMessages: ReadonlyArray<BrowserHarnessConsoleMessage>;
  readonly pageErrors: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  return [
    ...input.consoleMessages
      .filter((message) => message.type === "error" || message.type === "warning")
      .map((message) => `[${message.type}] ${message.text}`),
    ...input.pageErrors.map((message) => `[pageerror] ${message}`),
  ];
}

function statusFromDoneResult(result: "pass" | "fail" | "blocked"): BrowserHarnessStatus {
  switch (result) {
    case "pass":
      return "passed";
    case "fail":
      return "failed";
    case "blocked":
      return "blocked";
  }
}

function getActionLocator(page: PlaywrightPage, action: { selector?: string; text?: string }) {
  const selector = normalizeOptionalText(action.selector);
  if (selector) {
    return page.locator(selector).first();
  }

  const text = normalizeOptionalText(action.text);
  if (text) {
    return page.getByText(text, { exact: false }).first();
  }

  throw new Error("Action requires either selector or text.");
}

async function executeAssertAction(input: {
  readonly action: Extract<TestHarnessAction, { readonly type: "assert" }>;
  readonly page: PlaywrightPage;
  readonly timeoutMs: number;
}): Promise<void> {
  const { action, page, timeoutMs } = input;
  let checked = false;

  const selector = normalizeOptionalText(action.selector);
  if (selector) {
    checked = true;
    await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
  }

  const text = normalizeOptionalText(action.text);
  if (text) {
    checked = true;
    await page.getByText(text, { exact: false }).first().waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
  }

  const urlIncludes = normalizeOptionalText(action.urlIncludes);
  if (urlIncludes) {
    checked = true;
    const currentUrl = page.url();
    if (!currentUrl.includes(urlIncludes)) {
      throw new Error(
        `Assertion failed: expected URL to include '${urlIncludes}', got '${currentUrl}'.`,
      );
    }
  }

  const titleIncludes = normalizeOptionalText(action.titleIncludes);
  if (titleIncludes) {
    checked = true;
    const title = await page.title();
    if (!title.includes(titleIncludes)) {
      throw new Error(
        `Assertion failed: expected title to include '${titleIncludes}', got '${title}'.`,
      );
    }
  }

  if (!checked) {
    throw new Error(
      "Assert action requires at least one machine-checkable field: selector, text, urlIncludes, or titleIncludes.",
    );
  }
}

async function readVisibleTextSample(page: PlaywrightPage): Promise<ReadonlyArray<string>> {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 1_500 })
    .catch(() => "");
  return bodyText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25)
    .map((line) => truncateText(line, 180));
}

function buildDomSummary(input: {
  readonly url: string;
  readonly title: string | null;
  readonly visibleTextSample: ReadonlyArray<string>;
}): string {
  const firstLines = input.visibleTextSample.slice(0, 5).join(" | ");
  return [
    `url=${input.url}`,
    `title=${input.title ?? "unknown"}`,
    `visibleTextLines=${input.visibleTextSample.length}`,
    `sample=${firstLines.length > 0 ? firstLines : "none"}`,
  ].join("; ");
}

async function executeHarnessAction(input: {
  readonly action: TestHarnessAction;
  readonly page: PlaywrightPage;
  readonly timeoutMs: number;
}): Promise<{ readonly status?: BrowserHarnessStatus; readonly summary?: string }> {
  const { action, page, timeoutMs } = input;
  switch (action.type) {
    case "navigate":
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      return {};
    case "click":
      await getActionLocator(page, action).click({ timeout: timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      return {};
    case "type":
      const typeSelector = normalizeOptionalText(action.selector);
      if (typeSelector) {
        await page.locator(typeSelector).first().fill(action.text, { timeout: timeoutMs });
      } else {
        await page.keyboard.type(action.text);
      }
      return {};
    case "select":
      const selectSelector = normalizeOptionalText(action.selector);
      if (!selectSelector) {
        throw new Error("Select action requires a selector.");
      }
      await page.locator(selectSelector).first().selectOption(action.value, { timeout: timeoutMs });
      return {};
    case "wait":
      const waitText = normalizeOptionalText(action.text);
      if (waitText) {
        await page.getByText(waitText, { exact: false }).first().waitFor({
          state: "visible",
          timeout: timeoutMs,
        });
      } else {
        await page.waitForTimeout(action.ms ?? 1000);
      }
      return {};
    case "assert":
      await executeAssertAction({ action, page, timeoutMs });
      return {};
    case "screenshot":
      return {};
    case "scroll":
      await page.mouse.wheel(0, action.direction === "down" ? 900 : -900);
      await page.waitForTimeout(250);
      return {};
    case "done":
      return { status: statusFromDoneResult(action.result), summary: action.summary };
  }
}

export function formatBrowserHarnessMarkdown(result: BrowserHarnessRunResult): string {
  const lines = [
    "# KamiCode Browser Test Run",
    "",
    `Status: ${result.status.toUpperCase()}`,
    `URL: ${result.url}`,
    `Final URL: ${result.finalUrl ?? "unknown"}`,
    `Title: ${result.title ?? "unknown"}`,
    `Goal: ${result.goal ?? "not specified"}`,
    `Duration: ${result.durationMs}ms`,
    "",
    "## Evidence",
    "",
    result.evidenceSummary,
    "",
    "## Artifacts",
    "",
    `- Summary: ${result.summaryPath}`,
    `- Trace: ${result.tracePath}`,
    `- Console: ${result.consolePath}`,
    `- Network: ${result.networkPath}`,
    `- Storage state: ${result.storageStatePath}`,
    ...result.screenshots.map((screenshot) => `- Screenshot (${screenshot.label}): ${screenshot.path}`),
    "",
    "## Steps",
    "",
    ...(result.steps.length > 0
      ? result.steps.map(
          (step) =>
            `- ${step.status.toUpperCase()} ${step.name} (${step.durationMs}ms)${
              step.errorMessage ? `: ${step.errorMessage}` : ""
            }`,
        )
      : ["- No scripted steps were recorded."]),
  ];

  if (result.observations.length > 0) {
    lines.push(
      "",
      "## Observations",
      "",
      ...result.observations.map(
        (observation) =>
          `- ${observation.stepId}: ${observation.domSummary}${
            observation.screenshotId ? `; screenshot=${observation.screenshotId}` : ""
          }`,
      ),
    );
  }
  if (result.doneSummary) {
    lines.push("", "## Done Summary", "", result.doneSummary);
  }
  if (result.errorMessage) {
    lines.push("", "## Error", "", result.errorMessage);
  }
  if (result.pageErrors.length > 0) {
    lines.push("", "## Page Errors", "", ...result.pageErrors.map((entry) => `- ${entry}`));
  }
  if (result.failedRequests.length > 0) {
    lines.push(
      "",
      "## Failed Requests",
      "",
      ...result.failedRequests.map((entry) => `- ${entry}`),
    );
  }
  if (result.consoleMessages.length > 0) {
    lines.push(
      "",
      "## Console",
      "",
      ...result.consoleMessages.slice(-50).map((entry) => `- [${entry.type}] ${entry.text}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatBrowserHarnessCliOutput(result: BrowserHarnessRunResult): string {
  const firstScreenshot = result.screenshots.at(-1)?.path;
  return [
    `Browser test ${result.status.toUpperCase()}`,
    `Artifacts: ${result.artifactsDir}`,
    `Summary: ${result.summaryPath}`,
    `Trace: ${result.tracePath}`,
    `Console: ${result.consolePath}`,
    `Network: ${result.networkPath}`,
    `Storage state: ${result.storageStatePath}`,
    ...(firstScreenshot ? [`Screenshot: ${firstScreenshot}`] : []),
    ...(result.errorMessage ? [`Error: ${result.errorMessage}`] : []),
  ].join("\n");
}

export async function runBrowserHarness(input: BrowserHarnessRunInput): Promise<BrowserHarnessRunResult> {
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const paths = resolveBrowserHarnessRunPaths(input);
  const browserName = input.browser ?? DEFAULT_BROWSER;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lingerMs = input.lingerMs ?? DEFAULT_LINGER_MS;
  const viewport = input.viewport ?? DEFAULT_VIEWPORT;
  const goal = normalizeOptionalText(input.goal) ?? null;
  const screenshots: BrowserHarnessScreenshot[] = [];
  const steps: BrowserHarnessStep[] = [];
  const observations: TestHarnessObservation[] = [];
  const consoleMessages: BrowserHarnessConsoleMessage[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  let status: BrowserHarnessStatus = "passed";
  let doneSummary: string | undefined;
  let error: string | undefined;
  let browser: PlaywrightBrowser | null = null;
  let context: PlaywrightBrowserContext | null = null;
  let page: PlaywrightPage | null = null;
  let finalUrl: string | null = null;
  let title: string | null = null;

  await Fs.mkdir(paths.artifactsDir, { recursive: true });
  await Fs.mkdir(paths.screenshotsDir, { recursive: true });
  await Fs.mkdir(path.dirname(paths.storageStatePath), { recursive: true });

  const screenshot = async (label: string): Promise<string> => {
    if (!page) {
      throw new Error("Cannot capture screenshot before a page is available.");
    }
    const screenshotPath = path.join(
      paths.screenshotsDir,
      `${String(screenshots.length + 1).padStart(2, "0")}-${sanitizeBrowserHarnessSegment(label)}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push({ label, path: screenshotPath });
    return screenshotPath;
  };

  const observePage = async (input: {
    readonly stepId: string;
    readonly screenshotLabel: string;
    readonly actionStartedAt: Date;
    readonly actionEndedAt: Date;
  }): Promise<TestHarnessObservation> => {
    if (!page) {
      throw new Error("Cannot observe page before it is available.");
    }

    const screenshotPath = await screenshot(input.screenshotLabel).catch(() => undefined);
    const observedTitle = await page.title().catch(() => null);
    const observedUrl = page.url();
    const visibleTextSample = await readVisibleTextSample(page);
    const observation: TestHarnessObservation = {
      runId: paths.runId,
      stepId: input.stepId,
      url: observedUrl,
      ...(observedTitle ? { title: observedTitle } : {}),
      ...(screenshotPath ? { screenshotId: screenshotPath } : {}),
      domSummary: buildDomSummary({
        url: observedUrl,
        title: observedTitle,
        visibleTextSample,
      }),
      visibleTextSample,
      consoleErrors: collectConsoleErrors({ consoleMessages, pageErrors }),
      networkFailures: [...failedRequests],
      timing: {
        actionStartedAt: input.actionStartedAt.toISOString(),
        actionEndedAt: input.actionEndedAt.toISOString(),
        durationMs: input.actionEndedAt.getTime() - input.actionStartedAt.getTime(),
      },
    };
    observations.push(observation);
    return observation;
  };

  const step = async <A>(name: string, run: () => Promise<A>): Promise<A> => {
    const started = Date.now();
    try {
      const value = await run();
      steps.push({ name, status: "passed", durationMs: Date.now() - started });
      return value;
    } catch (stepError) {
      steps.push({
        name,
        status: "failed",
        durationMs: Date.now() - started,
        errorMessage: errorMessage(stepError),
      });
      throw stepError;
    }
  };

  try {
    if (isBunRuntime()) {
      throw new Error(
        "KamiCode browser harness must run under Node because Playwright hangs under Bun in this repo. Use the built `t3` CLI or `node apps/server/src/bin.ts test browser ...`.",
      );
    }

    const playwrightPackage = "playwright";
    const playwright = (await import(playwrightPackage)) as PlaywrightModule;
    const browserType = playwright[browserName];
    if (!browserType) {
      throw new Error(`Unsupported browser '${browserName}'.`);
    }

    browser = await browserType.launch({ headless: input.headless ?? false });
    context = await browser.newContext({
      viewport,
      acceptDownloads: true,
      userAgent: "KamiCode-TestHarness/1.0",
      ...((await pathExists(paths.storageStatePath))
        ? { storageState: paths.storageStatePath }
        : {}),
    });
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    page = await context.newPage();
    page.on("console", (message) => {
      const location = message.location();
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location,
      });
    });
    page.on("pageerror", (pageError) => {
      pageErrors.push(errorMessage(pageError));
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`.trim());
    });

    const openStartedAt = new Date();
    await step("Open target URL", async () => {
      await page?.goto(input.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page?.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    });
    await observePage({
      stepId: "open-target-url",
      screenshotLabel: "initial",
      actionStartedAt: openStartedAt,
      actionEndedAt: new Date(),
    });

    for (const [index, action] of (input.actions ?? []).entries()) {
      const started = new Date();
      const actionResult = await step(actionStepName(action), async () => {
        if (!page) {
          throw new Error("Browser page was not initialized.");
        }
        return executeHarnessAction({ action, page, timeoutMs });
      });
      const ended = new Date();
      if (actionResult.status) {
        status = actionResult.status;
      }
      if (actionResult.summary) {
        doneSummary = actionResult.summary;
      }
      await observePage({
        stepId: actionStepId(index, action),
        screenshotLabel: action.type === "screenshot" ? (action.label ?? "screenshot") : action.type,
        actionStartedAt: started,
        actionEndedAt: ended,
      });
      if (action.type === "done") {
        break;
      }
    }

    if (paths.scriptPath) {
      const script = await loadBrowserHarnessScript(paths.scriptPath);
      await step(`Run script ${path.basename(paths.scriptPath)}`, async () => {
        if (!page || !context) {
          throw new Error("Browser context was not initialized.");
        }
        await script({
          page,
          context,
          artifactsDir: paths.artifactsDir,
          input,
          step,
          screenshot,
        });
      });
    }

    finalUrl = page.url();
    title = await page.title().catch(() => null);
    await observePage({
      stepId: "finish",
      screenshotLabel: "final",
      actionStartedAt: new Date(),
      actionEndedAt: new Date(),
    });
  } catch (runError) {
    status = "failed";
    error = errorMessage(runError);
    if (page) {
      await observePage({
        stepId: "failure",
        screenshotLabel: "failure",
        actionStartedAt: new Date(),
        actionEndedAt: new Date(),
      }).catch(() => {});
      finalUrl = finalUrl ?? page.url();
      title = title ?? (await page.title().catch(() => null));
    }
  } finally {
    if (context) {
      await context.storageState({ path: paths.storageStatePath }).catch(() => {});
      await context.tracing.stop({ path: paths.tracePath }).catch(() => {
        status = status === "passed" ? "error" : status;
      });
    }
    if (lingerMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, lingerMs));
    }
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const completedAtDate = new Date();
  const artifactPaths: BrowserHarnessArtifactPaths = {
    trace: paths.tracePath,
    screenshots: screenshots.map((screenshot) => screenshot.path),
    consoleLog: paths.consolePath,
    networkLog: paths.networkPath,
    storageState: paths.storageStatePath,
    summary: paths.summaryPath,
    markdown: paths.markdownPath,
  };
  const consoleErrors = collectConsoleErrors({ consoleMessages, pageErrors });
  const evidenceSummary = [
    `${observations.length} observation(s), ${screenshots.length} screenshot(s), trace recorded at ${paths.tracePath}.`,
    `${consoleErrors.length} console/page error(s), ${failedRequests.length} failed network request(s).`,
    finalUrl ? `Final URL: ${finalUrl}.` : "Final URL unknown.",
  ].join(" ");
  const result: BrowserHarnessRunResult = {
    runId: paths.runId,
    projectId: paths.projectKey,
    environmentId: paths.environmentId,
    status,
    success: status === "passed",
    url: input.url,
    finalUrl,
    title,
    goal,
    artifactsDir: paths.artifactsDir,
    summaryPath: paths.summaryPath,
    markdownPath: paths.markdownPath,
    tracePath: paths.tracePath,
    consolePath: paths.consolePath,
    networkPath: paths.networkPath,
    storageStatePath: paths.storageStatePath,
    artifactPaths,
    evidenceSummary,
    screenshots,
    steps,
    observations,
    consoleMessages,
    pageErrors,
    failedRequests,
    ...(doneSummary ? { doneSummary } : {}),
    ...(error ? { errorMessage: error } : {}),
    startedAt,
    completedAt: completedAtDate.toISOString(),
    durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
  };

  await writeJson(paths.consolePath, {
    messages: consoleMessages,
    pageErrors,
    errors: consoleErrors,
  });
  await writeJson(paths.networkPath, {
    failedRequests,
  });
  await writeJson(paths.summaryPath, result);
  await Fs.writeFile(paths.markdownPath, formatBrowserHarnessMarkdown(result), "utf8");

  return result;
}
