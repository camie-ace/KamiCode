import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("decodes old, recognized and future manual installation descriptors", () => {
    expect(decodeDescriptor(descriptor).capabilities.serverInstallation).toBeUndefined();
    for (const installation of [
      { kind: "npx" },
      { kind: "npm-global", prefix: "/opt/node" },
      { kind: "t3-launcher", launcher: "/opt/bin/t3", baseDir: "/data/t3" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toEqual(installation);
    }
    const spaced = { kind: "t3-launcher", launcher: "/opt/bin/t3 ", baseDir: " /data/t3 " };
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, serverInstallation: spaced },
      }).capabilities.serverInstallation,
    ).toEqual(spaced);
    for (const installation of [
      { kind: "future-manager" },
      { kind: "npm-global" },
      { kind: "t3-launcher", launcher: "t3" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toBeUndefined();
    }
  });
  it("treats a missing hosted-browser capability as unsupported", () => {
    expect(decodeDescriptor(descriptor).capabilities.hostedBrowserPreview).toBeUndefined();
  });

  it("preserves an advertised hosted-browser capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, hostedBrowserPreview: true },
      }).capabilities.hostedBrowserPreview,
    ).toBe(true);
  });

  it("treats a missing speech-transcription capability as unsupported", () => {
    expect(decodeDescriptor(descriptor).capabilities.speechTranscription).toBeUndefined();
  });

  it("preserves an advertised speech-transcription capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, speechTranscription: true },
      }).capabilities.speechTranscription,
    ).toBe(true);
  });

  it("treats a missing recurring-schedule capability as unsupported", () => {
    expect(decodeDescriptor(descriptor).capabilities.threadRecurringSchedules).toBeUndefined();
  });

  it("preserves an advertised recurring-schedule capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, threadRecurringSchedules: true },
      }).capabilities.threadRecurringSchedules,
    ).toBe(true);
  });
});
