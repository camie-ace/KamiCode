// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off cryptoRandomUUID:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import {
  PREVIEW_AUTOMATION_OPERATIONS,
  FILL_PREVIEW_VIEWPORT,
  type HostedPreviewControlInput,
  type HostedPreviewControlResult,
  type HostedPreviewFrameInput,
  type HostedPreviewFrameResult,
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  PreviewAutomationResizeInput,
  PreviewAutomationScrollInput,
  PreviewAutomationSetColorSchemeInput,
  PreviewAutomationTabTargetInput,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
  PreviewTabId,
  type PreviewAutomationActionEvent,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationHost,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewRenderedViewportSize,
  type PreviewCloseInput,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  ThreadId,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { BrowserContext, CDPSession, Locator, Page } from "playwright";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

const DEFAULT_VIEWPORT: PreviewRenderedViewportSize = { width: 1_280, height: 800 };
const MAX_HISTORY_ENTRIES = 200;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MIN_IDLE_TIMEOUT_MS = 30_000;
const IDLE_SWEEP_INTERVAL_MS = 30_000;
const HOSTED_FRAME_MAX_AGE_MS = 2_000;

export const HOSTED_PREVIEW_AUTOMATION_OPERATIONS = PREVIEW_AUTOMATION_OPERATIONS.filter(
  (operation) => operation !== "recordingStart" && operation !== "recordingStop",
);

class HostedPreviewAutomationError extends Error {
  readonly _tag: string;
  readonly detail?: unknown;

  constructor(tag: string, message: string, detail?: unknown) {
    super(message);
    this._tag = tag;
    this.detail = detail;
    this.name = tag;
  }
}

interface HostedTab {
  readonly tabId: PreviewTabId;
  readonly threadId: ThreadId;
  readonly page: Page;
  cdp: CDPSession | null;
  screencastActive: boolean;
  screencastStopTimer: ReturnType<typeof setTimeout> | null;
  viewportSetting: PreviewViewportSetting;
  colorScheme: "system" | "light" | "dark";
  loading: boolean;
  lastUsedAt: number;
  lastViewedAt: number | null;
  frameSequence: number;
  latestFrame: {
    readonly data: string;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly consoleEntries: Array<PreviewAutomationConsoleEntry>;
  readonly networkEntries: Array<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: Array<PreviewAutomationActionEvent>;
}

interface HostedPreviewLifecycle {
  readonly open: (input: {
    readonly threadId: ThreadId;
    readonly url?: string;
    readonly viewport?: PreviewViewportSetting;
    readonly reveal?: true;
  }) => Promise<PreviewSessionSnapshot>;
  readonly reportStatus: (input: {
    readonly threadId: ThreadId;
    readonly tabId: PreviewTabId;
    readonly navStatus: PreviewSessionSnapshot["navStatus"];
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
  }) => Promise<void>;
  readonly resize: (input: {
    readonly threadId: ThreadId;
    readonly tabId: PreviewTabId;
    readonly viewport: PreviewViewportSetting;
  }) => Promise<void>;
  readonly close: (input: {
    readonly threadId: ThreadId;
    readonly tabId: PreviewTabId;
  }) => Promise<void>;
}

export interface HostedPreviewAutomationControllerOptions {
  readonly profileDir: string;
  readonly maxTabs: number;
  readonly idleTimeoutMs: number;
  readonly now?: () => number;
  readonly lifecycle?: HostedPreviewLifecycle;
}

const boundedPush = <A>(entries: Array<A>, value: A): void => {
  entries.push(value);
  if (entries.length > MAX_HISTORY_ENTRIES) {
    entries.splice(0, entries.length - MAX_HISTORY_ENTRIES);
  }
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Unknown error";

const errorName = (cause: unknown): string => (cause instanceof Error ? cause.name : "");

const runtimeFailureDetail = (cause: unknown) => ({
  causeName: errorName(cause) || "UnknownError",
  causeMessage: errorMessage(cause).slice(0, 2_000),
});

const classifyFailure = (
  cause: unknown,
  operation: PreviewAutomationOperation,
): HostedPreviewAutomationError => {
  if (cause instanceof HostedPreviewAutomationError) return cause;
  const message = errorMessage(cause);
  if (errorName(cause) === "TimeoutError" || /timed out|timeout/i.test(message)) {
    return new HostedPreviewAutomationError(
      "PreviewAutomationTimeoutError",
      `Hosted browser ${operation} timed out.`,
    );
  }
  if (
    /invalid selector|unknown engine|unexpected token|not a valid selector|while parsing selector/i.test(
      message,
    )
  ) {
    return new HostedPreviewAutomationError(
      "PreviewAutomationInvalidSelectorError",
      `Hosted browser ${operation} received an invalid selector.`,
    );
  }
  if (/browser.*closed|context.*closed|target.*closed|executable doesn.t exist/i.test(message)) {
    return new HostedPreviewAutomationError(
      "PreviewAutomationUnavailableError",
      "The VPS-hosted Chromium runtime is unavailable.",
    );
  }
  return new HostedPreviewAutomationError(
    "PreviewAutomationExecutionError",
    `Hosted browser ${operation} failed.`,
  );
};

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(input);
  } catch {
    throw new HostedPreviewAutomationError(
      "PreviewAutomationExecutionError",
      "The hosted browser received invalid operation input.",
    );
  }
};

