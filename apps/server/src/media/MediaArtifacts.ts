export type MediaArtifactKind = "image" | "video" | "gif" | "unknown";
export type MediaArtifactSource = "generated" | "local" | "web" | "project";

export interface MediaArtifact {
  readonly id: string;
  readonly kind: MediaArtifactKind;
  readonly source: MediaArtifactSource;
  readonly title: string;
  readonly path?: string;
  readonly url?: string;
  readonly extension: string;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
  readonly score?: number;
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const GIF_EXTENSIONS = new Set(["gif"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogg", "ogv", "webm"]);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...GIF_EXTENSIONS, ...VIDEO_EXTENSIONS]);

export function normalizeMediaExtension(extension: string): string {
  return extension.toLowerCase().replace(/^\./, "");
}

export function isSupportedMediaExtension(extension: string): boolean {
  return MEDIA_EXTENSIONS.has(normalizeMediaExtension(extension));
}

export function mediaKindForExtension(extension: string): MediaArtifactKind {
  const normalized = normalizeMediaExtension(extension);
  if (GIF_EXTENSIONS.has(normalized)) return "gif";
  if (IMAGE_EXTENSIONS.has(normalized)) return "image";
  if (VIDEO_EXTENSIONS.has(normalized)) return "video";
  return "unknown";
}

export function extensionFromMediaTarget(target: string): string | null {
  const withoutQuery = target.split(/[?#]/, 1)[0] ?? target;
  const match = /\.([a-z0-9]{1,8})$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? null;
}

export function createMediaArtifact(input: {
  readonly id: string;
  readonly target: string;
  readonly source: MediaArtifactSource;
  readonly title: string;
  readonly extension: string;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
  readonly score?: number;
}): MediaArtifact | null {
  const extension = normalizeMediaExtension(input.extension);
  if (!isSupportedMediaExtension(extension)) {
    return null;
  }

  return {
    id: input.id,
    kind: mediaKindForExtension(extension),
    source: input.source,
    title: input.title,
    path: input.target,
    extension,
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.modifiedAt !== undefined ? { modifiedAt: input.modifiedAt } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
  };
}
