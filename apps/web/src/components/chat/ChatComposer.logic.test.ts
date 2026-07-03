import { describe, expect, it } from "vite-plus/test";

import { shouldDisableComposerPromptEditor } from "./ChatComposer.logic";

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
