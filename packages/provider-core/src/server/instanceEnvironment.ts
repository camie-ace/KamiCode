import type { ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { expandHomeVariable } from "./pathExpansion.ts";

export interface ManagedProviderStorageEnvironment {
  readonly scratchDir?: string | undefined;
  readonly packageCacheDir?: string | undefined;
}

export const mergeProviderInstanceEnvironment = Effect.fn("mergeProviderInstanceEnvironment")(
  function* (
    environment: ProviderInstanceEnvironment | undefined,
    baseEnv: NodeJS.ProcessEnv = process.env,
    managedStorage: ManagedProviderStorageEnvironment = {
      scratchDir: baseEnv.T3CODE_MANAGED_SCRATCH_DIR,
      packageCacheDir: baseEnv.T3CODE_MANAGED_PACKAGE_CACHE_DIR,
    },
  ) {
    if (
      (!environment || environment.length === 0) &&
      !managedStorage.scratchDir &&
      !managedStorage.packageCacheDir
    ) {
      return baseEnv;
    }

    const home = yield* HostProcess.HomeDirectory;
    const windows = (yield* HostProcess.Platform) === "win32";
    const next: NodeJS.ProcessEnv = { ...baseEnv };
    const scratchDir = managedStorage?.scratchDir?.trim();
    if (scratchDir) {
      next.KAMICODE_SCRATCH_DIR = scratchDir;
      next.TMPDIR = scratchDir;
      next.TMP = scratchDir;
      next.TEMP = scratchDir;
    }
    const packageCacheDir = managedStorage?.packageCacheDir?.trim();
    if (packageCacheDir) {
      next.npm_config_cache = `${packageCacheDir}/npm`;
      next.pnpm_config_store_dir = `${packageCacheDir}/pnpm-store`;
      next.XDG_CACHE_HOME = `${packageCacheDir}/xdg`;
      next.PLAYWRIGHT_BROWSERS_PATH = `${packageCacheDir}/playwright`;
      next.PUPPETEER_CACHE_DIR = `${packageCacheDir}/puppeteer`;
    }
    for (const variable of environment ?? []) {
      // An unresolved secret reference carries no value; the registry resolves it for the provider.
      if (typeof variable.value !== "string") continue;
      // Windows reads names without regard to case, and a child gets the first spelling in sort
      // order. Upper case sorts first, so the configured value wins even where a spawn merges the
      // parent environment back in.
      const name = windows ? variable.name.toUpperCase() : variable.name;
      if (windows) {
        for (const inherited of Object.keys(next)) {
          if (inherited.toUpperCase() === name) delete next[inherited];
        }
      }
      next[name] = expandHomeVariable(name, variable.value, home);
    }
    return next;
  },
);
