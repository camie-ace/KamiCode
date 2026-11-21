import { describe, expect, it } from "vite-plus/test";

import chatComposerSource from "./chat/ChatComposer.tsx?raw";
import chatViewSource from "./ChatView.tsx?raw";

describe("composer banner ownership", () => {
  it("places hero notices below the centered composer and thread notices inside it", () => {
    expect(chatViewSource.match(/\bbannerItems=\{/gu) ?? []).toHaveLength(1);
    expect(chatViewSource).toContain("isDraftHeroState || composerBannerItems.length === 0");
    expect(chatViewSource).toContain("isDraftHeroState && composerBannerItems.length > 0");
    expect(chatViewSource.match(/<ComposerBannerStack\b/gu) ?? []).toHaveLength(1);
    expect(chatViewSource).not.toMatch(/<ThreadSyncStatusPill\b/u);
    expect(chatComposerSource.match(/<ComposerBannerStack\b/gu) ?? []).toHaveLength(1);
  });
});
