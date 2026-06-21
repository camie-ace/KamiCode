import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedErrorClass<DesktopApplicationMenuActionError>()(
  "DesktopApplicationMenuActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop menu action "${this.action}" failed.`;
  }
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  {
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog;

const { logInfo: logUpdaterInfo } = makeComponentLogger("desktop-updater");

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const showUpdateDownloadDialog = Effect.fn("desktop.menu.showUpdateDownloadDialog")(function* (
  version: string | null,
) {
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* electronDialog.showMessageBox({
    type: "info",
    title: "Update available",
    message: `KamiCode ${version ?? "update"} is available.`,
    detail: "Download it now? You can keep using KamiCode while the update downloads.",
    buttons: ["Later", "Download Update"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
});

const showUpdateInstallDialog = Effect.fn("desktop.menu.showUpdateInstallDialog")(function* (
  version: string | null,
) {
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* electronDialog.showMessageBox({
    type: "question",
    title: "Update ready",
    message: `KamiCode ${version ?? "update"} has been downloaded.`,
    detail: "Restart KamiCode now to install it? Any running tasks will be interrupted.",
    buttons: ["Later", "Restart and Install"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
});

const showUpdateDownloadFailureDialog = Effect.fn("desktop.menu.showUpdateDownloadFailureDialog")(
  function* (message: string | null) {
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "Update download failed",
      message: "Could not download the update.",
      detail: message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  },
);

const showUpdateInstallFailureDialog = Effect.fn("desktop.menu.showUpdateInstallFailureDialog")(
  function* (message: string | null) {
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "Update install failed",
      message: "Could not restart and install the update.",
      detail: message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  },
);

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action);
});

const checkForUpdatesFromMenu = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* updates.check("menu");
  const updateState = result.state;

  if (updateState.status === "up-to-date") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `KamiCode ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "available") {
    const shouldDownload = yield* showUpdateDownloadDialog(updateState.availableVersion);
    if (!shouldDownload) return;

    const downloadResult = yield* updates.download;
    if (!downloadResult.accepted || !downloadResult.completed) {
      yield* showUpdateDownloadFailureDialog(downloadResult.state.message);
      return;
    }

    const downloadedState = downloadResult.state;
    if (downloadedState.status !== "downloaded") {
      yield* electronDialog.showMessageBox({
        type: "info",
        title: "Update download started",
        message: "KamiCode is downloading the update.",
        detail: "Use Help > Check for Updates... again after the download finishes.",
        buttons: ["OK"],
      });
      return;
    }

    const shouldInstall = yield* showUpdateInstallDialog(
      downloadedState.downloadedVersion ?? downloadedState.availableVersion,
    );
    if (!shouldInstall) return;

    const installResult = yield* updates.install;
    if (!installResult.accepted) {
      yield* showUpdateInstallFailureDialog(installResult.state.message);
    }
  } else if (updateState.status === "downloaded") {
    const shouldInstall = yield* showUpdateInstallDialog(
      updateState.downloadedVersion ?? updateState.availableVersion,
    );
    if (!shouldInstall) return;

    const installResult = yield* updates.install;
    if (!installResult.accepted) {
      yield* showUpdateInstallFailureDialog(installResult.state.message);
    }
  } else if (updateState.status === "downloading") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "Update downloading",
      message: "KamiCode is already downloading an update.",
      detail: "Use Help > Check for Updates... again after the download finishes.",
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}).pipe(Effect.withSpan("desktop.menu.checkForUpdates"));

const handleCheckForUpdatesMenuClick = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const disabledReason = yield* updates.disabledReason;
  if (Option.isSome(disabledReason)) {
    yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
      disabledReason: disabledReason.value,
    });
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason.value,
      buttons: ["OK"],
    });
    return;
  }

  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.ensureMain;
  yield* checkForUpdatesFromMenu;
}).pipe(Effect.withSpan("desktop.menu.handleCheckForUpdatesClick"));

export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const appName = yield* electronApp.name;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopApplicationMenuActionError({ action, cause });
          return logMenuError(error.message, { error });
        }),
      ),
    );
  };

  const configure = Effect.gen(function* () {
    const checkForUpdatesClick = () => {
      runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick);
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          { role: environment.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
