import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  dialog: {},
  shell: {},
}));

import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopSideBySideRecovery from "./DesktopSideBySideRecovery.ts";

const makeDialogLayer = (dialogs: Array<Record<string, unknown>>, response: number) =>
  Layer.succeed(ElectronDialog.ElectronDialog, {
    pickFolder: () => Effect.succeed(Option.none()),
    confirm: () => Effect.succeed(false),
    showMessageBox: (options) =>
      Effect.sync(() => {
        dialogs.push(options as unknown as Record<string, unknown>);
        return { response, checkboxChecked: false };
      }),
    showErrorBox: () => Effect.void,
  } satisfies ElectronDialog.ElectronDialog["Service"]);

const makeShellLayer = (openedUrls: unknown[]) =>
  Layer.succeed(ElectronShell.ElectronShell, {
    openExternal: (rawUrl) =>
      Effect.sync(() => {
        openedUrls.push(rawUrl);
        return true;
      }),
    revealLocalMediaFile: () => Effect.succeed(false),
    copyText: () => Effect.void,
  } satisfies ElectronShell.ElectronShell["Service"]);

const makeEnvironmentLayer = (localAppDataDirectory: string, path: Path.Path) =>
  Layer.succeed(
    DesktopEnvironment.DesktopEnvironment,
    DesktopEnvironment.DesktopEnvironment.of({
      platform: "win32",
      isPackaged: true,
      localAppDataDirectory,
      path,
    } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
  );

describe("DesktopSideBySideRecovery", () => {
  it("recognizes only the known KamiCode-owned updater payload", () => {
    assert.isTrue(
      DesktopSideBySideRecovery.isLegacyKamiCodeT3UpdaterConfig(
        "owner: camie-ace\nrepo: KamiCode\nprovider: github\n",
      ),
    );
    assert.isFalse(
      DesktopSideBySideRecovery.isLegacyKamiCodeT3UpdaterConfig(
        "owner: pingdotgg\nrepo: t3code\nprovider: github\n",
      ),
    );
    assert.isTrue(
      DesktopSideBySideRecovery.isOfficialT3CodeUpdaterConfig(
        "repo: t3code\nowner: pingdotgg\nprovider: github\n",
      ),
    );
  });

  it.effect("quarantines a poisoned updater cache and opens the official repair download", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const localAppDataDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "kamicode-side-by-side-recovery-",
      });
      const environment = DesktopEnvironment.DesktopEnvironment.of({
        platform: "win32",
        isPackaged: true,
        localAppDataDirectory,
        path,
      } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
      const paths = DesktopSideBySideRecovery.resolveLegacyT3CodeCollisionPaths(environment);
      yield* fileSystem.makeDirectory(path.dirname(paths.appUpdateYmlPath), { recursive: true });
      yield* fileSystem.writeFileString(
        paths.appUpdateYmlPath,
        "owner: camie-ace\nrepo: KamiCode\nprovider: github\nupdaterCacheDirName: t3code-updater\n",
      );
      yield* fileSystem.makeDirectory(path.join(paths.updaterCacheDirectory, "pending"), {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        path.join(paths.updaterCacheDirectory, "pending", "update-info.json"),
        '{"fileName":"KamiCode-nightly.exe"}\n',
      );

      const dialogs: Array<Record<string, unknown>> = [];
      const openedUrls: unknown[] = [];
      yield* DesktopSideBySideRecovery.recoverLegacyT3CodeCollision.pipe(
        Effect.provide(
          Layer.mergeAll(
            makeEnvironmentLayer(localAppDataDirectory, path),
            makeDialogLayer(dialogs, 0),
            makeShellLayer(openedUrls),
          ),
        ),
      );

      assert.isFalse(yield* fileSystem.exists(paths.updaterCacheDirectory));
      assert.isTrue(
        yield* fileSystem.exists(
          path.join(paths.quarantinedUpdaterCacheDirectory, "pending", "update-info.json"),
        ),
      );
      assert.isTrue(yield* fileSystem.exists(paths.recoveryMarkerPath));
      assert.equal(dialogs.length, 1);
      assert.equal(dialogs[0]?.title, "T3 Code needs one clean reinstall");
      assert.deepEqual(openedUrls, [DesktopSideBySideRecovery.OFFICIAL_T3_CODE_DOWNLOAD_URL]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves an official T3 Code payload and updater cache untouched", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const localAppDataDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "kamicode-side-by-side-clean-",
      });
      const environment = DesktopEnvironment.DesktopEnvironment.of({
        platform: "win32",
        isPackaged: true,
        localAppDataDirectory,
        path,
      } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
      const paths = DesktopSideBySideRecovery.resolveLegacyT3CodeCollisionPaths(environment);
      yield* fileSystem.makeDirectory(path.dirname(paths.appUpdateYmlPath), { recursive: true });
      yield* fileSystem.writeFileString(
        paths.appUpdateYmlPath,
        "owner: pingdotgg\nrepo: t3code\nprovider: github\nupdaterCacheDirName: t3code-updater\n",
      );
      yield* fileSystem.makeDirectory(paths.updaterCacheDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(paths.updaterCacheDirectory, "official-installer.exe"),
        "official",
      );
      yield* fileSystem.makeDirectory(paths.recoveryDirectory, { recursive: true });
      yield* fileSystem.writeFileString(paths.recoveryMarkerPath, "1\n");

      const dialogs: Array<Record<string, unknown>> = [];
      const openedUrls: unknown[] = [];
      yield* DesktopSideBySideRecovery.recoverLegacyT3CodeCollision.pipe(
        Effect.provide(
          Layer.mergeAll(
            makeEnvironmentLayer(localAppDataDirectory, path),
            makeDialogLayer(dialogs, 1),
            makeShellLayer(openedUrls),
          ),
        ),
      );

      assert.isTrue(
        yield* fileSystem.exists(path.join(paths.updaterCacheDirectory, "official-installer.exe")),
      );
      assert.isFalse(yield* fileSystem.exists(paths.recoveryMarkerPath));
      assert.equal(dialogs.length, 0);
      assert.deepEqual(openedUrls, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
