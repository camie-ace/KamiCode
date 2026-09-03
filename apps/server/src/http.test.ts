// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  assetResponseHeaders,
  downloadContentDisposition,
  isLoopbackHostname,
  listTestHarnessRuns,
  resolveDevRedirectUrl,
  resolveHttpByteRange,
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

describe("http byte range parsing", () => {
  it("resolves open-ended byte ranges for media playback", () => {
    expect(resolveHttpByteRange("bytes=100-", 1_000)).toEqual({
      _tag: "range",
      start: 100,
      end: 999,
      bytesToRead: 900,
      contentRange: "bytes 100-999/1000",
    });
  });

  it("resolves suffix byte ranges", () => {
    expect(resolveHttpByteRange("bytes=-250", 1_000)).toEqual({
      _tag: "range",
      start: 750,
      end: 999,
      bytesToRead: 250,
      contentRange: "bytes 750-999/1000",
    });
  });

  it("clamps explicit range ends to the file size", () => {
    expect(resolveHttpByteRange("bytes=900-2000", 1_000)).toEqual({
      _tag: "range",
      start: 900,
      end: 999,
      bytesToRead: 100,
      contentRange: "bytes 900-999/1000",
    });
  });

  it("marks unsatisfiable ranges for 416 responses", () => {
    expect(resolveHttpByteRange("bytes=1000-", 1_000)).toEqual({
      _tag: "unsatisfiable",
      contentRange: "bytes */1000",
    });
  });

  it("ignores malformed or multi-range headers", () => {
    expect(resolveHttpByteRange("items=0-10", 1_000)).toBeNull();
    expect(resolveHttpByteRange("bytes=0-10,20-30", 1_000)).toBeNull();
    expect(resolveHttpByteRange("bytes=-0", 1_000)).toBeNull();
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

describe("assetResponseHeaders", () => {
  it("sandboxes SVG assets", () => {
    expect(assetResponseHeaders("/attachments/user-image.svg")).toMatchObject({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    expect(assetResponseHeaders("/attachments/user-image.SVG")).toHaveProperty(
      "Content-Security-Policy",
    );
  });

  it("does not apply document policy to raster images", () => {
    expect(assetResponseHeaders("/attachments/user-image.png")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("serves inline videos with their declared mime type", () => {
    expect(
      assetResponseHeaders("/attachments/demo.bin", {
        mimeType: 'video/mp4; codecs="avc1.42E01E"',
      }),
    ).toEqual({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": "video/mp4",
      "X-Content-Type-Options": "nosniff",
    });
  });
  it("serves inline attachment documents with their declared mime type", () => {
    expect(
      assetResponseHeaders("/attachments/upload.bin", { mimeType: "application/pdf" }),
    ).toMatchObject({
      "Content-Type": "application/pdf",
    });
    expect(
      assetResponseHeaders("/attachments/upload.bin", { mimeType: "text/html" }),
    ).toMatchObject({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals",
    });
  });
  it("serves HTML assets as utf-8 inside a sandboxed origin", () => {
    for (const path of ["/workspace/page.html", "/workspace/PAGE.HTM", "/tmp/report.html"]) {
      expect(assetResponseHeaders(path)).toMatchObject({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals",
      });
    }
  });

  it("downloads uploaded documents without executing their content", () => {
    expect(assetResponseHeaders("/attachments/upload.html", { download: true })).toMatchObject({
      "Content-Disposition": "attachment",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/octet-stream",
    });
  });

  it("serves the real filename and mime type when the claims carry them", () => {
    expect(
      assetResponseHeaders("/attachments/thread-1-abc-pdf.pdf", {
        download: true,
        fileName: "Q3 report.pdf",
        mimeType: "application/pdf",
      }),
    ).toMatchObject({
      "Content-Disposition": 'attachment; filename="Q3 report.pdf"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/pdf",
    });
  });

  it("keeps renderable mime types as octet-stream downloads", () => {
    for (const mimeType of [
      "text/html",
      "text/xml",
      "image/svg+xml",
      "application/xhtml+xml",
      "application/rss+xml",
      "APPLICATION/XML",
      "IMAGE/SVG+XML",
      "application/xml-dtd",
      "application/xml-external-parsed-entity",
      "not a mime",
    ]) {
      expect(
        assetResponseHeaders("/attachments/upload.bin", { download: true, mimeType }),
      ).toHaveProperty("Content-Type", "application/octet-stream");
    }
  });

  it("preserves official Office Open XML mime types", () => {
    for (const mimeType of [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
      expect(
        assetResponseHeaders("/attachments/upload.bin", { download: true, mimeType }),
      ).toHaveProperty("Content-Type", mimeType);
    }
  });
});

describe("downloadContentDisposition", () => {
  it("quotes plain names and strips quotes and control characters", () => {
    expect(downloadContentDisposition("report.pdf")).toBe('attachment; filename="report.pdf"');
    expect(downloadContentDisposition('we"ird\n.pdf')).toBe('attachment; filename="we_ird_.pdf"');
  });

  it("adds an RFC 5987 encoded name for non-ASCII filenames", () => {
    expect(downloadContentDisposition("répört.pdf")).toBe(
      `attachment; filename="r_p_rt.pdf"; filename*=UTF-8''r%C3%A9p%C3%B6rt.pdf`,
    );
    expect(downloadContentDisposition("résumé'(*).pdf")).toBe(
      `attachment; filename="r_sum_'(*).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%27%28%2A%29.pdf`,
    );
  });

  it("does not throw on unpaired surrogates in the filename", () => {
    expect(downloadContentDisposition("bad\ud800name.pdf")).toBe(
      `attachment; filename="bad_name.pdf"; filename*=UTF-8''bad%EF%BF%BDname.pdf`,
    );
  });
});
