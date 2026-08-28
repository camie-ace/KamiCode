// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  PreviewTabId,
  ThreadId,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
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
  const controller = new HostedPreviewAutomationController({
    profileDir,
    maxTabs: 1,
    idleTimeoutMs: 30_000,
    now: () => now,
  });
  const threadId = ThreadId.make("hosted-browser-thread");

  try {
    const initialStatus = (await controller.handle(
      makeRequest(threadId, "status", {}),
    )) as PreviewAutomationStatus;
    expect(initialStatus).toMatchObject({ available: true, visible: false, tabId: null });
    expect(controller.browserRunning).toBe(false);

    const opened = (await controller.handle(
      makeRequest(threadId, "open", { open: false }),
    )) as PreviewAutomationStatus;
    expect(opened.tabId).not.toBeNull();
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
    expect(controller.browserRunning).toBe(false);
  } finally {
    await controller.close();
    await NodeFSP.rm(profileDir, { recursive: true, force: true });
  }
}, 60_000);
