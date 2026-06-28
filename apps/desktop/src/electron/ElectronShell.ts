import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const SAFE_LOCAL_MEDIA_EXTENSIONS = new Set([
  "aac",
  "avif",
  "bmp",
  "flac",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "m4a",
  "m4v",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "ogv",
  "opus",
  "png",
  "svg",
  "tif",
  "tiff",
  "wav",
  "weba",
  "webm",
  "webp",
]);

export function parseSafeExternalUrl(rawUrl: unknown): Option.Option<string> {
  if (typeof rawUrl !== "string") {
    return Option.none();
  }

  try {
    const url = new URL(rawUrl);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? Option.some(url.href) : Option.none();
  } catch {
    return Option.none();
  }
}

export function parseSafeLocalMediaPath(rawPath: unknown): Option.Option<string> {
  if (typeof rawPath !== "string") {
    return Option.none();
  }

  const trimmedPath = rawPath.trim();
  if (trimmedPath.length === 0 || trimmedPath.includes("\0")) {
    return Option.none();
  }
  if (!isAbsoluteLocalPath(trimmedPath)) {
    return Option.none();
  }

  const extension = extensionFromLocalPath(trimmedPath);
  if (!SAFE_LOCAL_MEDIA_EXTENSIONS.has(extension)) {
    return Option.none();
  }

  return Option.some(trimmedPath);
}

function isAbsoluteLocalPath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]|\/)/u.test(path);
}

function extensionFromLocalPath(path: string): string {
  const withoutQuery = path.split(/[?#]/u, 1)[0] ?? path;
  const match = /\.([a-z0-9]{1,8})$/iu.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? "";
}

export class ElectronShell extends Context.Service<
  ElectronShell,
  {
    readonly openExternal: (rawUrl: unknown) => Effect.Effect<boolean>;
    readonly revealLocalMediaFile: (rawPath: unknown) => Effect.Effect<boolean>;
    readonly copyText: (text: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/electron/ElectronShell") {}

export const make = ElectronShell.of({
  openExternal: (rawUrl) =>
    Option.match(parseSafeExternalUrl(rawUrl), {
      onNone: () => Effect.succeed(false),
      onSome: (externalUrl) =>
        Effect.promise(() =>
          Electron.shell.openExternal(externalUrl).then(
            () => true,
            () => false,
          ),
        ),
    }),
  revealLocalMediaFile: (rawPath) =>
    Option.match(parseSafeLocalMediaPath(rawPath), {
      onNone: () => Effect.succeed(false),
      onSome: (mediaPath) =>
        Effect.try({
          try: () => Electron.shell.showItemInFolder(mediaPath),
          catch: () => undefined,
        }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ),
    }),
  copyText: (text) =>
    Effect.sync(() => {
      Electron.clipboard.writeText(text);
    }),
});

export const layer = Layer.succeed(ElectronShell, make);
