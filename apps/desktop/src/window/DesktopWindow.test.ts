import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<typeof import("electron")>()),
  session: {
    fromPartition: vi.fn(() => ({
      getUserAgent: vi.fn(() => "Mozilla/5.0 Electron/41.5.0 t3code/1.2.3"),
      setPermissionRequestHandler: vi.fn(),
      setUserAgent: vi.fn(),
    })),
  },
}));

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as PreviewManager from "../preview/Manager.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

function makeFakeBrowserWindow() {
  const webContentsListeners = new Map<string, (...args: readonly unknown[]) => void>();
  const webContents = {
    copyImageAt: vi.fn(),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      webContentsListeners.set(eventName, listener);
    }),
    once: vi.fn(),
    openDevTools: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const window = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setIcon: vi.fn(),
    setTitle: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    show: vi.fn(),
    webContents,
  };

  return {
    window: window as unknown as Electron.BrowserWindow,
    loadURL: window.loadURL,
    openDevTools: webContents.openDevTools,
    setIcon: window.setIcon,
    setWindowOpenHandler: webContents.setWindowOpenHandler,
    webContentsListeners,
  };
}

const emptyIconPaths = {
  ico: Option.none<string>(),
  icns: Option.none<string>(),
  png: Option.none<string>(),
} satisfies DesktopAssets.DesktopIconPaths;

function makeDesktopAssetsLayer(iconPaths: DesktopAssets.DesktopIconPaths = emptyIconPaths) {
  return Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: iconPaths.ico,
      icns: iconPaths.icns,
      png: iconPaths.png,
    }),
    resolveResourcePath: () => Effect.succeed(Option.none<string>()),
  } satisfies DesktopAssets.DesktopAssetsShape);
}

const desktopServerExposureLayer = Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
  getState: Effect.die("unexpected getState"),
  backendConfig: Effect.succeed({
    port: 3773,
    bindHost: "127.0.0.1",
    httpBaseUrl: new URL("http://127.0.0.1:3773"),
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  }),
  configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
  setMode: () => Effect.die("unexpected setMode"),
  setTailscaleServeEnabled: () => Effect.die("unexpected setTailscaleServeEnabled"),
  getAdvertisedEndpoints: Effect.die("unexpected getAdvertisedEndpoints"),
} satisfies DesktopServerExposure.DesktopServerExposureShape);

const electronMenuLayer = Layer.succeed(ElectronMenu.ElectronMenu, {
  setApplicationMenu: () => Effect.void,
  popupTemplate: () => Effect.void,
  showContextMenu: () => Effect.succeed(Option.none()),
} satisfies ElectronMenu.ElectronMenuShape);

const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
  shouldUseDarkColors: Effect.succeed(false),
  setSource: () => Effect.void,
  onUpdated: () => Effect.void,
} satisfies ElectronTheme.ElectronThemeShape);

function makeTestLayer(input: {
  readonly window: Electron.BrowserWindow;
  readonly createCount: Ref.Ref<number>;
  readonly mainWindow: Ref.Ref<Option.Option<Electron.BrowserWindow>>;
  readonly createOptions?: Ref.Ref<Option.Option<Electron.BrowserWindowConstructorOptions>>;
  readonly openExternal?: ElectronShell.ElectronShellShape["openExternal"];
  readonly environmentInput?: DesktopEnvironment.MakeDesktopEnvironmentInput;
  readonly iconPaths?: DesktopAssets.DesktopIconPaths;
  readonly openedExternalUrls?: unknown[];
}) {
  const desktopEnvironmentLayer = DesktopEnvironment.layer(
    input.environmentInput ?? environmentInput,
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          T3CODE_PORT: "3773",
          VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
        }),
      ),
    ),
  );
  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: (options) =>
      Effect.gen(function* () {
        yield* Ref.update(input.createCount, (count) => count + 1);
        if (input.createOptions) {
          yield* Ref.set(input.createOptions, Option.some(options));
        }
        return input.window;
      }),
    main: Ref.get(input.mainWindow),
    currentMainOrFirst: Ref.get(input.mainWindow),
    focusedMainOrFirst: Ref.get(input.mainWindow),
    setMain: (window) => Ref.set(input.mainWindow, Option.some(window)),
    clearMain: () => Ref.set(input.mainWindow, Option.none()),
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: (sync) => sync(input.window),
  } satisfies ElectronWindow.ElectronWindowShape);

  return DesktopWindow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeDesktopAssetsLayer(input.iconPaths),
        desktopEnvironmentLayer,
        desktopServerExposureLayer,
        DesktopState.layer,
        electronMenuLayer,
        input.openExternal
          ? Layer.succeed(ElectronShell.ElectronShell, {
              openExternal: input.openExternal,
              copyText: () => Effect.void,
            } satisfies ElectronShell.ElectronShellShape)
          : Layer.succeed(ElectronShell.ElectronShell, {
              openExternal: (url) =>
                Effect.sync(() => {
                  input.openedExternalUrls?.push(url);
                  return true;
                }),
              copyText: () => Effect.void,
            } satisfies ElectronShell.ElectronShellShape),
        electronThemeLayer,
        electronWindowLayer,
        Layer.mock(PreviewManager.PreviewManager)({
          getBrowserSession: () => Effect.succeed({} as Electron.Session),
          setMainWindow: () => Effect.void,
          isBrowserPartition: (partition) => partition.startsWith("persist:t3code-preview-"),
          getBrowserPartition: () => Effect.succeed("persist:t3code-preview-test"),
        }),
      ),
    ),
  );
}

