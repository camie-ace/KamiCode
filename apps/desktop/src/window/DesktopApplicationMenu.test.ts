import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";
import type { DesktopUpdateState } from "@t3tools/contracts";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "linux",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
  metadata: Effect.die("unexpected metadata read"),
  name: Effect.succeed("KamiCode"),
  whenReady: Effect.void,
  quit: Effect.void,
  exit: () => Effect.void,
  relaunch: () => Effect.void,
  setPath: () => Effect.void,
  setName: () => Effect.void,
  setAboutPanelOptions: () => Effect.void,
  setAppUserModelId: () => Effect.void,
  requestSingleInstanceLock: Effect.succeed(true),
  isDefaultProtocolClient: () => Effect.succeed(false),
  setAsDefaultProtocolClient: () => Effect.succeed(true),
  setDesktopName: () => Effect.void,
  setDockIcon: () => Effect.void,
  appendCommandLineSwitch: () => Effect.void,
  on: () => Effect.void,
} satisfies ElectronApp.ElectronApp["Service"]);

const electronDialogShape = {
  pickFolder: () => Effect.succeed(Option.none()),
  confirm: () => Effect.succeed(false),
  showMessageBox: () => Effect.succeed({ response: 0, checkboxChecked: false }),
  showErrorBox: () => Effect.void,
} satisfies ElectronDialog.ElectronDialog["Service"];

const electronDialogLayer = Layer.succeed(ElectronDialog.ElectronDialog, electronDialogShape);

const baseUpdateState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.2.3",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

const desktopUpdatesShape = {
  getState: Effect.die("unexpected getState"),
  emitState: Effect.void,
  disabledReason: Effect.succeed(Option.none()),
  configure: Effect.void,
  setChannel: () => Effect.die("unexpected setChannel"),
  check: () => Effect.die("unexpected check"),
  download: Effect.die("unexpected download"),
  install: Effect.die("unexpected install"),
} satisfies DesktopUpdates.DesktopUpdates["Service"];

const desktopUpdatesLayer = Layer.succeed(DesktopUpdates.DesktopUpdates, desktopUpdatesShape);

const makeDesktopWindowLayer = (selectedAction: Deferred.Deferred<string>) =>
  Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected createMain"),
    ensureMain: Effect.succeed({} as Electron.BrowserWindow),
    revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    showConnectingSplash: Effect.void,
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    dispatchMenuAction: (action) => Deferred.succeed(selectedAction, action).pipe(Effect.asVoid),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindow["Service"]);

const makeElectronMenuLayer = (
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Deferred.succeed(applicationMenuTemplate, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeed(Option.none()),
  } satisfies ElectronMenu.ElectronMenu["Service"]);

const findMenuItem = (
  template: readonly Electron.MenuItemConstructorOptions[],
  label: string,
): Electron.MenuItemConstructorOptions | undefined => {
  for (const item of template) {
    if (item.label === label) return item;
    if (Array.isArray(item.submenu)) {
      const child = findMenuItem(item.submenu, label);
      if (child) return child;
    }
  }
  return undefined;
};

const clickMenuItem = (item: Electron.MenuItemConstructorOptions) => {
  if (typeof item.click !== "function") {
    throw new Error(`Expected ${String(item.label)} menu item to have a click handler.`);
  }
  item.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
};

