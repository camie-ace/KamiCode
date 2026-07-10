import { describe, expect, it } from "@effect/vitest";

import { assistantMessageReferencesAssetPath } from "./MediaArtifacts.ts";

describe("assistantMessageReferencesAssetPath", () => {
  it("matches angle-wrapped Windows media links with spaces", () => {
    const path =
      "C:/Users/Camie/Downloads/How to Create and Share a Wise API Token (Full\u2011Access) - balances blurred.mp4";
    const text = `Done.\n\n[Open the edited video](<${path}>)`;

    expect(assistantMessageReferencesAssetPath(text, path.replaceAll("/", "\\"))).toBe(true);
  });

  it("matches encoded file URLs", () => {
    expect(
      assistantMessageReferencesAssetPath(
        "[Open](file:///C:/Users/Camie/Downloads/final%20cut.mp4)",
        "C:\\Users\\Camie\\Downloads\\final cut.mp4",
      ),
    ).toBe(true);
  });

  it("rejects partial paths, unsupported files, and unrelated references", () => {
    const text = "[Open](<C:/Users/Camie/Downloads/final-cut.mp4.bak>)";

    expect(
      assistantMessageReferencesAssetPath(text, "C:/Users/Camie/Downloads/final-cut.mp4"),
    ).toBe(false);
    expect(
      assistantMessageReferencesAssetPath(
        "See C:/Users/Camie/Downloads/secrets.exe",
        "C:/Users/Camie/Downloads/secrets.exe",
      ),
    ).toBe(false);
    expect(
      assistantMessageReferencesAssetPath(
        "See C:/Users/Camie/Downloads/secrets.json",
        "C:/Users/Camie/Downloads/secrets.json",
      ),
    ).toBe(false);
    expect(assistantMessageReferencesAssetPath(text, "C:/Users/Camie/Downloads/other.mp4")).toBe(
      false,
    );
  });
});
