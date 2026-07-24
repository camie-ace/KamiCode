// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { appendProviderAttachmentContext } from "./providerAttachmentContext.ts";

describe("appendProviderAttachmentContext", () => {
  it("adds exact local paths for TeX and video attachments", () => {
    const attachmentsDir = NodePath.resolve("C:/tmp/kamicode-attachments");
    const result = appendProviderAttachmentContext({
      messageText: "Review both files.",
      attachmentsDir,
      attachments: [
        {
          type: "file",
          id: "thread-1-paper",
          name: "paper.tex",
          mimeType: "application/x-tex",
          sizeBytes: 42,
        },
        {
          type: "video",
          id: "thread-1-demo",
          name: "demo.mp4",
          mimeType: "video/mp4",
          sizeBytes: 100,
        },
      ],
    });
    const references = (result ?? "")
      .split("\n")
      .filter((line) => line.startsWith("- {") && line.endsWith("}"))
      .map((line) => JSON.parse(line.slice(2)) as { path: string });

    expect(result).toContain("Review both files.\n\n<attached_files>");
    expect(result).toContain('"name":"paper.tex"');
    expect(references.map((reference) => reference.path)).toEqual([
      NodePath.join(attachmentsDir, "thread-1-paper.tex"),
      NodePath.join(attachmentsDir, "thread-1-demo.mp4"),
    ]);
    expect(result).toContain("</attached_files>");
  });

  it("leaves image-only turns unchanged because providers receive them natively", () => {
    expect(
      appendProviderAttachmentContext({
        messageText: "Inspect this image.",
        attachmentsDir: NodePath.resolve("C:/tmp/kamicode-attachments"),
        attachments: [
          {
            type: "image",
            id: "thread-1-image",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        ],
      }),
    ).toBe("Inspect this image.");
  });
});
