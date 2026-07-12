import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopObservability from "./DesktopObservability.ts";

export const OFFICIAL_T3_CODE_DOWNLOAD_URL = "https://github.com/pingdotgg/t3code/releases/latest";

const LEGACY_T3_CODE_PROGRAM_DIRECTORY = "t3code";
const LEGACY_T3_CODE_UPDATER_DIRECTORY = "t3code-updater";
const RECOVERY_DIRECTORY = "kamicode-recovery";
const RECOVERY_MARKER = "legacy-t3code-collision";
const QUARANTINED_UPDATER_DIRECTORY = "legacy-t3code-updater";

const { logInfo: logRecoveryInfo, logWarning: logRecoveryWarning } =
  DesktopObservability.makeComponentLogger("desktop-side-by-side-recovery");

export interface LegacyT3CodeCollisionPaths {
  readonly programDirectory: string;
  readonly appUpdateYmlPath: string;
  readonly updaterCacheDirectory: string;
  readonly recoveryDirectory: string;
  readonly recoveryMarkerPath: string;
  readonly quarantinedUpdaterCacheDirectory: string;
}

export function resolveLegacyT3CodeCollisionPaths(
  environment: Pick<
    DesktopEnvironment.DesktopEnvironment["Service"],
    "localAppDataDirectory" | "path"
  >,
): LegacyT3CodeCollisionPaths {
  const programDirectory = environment.path.join(
    environment.localAppDataDirectory,
    "Programs",
    LEGACY_T3_CODE_PROGRAM_DIRECTORY,
  );
  const recoveryDirectory = environment.path.join(
    environment.localAppDataDirectory,
    RECOVERY_DIRECTORY,
  );
  return {
    programDirectory,
    appUpdateYmlPath: environment.path.join(programDirectory, "resources", "app-update.yml"),
    updaterCacheDirectory: environment.path.join(
      environment.localAppDataDirectory,
      LEGACY_T3_CODE_UPDATER_DIRECTORY,
    ),
    recoveryDirectory,
    recoveryMarkerPath: environment.path.join(recoveryDirectory, RECOVERY_MARKER),
    quarantinedUpdaterCacheDirectory: environment.path.join(
      recoveryDirectory,
      QUARANTINED_UPDATER_DIRECTORY,
    ),
  };
}

function hasYamlScalar(raw: string, key: string, expectedValue: string): boolean {
  const normalizedKey = key.toLowerCase();
  const normalizedExpectedValue = expectedValue.toLowerCase();
  return raw.split(/\r?\n/u).some((line) => {
    const separator = line.indexOf(":");
    if (separator < 0) return false;
    const candidateKey = line.slice(0, separator).trim().toLowerCase();
    const candidateValue = line
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    return candidateKey === normalizedKey && candidateValue === normalizedExpectedValue;
  });
}

export function isLegacyKamiCodeT3UpdaterConfig(raw: string): boolean {
  return hasYamlScalar(raw, "owner", "camie-ace") && hasYamlScalar(raw, "repo", "KamiCode");
}

export function isOfficialT3CodeUpdaterConfig(raw: string): boolean {
  return hasYamlScalar(raw, "owner", "pingdotgg") && hasYamlScalar(raw, "repo", "t3code");
}

const quarantineLegacyUpdaterCache = Effect.fn("desktop.sideBySideRecovery.quarantineUpdaterCache")(
  function* (paths: LegacyT3CodeCollisionPaths) {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(paths.updaterCacheDirectory))) return false;

    yield* fileSystem.makeDirectory(paths.recoveryDirectory, { recursive: true });
    if (yield* fileSystem.exists(paths.quarantinedUpdaterCacheDirectory)) {
      // The first cache is preserved for recovery evidence. Any cache recreated
      // while the payload is still contaminated is disposable updater data, not
      // projects, settings, or authentication state.
      yield* fileSystem.remove(paths.updaterCacheDirectory, { recursive: true, force: true });
    } else {
      yield* fileSystem.rename(paths.updaterCacheDirectory, paths.quarantinedUpdaterCacheDirectory);
    }
    return true;
  },
);

const showLegacyCollisionDialog = Effect.fn("desktop.sideBySideRecovery.showDialog")(function* (
  paths: LegacyT3CodeCollisionPaths,
) {
  const dialog = yield* ElectronDialog.ElectronDialog;
  const shell = yield* ElectronShell.ElectronShell;
  const result = yield* dialog.showMessageBox({
    type: "warning",
    title: "T3 Code needs one clean reinstall",
    message: "KamiCode is now safely isolated from T3 Code.",
    detail:
      "An older KamiCode installer used T3 Code's package directory, so T3 Code still contains a mixed application payload. The contaminated updater cache has been quarantined without touching projects or settings. Reinstall T3 Code once from its official download; future KamiCode and T3 Code installs will remain separate.",
    buttons: ["Open official T3 Code download", "Not now"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  yield* logRecoveryWarning("legacy T3 Code collision requires reinstall", {
    programDirectory: paths.programDirectory,
    updaterCacheDirectory: paths.updaterCacheDirectory,
    quarantinedUpdaterCacheDirectory: paths.quarantinedUpdaterCacheDirectory,
  });

  if (result.response === 0) {
    yield* shell.openExternal(OFFICIAL_T3_CODE_DOWNLOAD_URL);
  }
});

const checkLegacyT3CodeCollision = Effect.fn("desktop.sideBySideRecovery.check")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.platform !== "win32" || !environment.isPackaged) return;

  const fileSystem = yield* FileSystem.FileSystem;
  const paths = resolveLegacyT3CodeCollisionPaths(environment);
  const markerExists = yield* fileSystem.exists(paths.recoveryMarkerPath);
  const programDirectoryExists = yield* fileSystem.exists(paths.programDirectory);
  const appUpdateYmlExists = yield* fileSystem.exists(paths.appUpdateYmlPath);

  if (!programDirectoryExists) {
    if (markerExists) {
      yield* fileSystem.remove(paths.recoveryMarkerPath, { force: true });
    }
    return;
  }

  const appUpdateYml = appUpdateYmlExists
    ? yield* fileSystem.readFileString(paths.appUpdateYmlPath)
    : undefined;

  if (appUpdateYml !== undefined && isOfficialT3CodeUpdaterConfig(appUpdateYml)) {
    if (markerExists) {
      yield* fileSystem.remove(paths.recoveryMarkerPath, { force: true });
      yield* logRecoveryInfo("official T3 Code payload verified after legacy collision repair");
    }
    return;
  }

  const collisionConfirmed =
    appUpdateYml !== undefined && isLegacyKamiCodeT3UpdaterConfig(appUpdateYml);
  if (!collisionConfirmed && !markerExists) return;

  yield* fileSystem.makeDirectory(paths.recoveryDirectory, { recursive: true });
  yield* fileSystem.writeFileString(paths.recoveryMarkerPath, "1\n");
  const quarantined = yield* quarantineLegacyUpdaterCache(paths);
  if (quarantined) {
    yield* logRecoveryInfo("quarantined legacy shared updater cache", {
      updaterCacheDirectory: paths.updaterCacheDirectory,
      quarantinedUpdaterCacheDirectory: paths.quarantinedUpdaterCacheDirectory,
    });
  }
  yield* showLegacyCollisionDialog(paths);
});

export const recoverLegacyT3CodeCollision = checkLegacyT3CodeCollision().pipe(
  Effect.catch((error) =>
    logRecoveryWarning("legacy T3 Code collision check failed", {
      message: error instanceof Error ? error.message : String(error),
    }),
  ),
);