describe("DesktopWindow", () => {
  it("recognizes only same-origin renderer navigations", () => {
    assert.isTrue(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "http://127.0.0.1:3773/",
        navigationUrl: "http://127.0.0.1:3773/settings/connections",
      }),
    );
    assert.isFalse(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "http://127.0.0.1:3773/",
        navigationUrl: "https://accounts.microsoft.com/oauth",
      }),
    );
    assert.isFalse(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "http://127.0.0.1:3773/",
        navigationUrl: "not a url",
      }),
    );
  });

  it.effect("does not open a development window until the backend is ready", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.activate;
        assert.equal(yield* Ref.get(createCount), 0);

        yield* desktopWindow.handleBackendReady;
        assert.equal(yield* Ref.get(createCount), 1);
        assert.deepEqual(fakeWindow.loadURL.mock.calls[0], ["http://127.0.0.1:5733/"]);
        assert.equal(fakeWindow.openDevTools.mock.calls.length, 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("applies the Windows window icon from desktop resources", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const createOptions = yield* Ref.make<
        Option.Option<Electron.BrowserWindowConstructorOptions>
      >(Option.none());
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const iconPath = "/repo/apps/desktop/resources/icon.ico";
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        createOptions,
        mainWindow,
        environmentInput: {
          ...environmentInput,
          platform: "win32",
        },
        iconPaths: {
          ico: Option.some(iconPath),
          icns: Option.none(),
          png: Option.none(),
        },
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady;

        const options = yield* Ref.get(createOptions);
        assert.equal(Option.isSome(options), true);
        assert.equal(Option.isSome(options) ? options.value.icon : undefined, iconPath);
        assert.deepEqual(fakeWindow.setIcon.mock.calls[0], [iconPath]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("opens safe off-origin renderer navigations in the system browser", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const openedExternalUrls: unknown[] = [];
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        openedExternalUrls,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady;

        const willNavigate = fakeWindow.webContentsListeners.get("will-navigate");
        if (!willNavigate) {
          return yield* Effect.die("will-navigate listener was not registered");
        }
        let prevented = false;
        willNavigate(
          {
            preventDefault: () => {
              prevented = true;
            },
          },
          "https://accounts.microsoft.com/oauth",
        );
        yield* Effect.promise(() => Promise.resolve());

        assert.isTrue(prevented);
        assert.deepEqual(openedExternalUrls, ["https://accounts.microsoft.com/oauth"]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps app-origin target blank URLs inside Electron", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const openExternal = vi.fn<ElectronShell.ElectronShellShape["openExternal"]>(() =>
        Effect.succeed(true),
      );
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        openExternal,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady;

        const handler = fakeWindow.setWindowOpenHandler.mock.calls[0]?.[0] as
          | ((details: { readonly url: string }) => { readonly action: string })
          | undefined;
        assert.notEqual(handler, undefined);
        const result = handler?.({
          url: "http://127.0.0.1:3773/api/test-harness/artifact?path=screenshot.png",
        });

        assert.equal(result?.action, "allow");
        assert.equal(openExternal.mock.calls.length, 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("opens external target blank URLs in the system browser", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const openExternal = vi.fn<ElectronShell.ElectronShellShape["openExternal"]>(() =>
        Effect.succeed(true),
      );
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        openExternal,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady;

        const handler = fakeWindow.setWindowOpenHandler.mock.calls[0]?.[0] as
          | ((details: { readonly url: string }) => { readonly action: string })
          | undefined;
        assert.notEqual(handler, undefined);
        const result = handler?.({ url: "https://example.com/docs" });

        assert.equal(result?.action, "deny");
        assert.deepEqual(
          openExternal.mock.calls.map(([url]) => url),
          ["https://example.com/docs"],
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});
