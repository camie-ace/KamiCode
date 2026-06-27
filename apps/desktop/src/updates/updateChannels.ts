import type { DesktopUpdateChannel } from "@t3tools/contracts";

const DEV_VERSION_PATTERN = /-dev\.\d{8}\.\d+$/;
const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

export function isDevDesktopVersion(version: string): boolean {
  return DEV_VERSION_PATTERN.test(version);
}

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  if (isDevDesktopVersion(appVersion)) {
    return "dev";
  }

  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
