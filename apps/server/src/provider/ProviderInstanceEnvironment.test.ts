import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it.effect.each([
    { value: "~/.account", tail: ".account" },
    { value: "~\\.account\\work", tail: ".account\\work" },
  ])("expands configured provider homes set to $value", ({ value, tail }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseEnv = {
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      };
      const environment = mergeProviderInstanceEnvironment(
        [
          { name: "CODEX_HOME", value, sensitive: false },
          { name: "CLAUDE_CONFIG_DIR", value, sensitive: false },
          { name: "CUSTOM_VALUE", value, sensitive: false },
        ],
        baseEnv,
      );

      expect(environment).toEqual({
        CODEX_HOME: path.join(NodeOS.homedir(), tail),
        CLAUDE_CONFIG_DIR: path.join(NodeOS.homedir(), tail),
        CUSTOM_VALUE: value,
      });
      expect(baseEnv).toEqual({
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("leaves inherited provider homes unchanged", () => {
    const baseEnv = { CODEX_HOME: "~/.codex", CLAUDE_CONFIG_DIR: "~\\.claude" };

    expect(
      mergeProviderInstanceEnvironment(
        [{ name: "CUSTOM_VALUE", value: "~/.custom", sensitive: false }],
        baseEnv,
      ),
    ).toEqual({ ...baseEnv, CUSTOM_VALUE: "~/.custom" });
  });

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