const resolveTargetUrl = (input: PreviewAutomationNavigateInput): string => {
  if (input.target?.kind === "environment-port") {
    const protocol = input.target.protocol ?? "http";
    const rawPath = input.target.path ?? "/";
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    return `${protocol}://127.0.0.1:${input.target.port}${path}`;
  }
  return normalizePreviewUrl(input.url ?? input.target!.url);
};

const renderedViewport = (page: Page): PreviewRenderedViewportSize =>
  page.viewportSize() ?? DEFAULT_VIEWPORT;

const locatorFromInput = (
  page: Page,
  input: {
    readonly locator?: string | undefined;
    readonly selector?: string | undefined;
  },
): Locator | null => {
  const selector = input.locator ?? input.selector;
  return selector === undefined ? null : page.locator(selector).first();
};

const isEditable = async (locator: Locator): Promise<boolean> =>
  await locator.evaluate((element) => {
    const tagName = element.tagName.toLowerCase();
    const contentEditable = element.getAttribute("contenteditable");
    if (contentEditable === "" || contentEditable === "true") return true;
    if (tagName === "textarea") return !element.hasAttribute("disabled");
    if (tagName !== "input" || element.hasAttribute("disabled")) return false;
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  });

const readInteractiveElements = async (
  page: Page,
): Promise<PreviewAutomationSnapshot["interactiveElements"]> =>
  await page.evaluate(`(() => {
    const limit = ${MAX_INTERACTIVE_ELEMENTS};
    const candidates = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,[role],[contenteditable="true"],[tabindex]'
    ));
    const cssEscape = (value) => globalThis.CSS.escape(value);
    const selectorFor = (element) => {
      if (element.id) return '#' + cssEscape(element.id);
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(' > ');
    };
    const implicitRole = (element) => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        return 'textbox';
      }
      return null;
    };
    return candidates
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .slice(0, limit)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const name = element.getAttribute('aria-label')
          || element.getAttribute('title')
          || element.getAttribute('placeholder')
          || element.value
          || element.innerText
          || '';
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || implicitRole(element),
          name: String(name).trim().slice(0, 500),
          selector: selectorFor(element),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
  })()`);

export class HostedPreviewAutomationController {
  private context: BrowserContext | null = null;
  private readonly tabs = new Map<PreviewTabId, HostedTab>();
  private readonly currentTabByThread = new Map<ThreadId, PreviewTabId>();
  private commandTail: Promise<void> = Promise.resolve();
  private readonly maxTabs: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private readonly options: HostedPreviewAutomationControllerOptions;

  constructor(options: HostedPreviewAutomationControllerOptions) {
    this.options = options;
    this.maxTabs = Math.max(1, Math.min(8, Math.trunc(options.maxTabs)));
    this.idleTimeoutMs = Math.max(MIN_IDLE_TIMEOUT_MS, Math.trunc(options.idleTimeoutMs));
    this.now = options.now ?? Date.now;
  }

  get tabCount(): number {
    return this.tabs.size;
  }

  get browserRunning(): boolean {
    return this.context !== null;
  }

  handle(request: PreviewAutomationRequest): Promise<unknown> {
    return this.exclusive(() => this.handleUnsafe(request));
  }

  openSession(snapshot: PreviewSessionSnapshot): Promise<void> {
    return this.exclusive(async () => {
      const tab = await this.ensureTab(
        ThreadId.make(snapshot.threadId),
        snapshot.tabId,
        snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
      );
      this.currentTabByThread.set(tab.threadId, tab.tabId);
      if (snapshot.navStatus._tag !== "Idle") {
        await this.navigatePage(tab, snapshot.navStatus.url, "load", 15_000);
      }
    });
  }

  resizeSession(input: {
    readonly threadId: ThreadId;
    readonly tabId: PreviewTabId;
    readonly viewport: PreviewViewportSetting;
  }): Promise<void> {
    return this.exclusive(async () => {
      const tab = this.requireSessionTab(input.threadId, input.tabId);
      const viewport = input.viewport._tag === "fill" ? DEFAULT_VIEWPORT : input.viewport;
      await tab.page.setViewportSize(viewport);
      tab.viewportSetting = input.viewport;
    });
  }

  refreshSession(input: {
    readonly threadId: ThreadId;
    readonly tabId: PreviewTabId;
  }): Promise<void> {
    return this.exclusive(async () => {
      const tab = this.requireSessionTab(input.threadId, input.tabId);
      tab.loading = true;
      try {
        await tab.page.reload({ waitUntil: "load", timeout: 15_000 });
      } finally {
        tab.loading = false;
      }
      await this.reportCurrentStatus(tab);
    });
  }

