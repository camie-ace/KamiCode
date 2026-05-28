// This file mostly exists because we want dev mode to say "KamiCode (Dev)" instead of "electron"

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "KamiCode (Dev)" : "KamiCode (Alpha)";
const APP_BUNDLE_ID = isDevelopment ? "ai.kagura.kamicode.dev" : "ai.kagura.kamicode";
const LAUNCHER_VERSION = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const defaultIconPath = join(desktopDir, "resources", "icon.icns");
const windowsIconPath = join(desktopDir, "resources", "icon.ico");
const developmentMacIconPngPath = join(repoRoot, "assets", "dev", "blueprint-macos-1024.png");

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function ensureDevelopmentIconIcns(runtimeDir) {
  const generatedIconPath = join(runtimeDir, "icon-dev.icns");
  mkdirSync(runtimeDir, { recursive: true });

  if (!existsSync(developmentMacIconPngPath)) {
    return defaultIconPath;
  }

  const sourceMtimeMs = statSync(developmentMacIconPngPath).mtimeMs;
  if (existsSync(generatedIconPath) && statSync(generatedIconPath).mtimeMs >= sourceMtimeMs) {
    return generatedIconPath;
  }

  const iconsetRoot = mkdtempSync(join(runtimeDir, "dev-iconset-"));
  const iconsetDir = join(iconsetRoot, "icon.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } catch (error) {
    console.warn(
      "[desktop-launcher] Failed to generate dev macOS icon, falling back to default icon.",
      error,
    );
    return defaultIconPath;
  } finally {
    rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveRceditPath() {
  if (process.env.RCEDIT_PATH && existsSync(process.env.RCEDIT_PATH)) {
    return process.env.RCEDIT_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const winCodeSignCacheDir = join(localAppData, "electron-builder", "Cache", "winCodeSign");
  if (!existsSync(winCodeSignCacheDir)) {
    return null;
  }

  const stack = [winCodeSignCacheDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name === "rcedit-x64.exe" || entry.name === "rcedit-ia32.exe") {
        return entryPath;
      }
    }
  }

  return null;
}

function patchWindowsExecutable(executablePath, iconPath) {
  const rceditPath = resolveRceditPath();
  if (!rceditPath) {
    console.warn(
      "[desktop-launcher] rcedit was not found; falling back to the unbranded Electron executable.",
    );
    return false;
  }

  runChecked(rceditPath, [
    executablePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "FileDescription",
    APP_DISPLAY_NAME,
    "--set-version-string",
    "ProductName",
    APP_DISPLAY_NAME,
    "--set-version-string",
    "InternalName",
    APP_DISPLAY_NAME,
    "--set-version-string",
    "OriginalFilename",
    `${APP_DISPLAY_NAME}.exe`,
    "--set-version-string",
    "CompanyName",
    "Kagura AI",
  ]);
  return true;
}

function buildWindowsLauncher(electronBinaryPath) {
  if (!existsSync(windowsIconPath)) {
    return electronBinaryPath;
  }

  const sourceDistDir = dirname(electronBinaryPath);
  const runtimeDir = join(desktopDir, ".electron-runtime", "win32");
  const targetDistDir = join(runtimeDir, APP_BUNDLE_ID);
  const targetBinaryPath = join(targetDistDir, `${APP_DISPLAY_NAME}.exe`);
  const metadataPath = join(runtimeDir, `${APP_BUNDLE_ID}.json`);

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    appBundleId: APP_BUNDLE_ID,
    appDisplayName: APP_DISPLAY_NAME,
    sourceDistDir,
    sourceElectronMtimeMs: statSync(electronBinaryPath).mtimeMs,
    iconMtimeMs: statSync(windowsIconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetDistDir, { recursive: true, force: true });
  cpSync(sourceDistDir, targetDistDir, { recursive: true });
  copyFileSync(join(targetDistDir, "electron.exe"), targetBinaryPath);

  if (!patchWindowsExecutable(targetBinaryPath, windowsIconPath)) {
    return electronBinaryPath;
  }

  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
  return targetBinaryPath;
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = isDevelopment ? ensureDevelopmentIconIcns(runtimeDir) : defaultIconPath;
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  const electronBinaryPath = require("electron");

  if (process.platform === "win32") {
    return buildWindowsLauncher(electronBinaryPath);
  }

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  // Dev launches do not need a renamed app bundle badly enough to risk breaking
  // Electron helper resource lookup on macOS.
  if (isDevelopment) {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}
