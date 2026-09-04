import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

export interface ManagedProviderStorageEnvironment {
  readonly scratchDir?: string | undefined;
  readonly packageCacheDir?: string | undefined;
}

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
  managedStorage?: ManagedProviderStorageEnvironment,
): NodeJS.ProcessEnv {
  if ((!environment || environment.length === 0) && managedStorage === undefined) {
    return baseEnv;
  }

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
    next[variable.name] = variable.value;
  }
  return next;
}
