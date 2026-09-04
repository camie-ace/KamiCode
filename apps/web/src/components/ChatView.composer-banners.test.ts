import { describe, expect, it } from "vite-plus/test";

import chatComposerSource from "./chat/ChatComposer.tsx?raw";
import chatViewSource from "./ChatView.tsx?raw";

describe("composer banner ownership", () => {
  it("mounts the shared banner stack only inside ChatComposer", () => {
    expect(chatViewSource.match(/\bbannerItems=\{composerBannerItems\}/gu) ?? []).toHaveLength(1);
    expect(chatViewSource).not.toMatch(/<ComposerBannerStack\b/u);
    expect(chatViewSource).not.toMatch(/<ThreadSyncStatusPill\b/u);
    expect(chatComposerSource.match(/<ComposerBannerStack\b/gu) ?? []).toHaveLength(1);
  });
});