  closeSession(input: PreviewCloseInput): Promise<void> {
    return this.exclusive(async () => {
      const targets = input.tabId
        ? [this.tabs.get(input.tabId)].filter(
            (tab): tab is HostedTab => tab?.threadId === input.threadId,
          )
        : Array.from(this.tabs.values()).filter((tab) => tab.threadId === input.threadId);
      await Promise.all(targets.map((tab) => tab.page.close().catch(() => {})));
      this.removeClosedTabs();
    });
  }

  readFrame(input: HostedPreviewFrameInput): Promise<HostedPreviewFrameResult> {
    return this.exclusive(async () => {
      const tab = this.tabs.get(input.tabId);
      if (!tab || tab.threadId !== input.threadId || tab.page.isClosed()) {
        return {
          state: "not-found",
          sequence: 0,
          frame: null,
          url: null,
          title: null,
          loading: false,
          canGoBack: false,
          canGoForward: false,
          message: "The VPS browser tab is no longer available.",
        };
      }
      tab.lastUsedAt = this.now();
      tab.lastViewedAt = this.now();
      await this.startScreencast(tab);
      this.scheduleScreencastStop(tab);
      if (!tab.latestFrame) {
        const screenshot = await tab.page
          .screenshot({ type: "jpeg", quality: 72, animations: "disabled" })
          .catch(() => null);
        if (screenshot) {
          const viewport = renderedViewport(tab.page);
          tab.frameSequence += 1;
          tab.latestFrame = {
            data: screenshot.toString("base64"),
            width: viewport.width,
            height: viewport.height,
          };
        }
      }
      const navigation = await this.navigationState(tab);
      const includeFrame =
        tab.latestFrame !== null &&
        (input.afterSequence === undefined || input.afterSequence !== tab.frameSequence);
      return {
        state: tab.latestFrame ? "ready" : "pending",
        sequence: tab.frameSequence,
        frame:
          includeFrame && tab.latestFrame ? { mimeType: "image/jpeg", ...tab.latestFrame } : null,
        url: tab.page.url(),
        title: await tab.page.title().catch(() => null),
        loading: tab.loading,
        ...navigation,
      };
    });
  }

  control(input: HostedPreviewControlInput): Promise<HostedPreviewControlResult> {
    return this.exclusive(async () => {
      const tab = this.requireSessionTab(input.threadId, input.tabId);
      const action = input.action;
      tab.lastUsedAt = this.now();
      switch (action._tag) {
        case "pointerMove":
          await tab.page.mouse.move(action.x, action.y);
          break;
        case "pointerDown":
          await tab.page.mouse.move(action.x, action.y);
          await tab.page.mouse.down({ button: action.button });
          break;
        case "pointerUp":
          await tab.page.mouse.move(action.x, action.y);
          await tab.page.mouse.up({ button: action.button });
          break;
        case "pointerClick":
          await tab.page.mouse.click(action.x, action.y, {
            button: action.button,
            clickCount: action.clickCount ?? 1,
          });
          break;
        case "wheel":
          await tab.page.mouse.move(action.x, action.y);
          await tab.page.mouse.wheel(action.deltaX, action.deltaY);
          break;
        case "key":
          await tab.page.keyboard.press([...action.modifiers, action.key].join("+"));
          break;
        case "insertText":
          await tab.page.keyboard.insertText(action.text);
          break;
        case "history":
          tab.loading = true;
          try {
            if (action.direction === "back") {
              await tab.page.goBack({ waitUntil: "load", timeout: 15_000 });
            } else {
              await tab.page.goForward({ waitUntil: "load", timeout: 15_000 });
            }
          } finally {
            tab.loading = false;
          }
          await this.reportCurrentStatus(tab);
          break;
      }
      return { ok: true };
    });
  }

  sweepIdle(): Promise<void> {
    return this.exclusive(async () => {
      const cutoff = this.now() - this.idleTimeoutMs;
      const stale = Array.from(this.tabs.values()).filter((tab) => tab.lastUsedAt <= cutoff);
      await Promise.all(stale.map((tab) => tab.page.close().catch(() => {})));
      this.removeClosedTabs();
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      const context = this.context;
      this.context = null;
      const tabs = Array.from(this.tabs.values());
      for (const tab of tabs) {
        if (tab.screencastStopTimer) clearTimeout(tab.screencastStopTimer);
      }
      // Explicitly stop and detach active CDP sessions before closing the
      // persistent context. Chromium can otherwise keep its profile log
      // handle alive briefly after context.close(), preventing an immediate
      // service restart from reopening the same profile on Windows.
      await Promise.all(
        tabs.map(async (tab) => {
          if (!tab.cdp) return;
          if (tab.screencastActive) {
            await tab.cdp.send("Page.stopScreencast").catch(() => {});
          }
          await tab.cdp.detach().catch(() => {});
          tab.cdp = null;
          tab.screencastActive = false;
        }),
      );
      this.tabs.clear();
      this.currentTabByThread.clear();
      if (context) await context.close().catch(() => {});
    });
  }

