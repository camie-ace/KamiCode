// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  FILL_PREVIEW_VIEWPORT,
  PreviewTabId,
  ThreadId,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { HostedPreviewAutomationController } from "./HostedPreviewAutomationHost.ts";

let requestSequence = 0;

const makeRequest = (
  threadId: ThreadId,
  operation: PreviewAutomationOperation,
  input: unknown,
  tabId?: PreviewTabId,
): PreviewAutomationRequest => ({
  requestId: `${operation}-${requestSequence++}`,
  threadId,
  operation,
  input,
  timeoutMs: 15_000,
  ...(tabId === undefined ? {} : { tabId }),
});

it("hosts a lazy, bounded Chromium session and returns agent-ready snapshots", async () => {
  const profileDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-hosted-browser-"));
  let now = 1_000_000;
  const lifecycleOpenInputs: Array<PreviewOpenInput> = [];
  const lifecycleClosedTabIds: Array<PreviewTabId> = [];
  const controller = new HostedPreviewAutomationController({
    profileDir,
    maxTabs: 1,
    idleTimeoutMs: 30_000,
    now: () => now,
    lifecycle: {
      open: async (input): Promise<PreviewSessionSnapshot> => {
        lifecycleOpenInputs.push(input);
        return {
          threadId: input.threadId,
          tabId: PreviewTabId.make(`lifecycle-tab-${lifecycleOpenInputs.length}`),
          navStatus: { _tag: "Idle" },
          canGoBack: false,
          canGoForward: false,
          viewport: input.viewport ?? FILL_PREVIEW_VIEWPORT,
          updatedAt: new Date(now).toISOString(),
        };
      },
      reportStatus: async () => {},
      resize: async () => {},
      close: async (input) => {
        lifecycleClosedTabIds.push(input.tabId);
      },
    },
  });
  const threadId = ThreadId.make("hosted-browser-thread");

  try {
    const initialStatus = (await controller.handle(
      makeRequest(threadId, "status", {}),
    )) as PreviewAutomationStatus;
    expect(initialStatus).toMatchObject({ available: true, visible: false, tabId: null });
    expect(controller.browserRunning).toBe(false);

    const opened = (await controller.handle(
      makeRequest(threadId, "open", {}),
    )) as PreviewAutomationStatus;
    expect(opened.tabId).toBe("lifecycle-tab-1");
    expect(lifecycleOpenInputs[0]).toMatchObject({ threadId, reveal: true });
    expect(controller.browserRunning).toBe(true);
    expect(controller.tabCount).toBe(1);
    const tabId = PreviewTabId.make(opened.tabId!);

    await controller.handle(
      makeRequest(
        threadId,
        "evaluate",
        {
          expression: `(() => {
              document.title = "Hosted fixture";
              document.body.innerHTML = '<label>Name <input id="name" value="old"></label><button id="increment" onclick="this.textContent = String(Number(this.textContent) + 1)">0</button>';
              return true;
            })()`,
        },
        tabId,
      ),
    );
    await controller.handle(
      makeRequest(threadId, "type", { locator: "#name", text: "KamiCode", clear: true }, tabId),
    );
    await controller.handle(makeRequest(threadId, "click", { locator: "#increment" }, tabId));

    const values = await controller.handle(
      makeRequest(
        threadId,
        "evaluate",
        {
          expression: `({ name: document.querySelector('#name').value, count: document.querySelector('#increment').textContent })`,
        },
        tabId,
      ),
    );
    expect(values).toEqual({ name: "KamiCode", count: "1" });

    const snapshot = (await controller.handle(
      makeRequest(threadId, "snapshot", {}, tabId),
    )) as PreviewAutomationSnapshot;
    expect(snapshot.title).toBe("Hosted fixture");
    expect(snapshot.visibleText).toContain("Name");
    expect(snapshot.interactiveElements.map((element) => element.selector)).toEqual(
      expect.arrayContaining(["#name", "#increment"]),
    );
    expect(snapshot.screenshot.mimeType).toBe("image/png");
    expect(snapshot.screenshot.data.length).toBeGreaterThan(100);

    const sharedFrame = await controller.readFrame({ threadId, tabId });
    expect(sharedFrame.state).toBe("ready");
    expect(sharedFrame.frame).toMatchObject({
      mimeType: "image/jpeg",
      width: 1_280,
      height: 800,
    });

    await expect(
      controller.handle(
        makeRequest(ThreadId.make("second-thread"), "open", {
          open: false,
          reuseExistingTab: false,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "PreviewAutomationUnavailableError" });

    now += 30_001;
    await controller.sweepIdle();
    expect(controller.tabCount).toBe(0);
    // Keep the single resource-bounded Chromium process warm after its pages
    // are reclaimed. Closing a persistent context on every idle sweep can
    // leave its profile lock behind and make the next shared tab unavailable.
    expect(controller.browserRunning).toBe(true);

    const reopened = (await controller.handle(
      makeRequest(ThreadId.make("second-thread"), "open", { open: false }),
    )) as PreviewAutomationStatus;
    expect(reopened.tabId).toBe("lifecycle-tab-3");
    expect(controller.browserRunning).toBe(true);
    expect(controller.tabCount).toBe(1);
    expect(lifecycleClosedTabIds).toContain(PreviewTabId.make("lifecycle-tab-2"));
  } finally {
    await controller.close();
    await NodeFSP.rm(profileDir, { recursive: true, force: true });
  }
}, 60_000);
