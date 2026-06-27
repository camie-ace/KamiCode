import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { openExternalMock, showItemInFolderMock, writeTextMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  showItemInFolderMock: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: openExternalMock,
    showItemInFolder: showItemInFolderMock,
  },
  clipboard: {
    writeText: writeTextMock,
  },
}));

import * as ElectronShell from "./ElectronShell.ts";

describe("ElectronShell", () => {
  beforeEach(() => {
    openExternalMock.mockReset();
    showItemInFolderMock.mockReset();
    writeTextMock.mockReset();
  });

  it.effect("opens safe external URLs", () =>
    Effect.gen(function* () {
      openExternalMock.mockResolvedValue(undefined);

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("https://example.com/path");

      assert.equal(result, true);
      assert.deepEqual(openExternalMock.mock.calls, [["https://example.com/path"]]);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("does not open unsafe external URLs", () =>
    Effect.gen(function* () {
      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("file:///etc/passwd");

      assert.equal(result, false);
      assert.equal(openExternalMock.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("returns false when Electron rejects openExternal", () =>
    Effect.gen(function* () {
      openExternalMock.mockRejectedValue(new Error("open failed"));

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.openExternal("https://example.com/path");

      assert.equal(result, false);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("reveals absolute local media paths in the OS file browser", () =>
    Effect.gen(function* () {
      const mediaPath = "C:\\tmp\\hero-image.PNG";
      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.revealLocalMediaFile(mediaPath);

      assert.equal(result, true);
      assert.deepEqual(showItemInFolderMock.mock.calls, [[mediaPath]]);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("does not reveal relative paths, URLs, or non-media files", () =>
    Effect.gen(function* () {
      const electronShell = yield* ElectronShell.ElectronShell;

      assert.equal(yield* electronShell.revealLocalMediaFile("media/hero.png"), false);
      assert.equal(yield* electronShell.revealLocalMediaFile("file:///tmp/hero.png"), false);
      assert.equal(yield* electronShell.revealLocalMediaFile("C:\\tmp\\secret.txt"), false);

      assert.equal(showItemInFolderMock.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );

  it.effect("returns false when Electron cannot reveal the media file", () =>
    Effect.gen(function* () {
      showItemInFolderMock.mockImplementation(() => {
        throw new Error("reveal failed");
      });

      const electronShell = yield* ElectronShell.ElectronShell;
      const result = yield* electronShell.revealLocalMediaFile("C:\\tmp\\hero.png");

      assert.equal(result, false);
    }).pipe(Effect.provide(ElectronShell.layer)),
  );
});