  private exclusive<A>(run: () => Promise<A>): Promise<A> {
    const result = this.commandTail.then(run, run);
    this.commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    let context: BrowserContext;
    try {
      const playwrightPackage = "playwright";
      const playwright = await import(playwrightPackage);
      context = await playwright.chromium.launchPersistentContext(this.options.profileDir, {
        headless: true,
        viewport: DEFAULT_VIEWPORT,
        acceptDownloads: true,
        userAgent: "KamiCode-HostedBrowser/1.0",
        args: ["--disable-dev-shm-usage"],
      });
    } catch (cause) {
      throw new HostedPreviewAutomationError(
        "PreviewAutomationUnavailableError",
        "The VPS-hosted Chromium runtime could not start.",
        runtimeFailureDetail(cause),
      );
    }
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(15_000);
    for (const page of context.pages()) await page.close().catch(() => {});
    context.on("close", () => {
      if (this.context === context) this.context = null;
      for (const tab of this.tabs.values()) {
        if (tab.screencastStopTimer) clearTimeout(tab.screencastStopTimer);
      }
      this.tabs.clear();
      this.currentTabByThread.clear();
    });
    this.context = context;
    return context;
  }

  private async ensureTab(
    threadId: ThreadId,
    tabId: PreviewTabId,
    viewportSetting: PreviewViewportSetting,
  ): Promise<HostedTab> {
    const existing = this.tabs.get(tabId);
    if (existing) {
      if (existing.threadId !== threadId) {
        throw new HostedPreviewAutomationError(
          "PreviewAutomationTabNotFoundError",
          `Hosted browser tab ${tabId} belongs to another thread.`,
        );
      }
      existing.lastUsedAt = this.now();
      return existing;
    }
    if (this.tabs.size >= this.maxTabs) {
      throw new HostedPreviewAutomationError(
        "PreviewAutomationUnavailableError",
        `The VPS-hosted browser tab limit (${this.maxTabs}) has been reached. Reuse an existing tab or wait for idle cleanup.`,
      );
    }
    let page: Page;
    try {
      const context = await this.ensureContext();
      page = await context.newPage();
      const viewport = viewportSetting._tag === "fill" ? DEFAULT_VIEWPORT : viewportSetting;
      await page.setViewportSize(viewport);
    } catch (cause) {
      if (cause instanceof HostedPreviewAutomationError) throw cause;
      throw new HostedPreviewAutomationError(
        "PreviewAutomationUnavailableError",
        "The VPS-hosted Chromium runtime could not create a tab.",
        runtimeFailureDetail(cause),
      );
    }
    const tab: HostedTab = {
      tabId,
      threadId,
      page,
      cdp: null,
      screencastActive: false,
      screencastStopTimer: null,
      viewportSetting,
      colorScheme: "system",
      loading: false,
      lastUsedAt: this.now(),
      lastViewedAt: null,
      frameSequence: 0,
      latestFrame: null,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    };
    this.tabs.set(tabId, tab);
    await this.attachPage(tab);
    return tab;
  }

