// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isLoopbackHostname,
  resolveDevRedirectUrl,
  resolveTestHarnessArtifactPath,
} from "./http.ts";

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
    const stateDir = path.resolve("state");
    const artifactPath = path.join(
      stateDir,
      "test-harness",
      "projects",
      "project-1",
      "runs",
      "run-1",
      "trace.zip",
    );

    expect(resolveTestHarnessArtifactPath({ stateDir, artifactPath })).toBe(
      artifactPath,
    );
  });

  it("rejects files outside the test-harness directory", () => {
    expect(
      resolveTestHarnessArtifactPath({
        stateDir: path.resolve("state"),
        artifactPath: path.resolve("state", "secrets", "session.json"),
      }),
    ).toBeNull();
  });
});