describe("DesktopApplicationMenu", () => {
  it.effect("installs the native menu and routes Settings through DesktopWindow", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
            Layer.provideMerge(makeDesktopWindowLayer(selectedAction)),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(electronDialogLayer),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const fileMenu = template.find((item) => item.label === "File");
      assert.isDefined(fileMenu);
      if (!Array.isArray(fileMenu.submenu)) {
        throw new Error("Expected File menu submenu to be an array.");
      }
      const settingsItem = fileMenu.submenu.find((item) => item.label === "Settings...");
      assert.isDefined(settingsItem);
      clickMenuItem(settingsItem);
      assert.equal(yield* Deferred.await(selectedAction), "open-settings");
    }),
  );

  it.effect("downloads and installs an available update from the native menu", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
      const downloadRequested = yield* Deferred.make<void>();
      const installRequested = yield* Deferred.make<void>();
      const dialogTitles: string[] = [];

      const availableState: DesktopUpdateState = {
        ...baseUpdateState,
        status: "available",
        availableVersion: "1.2.4",
      };
      const downloadedState: DesktopUpdateState = {
        ...availableState,
        status: "downloaded",
        downloadedVersion: "1.2.4",
      };

      const menuLayer = DesktopApplicationMenu.layer.pipe(
        Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
        Layer.provideMerge(makeDesktopWindowLayer(selectedAction)),
        Layer.provideMerge(
          Layer.succeed(DesktopUpdates.DesktopUpdates, {
            ...desktopUpdatesShape,
            getState: Effect.succeed(baseUpdateState),
            check: () => Effect.succeed({ checked: true, state: availableState }),
            download: Deferred.succeed(downloadRequested, undefined).pipe(
              Effect.as({ accepted: true, completed: true, state: downloadedState }),
            ),
            install: Deferred.succeed(installRequested, undefined).pipe(
              Effect.as({ accepted: true, completed: false, state: downloadedState }),
            ),
          } satisfies DesktopUpdates.DesktopUpdates["Service"]),
        ),
        Layer.provideMerge(
          Layer.succeed(ElectronDialog.ElectronDialog, {
            ...electronDialogShape,
            showMessageBox: (options) =>
              Effect.sync(() => {
                dialogTitles.push(String(options.title));
                return { response: 1, checkboxChecked: false };
              }),
          } satisfies ElectronDialog.ElectronDialog["Service"]),
        ),
        Layer.provideMerge(electronAppLayer),
        Layer.provideMerge(
          DesktopEnvironment.layer(environmentInput).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(Effect.provide(menuLayer));

      const checkForUpdates = findMenuItem(
        yield* Deferred.await(applicationMenuTemplate),
        "Check for Updates...",
      );
      assert.isDefined(checkForUpdates);
      clickMenuItem(checkForUpdates);

      yield* Deferred.await(downloadRequested);
      yield* Deferred.await(installRequested);
      assert.deepEqual(dialogTitles, ["Update available", "Update ready"]);
    }),
  );

  it.effect("installs an already downloaded update from the native menu", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
      const installRequested = yield* Deferred.make<void>();

      const downloadedState: DesktopUpdateState = {
        ...baseUpdateState,
        status: "downloaded",
        availableVersion: "1.2.4",
        downloadedVersion: "1.2.4",
      };

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
            Layer.provideMerge(makeDesktopWindowLayer(selectedAction)),
            Layer.provideMerge(
              Layer.succeed(DesktopUpdates.DesktopUpdates, {
                getState: Effect.succeed(downloadedState),
                emitState: Effect.void,
                disabledReason: Effect.succeed(Option.none()),
                configure: Effect.void,
                setChannel: () => Effect.die("unexpected setChannel"),
                check: () => Effect.succeed({ checked: true, state: downloadedState }),
                download: Effect.die("unexpected download"),
                install: Deferred.succeed(installRequested, undefined).pipe(
                  Effect.as({ accepted: true, completed: false, state: downloadedState }),
                ),
              } satisfies DesktopUpdates.DesktopUpdates["Service"]),
            ),
            Layer.provideMerge(
              Layer.succeed(ElectronDialog.ElectronDialog, {
                pickFolder: () => Effect.succeed(Option.none()),
                confirm: () => Effect.succeed(false),
                showMessageBox: () => Effect.succeed({ response: 1, checkboxChecked: false }),
                showErrorBox: () => Effect.void,
              } satisfies ElectronDialog.ElectronDialog["Service"]),
            ),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const checkForUpdates = findMenuItem(
        yield* Deferred.await(applicationMenuTemplate),
        "Check for Updates...",
      );
      assert.isDefined(checkForUpdates);
      clickMenuItem(checkForUpdates);

      yield* Deferred.await(installRequested);
    }),
  );
});