  private async attachPage(tab: HostedTab): Promise<void> {
    const { page } = tab;
    page.on("console", (entry) => {
      const location = entry.location();
      boundedPush(tab.consoleEntries, {
        level: entry.type(),
        text: entry.text().slice(0, 4_000),
        timestamp: new Date(this.now()).toISOString(),
        ...(location.url ? { source: location.url } : {}),
      });
    });
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        tab.loading = true;
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      boundedPush(tab.networkEntries, {
        url: response.url(),
        method: request.method(),
        status: response.status(),
        failed: false,
        timestamp: new Date(this.now()).toISOString(),
      });
    });
    page.on("requestfailed", (request) => {
      boundedPush(tab.networkEntries, {
        url: request.url(),
        method: request.method(),
        status: null,
        failed: true,
        errorText: request.failure()?.errorText ?? "Request failed",
        timestamp: new Date(this.now()).toISOString(),
      });
    });
    page.on("load", () => {
      tab.loading = false;
      if (page.url() !== "about:blank") void this.reportCurrentStatus(tab).catch(() => {});
    });
    page.on("close", () => this.removeTab(tab.tabId));
    try {
      const cdp = await page.context().newCDPSession(page);
      tab.cdp = cdp;
      cdp.on(
        "Page.screencastFrame",
        (event: { readonly data: string; readonly sessionId: number }) => {
          if (!this.tabs.has(tab.tabId)) return;
          const viewport = renderedViewport(tab.page);
          tab.frameSequence += 1;
          tab.latestFrame = {
            data: event.data,
            width: viewport.width,
            height: viewport.height,
          };
          void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
        },
      );
    } catch {
      tab.cdp = null;
      // readFrame falls back to a direct screenshot when screencast is absent.
    }
  }

  private removeTab(tabId: PreviewTabId): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.tabs.delete(tabId);
    if (this.currentTabByThread.get(tab.threadId) === tabId) {
      this.currentTabByThread.delete(tab.threadId);
    }
    if (tab.screencastStopTimer) clearTimeout(tab.screencastStopTimer);
    void tab.cdp?.detach().catch(() => {});
    void this.options.lifecycle
      ?.close({ threadId: tab.threadId, tabId: tab.tabId })
      .catch(() => {});
  }

  private removeClosedTabs(): void {
    for (const tab of this.tabs.values()) {
      if (tab.page.isClosed()) this.removeTab(tab.tabId);
    }
  }

  private async startScreencast(tab: HostedTab): Promise<void> {
    if (!tab.cdp || tab.screencastActive) return;
    try {
      await tab.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 72,
        everyNthFrame: 1,
      });
      tab.screencastActive = true;
    } catch {
      tab.cdp = null;
      tab.screencastActive = false;
    }
  }

  private scheduleScreencastStop(tab: HostedTab): void {
    if (tab.screencastStopTimer) clearTimeout(tab.screencastStopTimer);
    tab.screencastStopTimer = setTimeout(() => {
      void this.exclusive(async () => {
        tab.screencastStopTimer = null;
        if (this.tabs.get(tab.tabId) !== tab || !tab.cdp || !tab.screencastActive) return;
        if (tab.lastViewedAt !== null && this.now() - tab.lastViewedAt < HOSTED_FRAME_MAX_AGE_MS) {
          this.scheduleScreencastStop(tab);
          return;
        }
        await tab.cdp.send("Page.stopScreencast").catch(() => {});
        tab.screencastActive = false;
        // Force one fresh screenshot when a viewer returns in case Chromium
        // does not emit an immediate frame after screencast resumes.
        tab.latestFrame = null;
      });
    }, HOSTED_FRAME_MAX_AGE_MS);
  }

  private resolveTab(request: PreviewAutomationRequest): HostedTab | null {
    this.removeClosedTabs();
    const tabId = request.tabId ?? this.currentTabByThread.get(request.threadId);
    const tab = tabId === undefined ? undefined : this.tabs.get(tabId);
    if (!tab || tab.threadId !== request.threadId) return null;
    tab.lastUsedAt = this.now();
    return tab;
  }

  private requireTab(request: PreviewAutomationRequest): HostedTab {
    const tab = this.resolveTab(request);
    if (tab) return tab;
    throw new HostedPreviewAutomationError(
      "PreviewAutomationTabNotFoundError",
      request.tabId
        ? `Hosted browser tab ${request.tabId} was not found.`
        : "No active VPS-hosted browser tab was found. Call preview_open first.",
    );
  }

  private requireSessionTab(threadId: ThreadId, tabId: PreviewTabId): HostedTab {
    const tab = this.tabs.get(tabId);
    if (tab && tab.threadId === threadId && !tab.page.isClosed()) {
      tab.lastUsedAt = this.now();
      this.currentTabByThread.set(threadId, tabId);
      return tab;
    }
    throw new HostedPreviewAutomationError(
      "PreviewAutomationTabNotFoundError",
      `Hosted browser tab ${tabId} was not found.`,
    );
  }

  private async navigationState(
    tab: HostedTab,
  ): Promise<{ readonly canGoBack: boolean; readonly canGoForward: boolean }> {
    if (!tab.cdp) return { canGoBack: false, canGoForward: false };
    try {
      const raw = await tab.cdp.send("Page.getNavigationHistory");
      const history = raw as { readonly currentIndex?: unknown; readonly entries?: unknown };
      const currentIndex =
        typeof history.currentIndex === "number" && Number.isInteger(history.currentIndex)
          ? history.currentIndex
          : 0;
      const entryCount = Array.isArray(history.entries) ? history.entries.length : 0;
      return {
        canGoBack: currentIndex > 0,
        canGoForward: currentIndex >= 0 && currentIndex < entryCount - 1,
      };
    } catch {
      return { canGoBack: false, canGoForward: false };
    }
  }

  private async reportCurrentStatus(tab: HostedTab): Promise<void> {
    const lifecycle = this.options.lifecycle;
    if (!lifecycle || tab.page.isClosed()) return;
    const url = tab.page.url();
    const title = await tab.page.title().catch(() => "");
    const navigation = await this.navigationState(tab);
    await lifecycle.reportStatus({
      threadId: tab.threadId,
      tabId: tab.tabId,
      navStatus: { _tag: "Success", url, title },
      ...navigation,
    });
  }

  private async status(tab: HostedTab | null): Promise<PreviewAutomationStatus> {
    if (!tab) {
      return {
        available: true,
        visible: false,
        tabId: null,
        url: null,
        title: null,
        loading: false,
      };
    }
    return {
      available: true,
      visible:
        tab.lastViewedAt !== null && this.now() - tab.lastViewedAt <= HOSTED_FRAME_MAX_AGE_MS,
      tabId: tab.tabId,
      url: tab.page.url(),
      title: await tab.page.title().catch(() => null),
      loading: tab.loading,
      viewportSetting: tab.viewportSetting,
      viewport: renderedViewport(tab.page),
    };
  }

  private async open(request: PreviewAutomationRequest): Promise<PreviewAutomationStatus> {
    const input = decode(PreviewAutomationOpenInput, request.input);
    const shouldReuse = input.reuseExistingTab ?? true;
    let tab = shouldReuse ? this.resolveTab(request) : null;
    if (!tab) {
      if (request.tabId !== undefined) {
        throw new HostedPreviewAutomationError(
          "PreviewAutomationTabNotFoundError",
          `Hosted browser tab ${request.tabId} was not found.`,
        );
      }
      const visible = input.open ?? input.show ?? true;
      const lifecycleSnapshot = this.options.lifecycle
        ? await this.options.lifecycle.open({
            threadId: request.threadId,
            ...(input.url === undefined ? {} : { url: normalizePreviewUrl(input.url) }),
            viewport: FILL_PREVIEW_VIEWPORT,
            ...(visible ? { reveal: true as const } : {}),
          })
        : null;
      const tabId =
        lifecycleSnapshot?.tabId ?? PreviewTabId.make(`hosted-${NodeCrypto.randomUUID()}`);
      try {
        tab = await this.ensureTab(
          request.threadId,
          tabId,
          lifecycleSnapshot?.viewport ?? { _tag: "freeform", ...DEFAULT_VIEWPORT },
        );
      } catch (cause) {
        if (lifecycleSnapshot) {
          await this.options.lifecycle
            ?.close({ threadId: request.threadId, tabId: lifecycleSnapshot.tabId })
            .catch(() => {});
        }
        throw cause;
      }
    }
    this.currentTabByThread.set(request.threadId, tab.tabId);
    if (input.url !== undefined) {
      await this.navigatePage(tab, normalizePreviewUrl(input.url), "load", request.timeoutMs);
    }
    return await this.status(tab);
  }

  private async navigatePage(
    tab: HostedTab,
    url: string,
    readiness: "load" | "domContentLoaded" | "none",
    timeoutMs: number,
  ): Promise<void> {
    tab.loading = true;
    const waitUntil =
      readiness === "none"
        ? "commit"
        : readiness === "domContentLoaded"
          ? "domcontentloaded"
          : "load";
    const lifecycle = this.options.lifecycle;
    if (lifecycle) {
      const navigation = await this.navigationState(tab);
      await lifecycle
        .reportStatus({
          threadId: tab.threadId,
          tabId: tab.tabId,
          navStatus: { _tag: "Loading", url, title: await tab.page.title().catch(() => "") },
          ...navigation,
        })
        .catch(() => {});
    }
    try {
      await tab.page.goto(url, { waitUntil, timeout: timeoutMs });
      if (readiness !== "none") await this.reportCurrentStatus(tab).catch(() => {});
    } catch (cause) {
      if (lifecycle) {
        const navigation = await this.navigationState(tab);
        await lifecycle
          .reportStatus({
            threadId: tab.threadId,
            tabId: tab.tabId,
            navStatus: {
              _tag: "LoadFailed",
              url,
              title: await tab.page.title().catch(() => ""),
              code: -1,
              description: "The VPS-hosted browser could not load this page.",
            },
            ...navigation,
          })
          .catch(() => {});
      }
      throw cause;
    } finally {
      if (readiness !== "none") tab.loading = false;
    }
  }

  private async snapshot(tab: HostedTab): Promise<PreviewAutomationSnapshot> {
    const page = tab.page;
    const [title, visibleText, interactiveElements, accessibilityTree, screenshot] =
      await Promise.all([
        page.title(),
        page
          .locator("body")
          .innerText({ timeout: 2_000 })
          .then((text) => text.slice(0, MAX_VISIBLE_TEXT_LENGTH))
          .catch(() => ""),
        readInteractiveElements(page).catch(() => []),
        page
          .locator("body")
          .ariaSnapshot({ timeout: 2_000 })
          .catch(() => null),
        page.screenshot({ type: "png", fullPage: false, animations: "disabled" }),
      ]);
    if (screenshot.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new HostedPreviewAutomationError(
        "PreviewAutomationResultTooLargeError",
        "The hosted browser screenshot exceeded the response limit.",
        { maximumBytes: MAX_SCREENSHOT_BYTES },
      );
    }
    const viewport = renderedViewport(page);
    return {
      url: page.url(),
      title,
      loading: tab.loading,
      visibleText,
      interactiveElements,
      accessibilityTree,
      consoleEntries: [...tab.consoleEntries],
      networkEntries: [...tab.networkEntries],
      actionTimeline: [...tab.actionTimeline],
      screenshot: {
        mimeType: "image/png",
        data: screenshot.toString("base64"),
        width: viewport.width,
        height: viewport.height,
      },
    };
  }

  private async withAction<A>(tab: HostedTab, action: string, run: () => Promise<A>): Promise<A> {
    const event: PreviewAutomationActionEvent = {
      id: NodeCrypto.randomUUID(),
      action,
      status: "running",
      startedAt: new Date(this.now()).toISOString(),
    };
    boundedPush(tab.actionTimeline, event);
    try {
      const result = await run();
      const index = tab.actionTimeline.indexOf(event);
      if (index >= 0) {
        tab.actionTimeline[index] = {
          ...event,
          status: "succeeded",
          completedAt: new Date(this.now()).toISOString(),
        };
      }
      tab.lastUsedAt = this.now();
      return result;
    } catch (cause) {
      const index = tab.actionTimeline.indexOf(event);
      if (index >= 0) {
        tab.actionTimeline[index] = {
          ...event,
          status: "failed",
          completedAt: new Date(this.now()).toISOString(),
          error: errorMessage(cause).slice(0, 1_000),
        };
      }
      throw cause;
    }
  }

  private async handleUnsafe(request: PreviewAutomationRequest): Promise<unknown> {
    try {
      switch (request.operation) {
        case "status": {
          decode(PreviewAutomationTabTargetInput, request.input);
          return await this.status(this.resolveTab(request));
        }
        case "open":
          return await this.open(request);
        case "navigate": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationNavigateInput, request.input);
          await this.withAction(tab, "navigate", () =>
            this.navigatePage(
              tab,
              resolveTargetUrl(input),
              input.readiness ?? "load",
              input.timeoutMs ?? request.timeoutMs,
            ),
          );
          return await this.status(tab);
        }
        case "resize": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationResizeInput, request.input);
          const setting = resolvePreviewViewport(input);
          const viewport = setting._tag === "fill" ? DEFAULT_VIEWPORT : setting;
          await this.withAction(tab, "resize", () => tab.page.setViewportSize(viewport));
          tab.viewportSetting = setting;
          await this.options.lifecycle
            ?.resize({ threadId: tab.threadId, tabId: tab.tabId, viewport: setting })
            .catch(() => {});
          return { tabId: tab.tabId, setting, viewport };
        }
        case "setColorScheme": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationSetColorSchemeInput, request.input);
          await this.withAction(tab, "setColorScheme", () =>
            tab.page.emulateMedia({
              colorScheme: input.colorScheme === "system" ? null : input.colorScheme,
            }),
          );
          tab.colorScheme = input.colorScheme;
          return { tabId: tab.tabId, colorScheme: input.colorScheme };
        }
        case "snapshot": {
          decode(PreviewAutomationTabTargetInput, request.input);
          return await this.snapshot(this.requireTab(request));
        }
        case "click": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationClickInput, request.input);
          await this.withAction(tab, "click", async () => {
            if (input.x !== undefined && input.y !== undefined) {
              await tab.page.mouse.click(input.x, input.y);
              return;
            }
            await locatorFromInput(tab.page, input)!.click(
              input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs },
            );
          });
          return { tabId: tab.tabId };
        }
        case "type": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationTypeInput, request.input);
          await this.withAction(tab, "type", async () => {
            const locator = locatorFromInput(tab.page, input) ?? tab.page.locator(":focus").first();
            if ((await locator.count()) === 0 || !(await isEditable(locator))) {
              const selectorKind = input.locator
                ? "locator"
                : input.selector
                  ? "selector"
                  : "focused-element";
              throw new HostedPreviewAutomationError(
                "PreviewAutomationTargetNotEditableError",
                "The hosted browser typing target is not editable.",
                {
                  selectorKind,
                  ...(selectorKind === "focused-element"
                    ? {}
                    : { selectorLength: (input.locator ?? input.selector ?? "").length }),
                },
              );
            }
            await locator.focus();
            if (input.clear ?? false) await locator.fill("");
            await tab.page.keyboard.insertText(input.text);
          });
          return { tabId: tab.tabId };
        }
        case "press": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationPressInput, request.input);
          const key = [...(input.modifiers ?? []), input.key].join("+");
          await this.withAction(tab, "press", () => tab.page.keyboard.press(key));
          return { tabId: tab.tabId };
        }
        case "scroll": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationScrollInput, request.input);
          await this.withAction(tab, "scroll", async () => {
            const deltaX = input.deltaX ?? 0;
            const deltaY = input.deltaY ?? 0;
            const locator = locatorFromInput(tab.page, input);
            if (locator) {
              await locator.evaluate((element, delta) => element.scrollBy(delta.x, delta.y), {
                x: deltaX,
                y: deltaY,
              });
            } else {
              await tab.page.mouse.wheel(deltaX, deltaY);
            }
          });
          return { tabId: tab.tabId };
        }
        case "evaluate": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationEvaluateInput, request.input);
          return await this.withAction(tab, "evaluate", async () => {
            const session = await tab.page.context().newCDPSession(tab.page);
            try {
              const result = await session.send("Runtime.evaluate", {
                expression: input.expression,
                awaitPromise: input.awaitPromise ?? true,
                returnByValue: input.returnByValue ?? true,
              });
              if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.text);
              }
              return result.result.value ?? result.result.description ?? null;
            } finally {
              await session.detach().catch(() => {});
            }
          });
        }
        case "waitFor": {
          const tab = this.requireTab(request);
          const input = decode(PreviewAutomationWaitForInput, request.input);
          const timeoutMs = input.timeoutMs ?? request.timeoutMs;
          await this.withAction(tab, "waitFor", async () => {
            const conditions: Array<Promise<unknown>> = [];
            const locator = locatorFromInput(tab.page, input);
            if (locator) conditions.push(locator.waitFor({ state: "visible", timeout: timeoutMs }));
            if (input.text) {
              conditions.push(
                tab.page.getByText(input.text, { exact: false }).first().waitFor({
                  state: "visible",
                  timeout: timeoutMs,
                }),
              );
            }
            if (input.urlIncludes) {
              conditions.push(
                tab.page.waitForURL((url) => url.toString().includes(input.urlIncludes!), {
                  timeout: timeoutMs,
                }),
              );
            }
            await Promise.all(conditions);
          });
          return { tabId: tab.tabId };
        }
        case "recordingStart":
        case "recordingStop":
          throw new HostedPreviewAutomationError(
            "PreviewAutomationUnsupportedClientError",
            "The resource-bounded hosted browser does not support video recording.",
          );
      }
    } catch (cause) {
      throw classifyFailure(cause, request.operation);
    }
  }
}

