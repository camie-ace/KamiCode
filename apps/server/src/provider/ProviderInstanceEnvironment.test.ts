import { describe, expect, it } from "vite-plus/test";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it("overrides inherited environment values and preserves empty strings", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [
          { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
        ],
        { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
      ),
    ).toMatchObject({
      OPENROUTER_API_KEY: "sk-or-test",
      ANTHROPIC_API_KEY: "",
      PATH: "/bin",
    });
  });

  it("routes provider scratch and package downloads through managed shared storage", () => {
    expect(
      mergeProviderInstanceEnvironment(
        undefined,
        { PATH: "/bin" },
        {
          scratchDir: "/var/cache/kamicode/scratch",
          packageCacheDir: "/var/cache/kamicode/packages",
        },
      ),
    ).toMatchObject({
      PATH: "/bin",
      KAMICODE_SCRATCH_DIR: "/var/cache/kamicode/scratch",
      TMPDIR: "/var/cache/kamicode/scratch",
      TMP: "/var/cache/kamicode/scratch",
      TEMP: "/var/cache/kamicode/scratch",
      npm_config_cache: "/var/cache/kamicode/packages/npm",
      pnpm_config_store_dir: "/var/cache/kamicode/packages/pnpm-store",
      XDG_CACHE_HOME: "/var/cache/kamicode/packages/xdg",
      PLAYWRIGHT_BROWSERS_PATH: "/var/cache/kamicode/packages/playwright",
      PUPPETEER_CACHE_DIR: "/var/cache/kamicode/packages/puppeteer",
    });
  });

  it("allows an explicit provider environment to override managed defaults", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [{ name: "TMPDIR", value: "/provider/tmp", sensitive: false }],
        {},
        { scratchDir: "/managed/tmp" },
      ),
    ).toMatchObject({
      KAMICODE_SCRATCH_DIR: "/managed/tmp",
      TMPDIR: "/provider/tmp",
    });
  });
});
