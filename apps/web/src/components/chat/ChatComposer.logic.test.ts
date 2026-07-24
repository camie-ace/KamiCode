import { describe, expect, it } from "vite-plus/test";

import {
  createComposerAttachment,
  inferComposerFileMimeType,
  shouldDisableComposerPromptEditor,
} from "./ChatComposer.logic";

describe("shouldDisableComposerPromptEditor", () => {
  it("keeps the editor editable while the environment is unavailable", () => {
    expect(
      shouldDisableComposerPromptEditor({
        isComposerApprovalState: false,
        isConnecting: false,
        isEnvironmentUnavailable: true,
        hasActivePendingProgress: false,
      }),
    ).toBe(false);
  });

  it("keeps the editor editable while a send is connecting", () => {
    expect(
      shouldDisableComposerPromptEditor({
        isComposerApprovalState: false,
        isConnecting: true,
        isEnvironmentUnavailable: false,
        hasActivePendingProgress: false,
      }),
    ).toBe(false);
  });

  it("disables the editor while an approval request owns the composer", () => {
    expect(
      shouldDisableComposerPromptEditor({
        isComposerApprovalState: true,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        hasActivePendingProgress: false,
      }),
    ).toBe(true);
  });
});

describe("composer attachments", () => {
  const dependencies = {
    createId: () => "attachment-1",
    createPreviewUrl: () => "blob:preview",
  };

  it("recognizes TeX files without a browser-provided MIME type", () => {
    const file = new File(["\\documentclass{article}"], "paper.tex");

    expect(inferComposerFileMimeType(file)).toBe("application/x-tex");
    const attachment = createComposerAttachment(file, dependencies);
    expect(attachment).toMatchObject({
      type: "file",
      id: "attachment-1",
      name: "paper.tex",
      mimeType: "application/x-tex",
    });
    expect("status" in attachment).toBe(false);
  });

  it("accepts ordinary files as ready file context", () => {
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });

    const attachment = createComposerAttachment(file, dependencies);
    expect(attachment).toMatchObject({
      type: "file",
      name: "notes.txt",
      mimeType: "text/plain",
    });
    expect("status" in attachment).toBe(false);
  });

  it("keeps oversized generic files visibly unsupported", () => {
    const file = {
      name: "huge.tex",
      type: "application/x-tex",
      size: 10 * 1024 * 1024 + 1,
    } as File;

    expect(createComposerAttachment(file, dependencies)).toMatchObject({
      type: "file",
      status: "unsupported",
      unsupportedReason: "File exceeds the 10MB send limit.",
    });
  });
});