export class HostedPreviewBrowser extends Context.Service<
  HostedPreviewBrowser,
  {
    readonly enabled: boolean;
    readonly controller: HostedPreviewAutomationController | null;
  }
>()("t3/mcp/HostedPreviewAutomationHost/HostedPreviewBrowser") {}

export const runtimeLayer = Layer.effect(
  HostedPreviewBrowser,
  Effect.gen(function* HostedPreviewBrowserRuntimeLayer() {
    const config = yield* ServerConfig.ServerConfig;
    if (config.mode !== "web" || !config.hostedBrowserEnabled) {
      return HostedPreviewBrowser.of({ enabled: false, controller: null });
    }
    const previewManager = yield* PreviewManager.PreviewManager;
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);
    const controller = new HostedPreviewAutomationController({
      profileDir: NodePath.join(config.stateDir, "hosted-browser-profile"),
      maxTabs: config.hostedBrowserMaxTabs ?? 2,
      idleTimeoutMs: config.hostedBrowserIdleTimeoutMs ?? 10 * 60 * 1_000,
      lifecycle: {
        open: (input) => runPromise(previewManager.open(input)),
        reportStatus: (input) => runPromise(previewManager.reportStatus(input)),
        resize: (input) => runPromise(previewManager.resize(input).pipe(Effect.asVoid)),
        close: (input) => runPromise(previewManager.close(input)),
      },
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => controller.close()).pipe(Effect.ignoreCause({ log: true })),
    );
    return HostedPreviewBrowser.of({ enabled: true, controller });
  }),
);

