import { describe, expect, it } from "vite-plus/test";

import {
  isMobileInteractionMode,
  MOBILE_INTERACTION_MODE_OPTIONS,
  mobileInteractionModeLabel,
} from "./interactionModeOptions";

describe("mobile interaction mode options", () => {
  it("exposes every KamiCode interaction mode in product order", () => {
    expect(MOBILE_INTERACTION_MODE_OPTIONS.map((option) => option.id)).toEqual([
      "default",
      "plan",
      "test",
      "workflow",
      "trigger",
    ]);
  });

  it("labels Build distinctly while preserving the protocol value", () => {
    expect(mobileInteractionModeLabel("default")).toBe("Build");
    expect(mobileInteractionModeLabel("workflow")).toBe("Workflow");
  });

  it("guards slash-command values", () => {
    expect(isMobileInteractionMode("trigger")).toBe(true);
    expect(isMobileInteractionMode("unknown")).toBe(false);
  });
});
