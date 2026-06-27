// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  GENERATED_MEDIA_ROOT_RELATIVE_PATH,
  resolveGeneratedMediaDirectory,
  resolveGeneratedMediaPath,
  sanitizeGeneratedMediaFileName,
} from "./generatedMedia.ts";

describe("generatedMedia", () => {
  it("builds a predictable project/thread generated media directory", () => {
    const projectRoot = NodePath.resolve("test-project");

    expect(
      resolveGeneratedMediaDirectory({
        projectRoot,
        threadId: "Thread: 123",
      }),
    ).toEqual({
      threadSegment: "thread-123",
      relativePath: `${GENERATED_MEDIA_ROOT_RELATIVE_PATH}/thread-123`,
      absolutePath: NodePath.join(projectRoot, ".kamicode/generated-media/thread-123"),
    });
  });

  it("sanitizes generated media paths and falls back to a safe media extension", () => {
    const projectRoot = NodePath.resolve("test-project");

    expect(
      resolveGeneratedMediaPath({
        projectRoot,
        threadId: "../Thread: 123",
        fileName: "../Hero Shot.WEBP",
      }),
    ).toMatchObject({
      threadSegment: "thread-123",
      fileName: "hero-shot.webp",
      fileRelativePath: `${GENERATED_MEDIA_ROOT_RELATIVE_PATH}/thread-123/hero-shot.webp`,
    });

    expect(sanitizeGeneratedMediaFileName("..\\unsafe.exe")).toBe("unsafe.png");
    expect(sanitizeGeneratedMediaFileName("???")).toBe("generated-media.png");
  });
});