export const layer = Layer.effectDiscard(
  Effect.gen(function* HostedPreviewAutomationHostLayer() {
    const config = yield* ServerConfig.ServerConfig;
    const hostedBrowser = yield* HostedPreviewBrowser;
    const controller = hostedBrowser.controller;
    if (!hostedBrowser.enabled || !controller) return;

    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const environmentId = yield* environment.getEnvironmentId;
    const clientId = `server-headless:${environmentId}`;
    const host: PreviewAutomationHost = {
      clientId,
      environmentId,
      supportedOperations: [...HOSTED_PREVIEW_AUTOMATION_OPERATIONS],
    };
    const events = yield* broker.connect(host);
    yield* Stream.runForEach(events, (event) => {
      if (event.type === "connected") {
        return Effect.logInfo("VPS-hosted preview automation is available.", {
          clientId,
          maxTabs: config.hostedBrowserMaxTabs ?? 2,
          idleTimeoutMs: config.hostedBrowserIdleTimeoutMs ?? 10 * 60 * 1_000,
        });
      }
      return Effect.tryPromise({
        try: () => controller.handle(event.request),
        catch: (cause) => classifyFailure(cause, event.request.operation),
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.logWarning("VPS-hosted preview automation request failed.", {
              operation: event.request.operation,
              errorTag: error._tag,
              ...(error.detail === undefined ? {} : { errorDetail: error.detail }),
            }).pipe(
              Effect.andThen(
                broker.respond({
                  clientId,
                  connectionId: event.connectionId,
                  requestId: event.request.requestId,
                  ok: false,
                  error: {
                    _tag: error._tag,
                    message: error.message,
                    ...(error.detail === undefined ? {} : { detail: error.detail }),
                  },
                }),
              ),
            ),
          onSuccess: (result) =>
            broker.respond({
              clientId,
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: true,
              result,
            }),
        }),
        Effect.ignore,
      );
    }).pipe(Effect.forkScoped);

    yield* Effect.sleep(Duration.millis(IDLE_SWEEP_INTERVAL_MS)).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => controller.sweepIdle(),
          catch: () =>
            new HostedPreviewAutomationError(
              "PreviewAutomationExecutionError",
              "Hosted browser idle cleanup failed.",
            ),
        }).pipe(Effect.ignoreCause({ log: true })),
      ),
      Effect.forever,
      Effect.forkScoped,
    );
  }),
);
