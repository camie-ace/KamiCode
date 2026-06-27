// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  isCommonLocalMediaExtension,
  normalizeLocalMediaExtension,
  type CommonLocalMediaExtension,
} from "./localMediaSearch.ts";
import { createMediaArtifact, type MediaArtifact } from "./MediaArtifacts.ts";

export const GENERATED_MEDIA_SAFE_ROOT_FOLDER = ".kamicode";
export const GENERATED_MEDIA_FOLDER = "generated-media";
export const GENERATED_MEDIA_ROOT_RELATIVE_PATH = `${GENERATED_MEDIA_SAFE_ROOT_FOLDER}/${GENERATED_MEDIA_FOLDER}`;
export const DEFAULT_GENERATED_MEDIA_EXTENSION: CommonLocalMediaExtension = "png";

const SEGMENT_MAX_LENGTH = 80;

export interface GeneratedMediaDirectory {
  readonly threadSegment: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export interface GeneratedMediaPath extends GeneratedMediaDirectory {
  readonly fileName: string;
  readonly fileRelativePath: string;
  readonly fileAbsolutePath: string;
}

export interface GeneratedMediaArtifactRepresentation extends GeneratedMediaPath {
  readonly artifact: MediaArtifact;
  readonly markdownReference: string;
}

export function resolveGeneratedMediaDirectory(input: {
  readonly projectRoot: string;
  readonly threadId: string;
}): GeneratedMediaDirectory {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const threadSegment = toSafeGeneratedMediaPathSegment(input.threadId, "thread");
  const relativePath = joinPosix(GENERATED_MEDIA_ROOT_RELATIVE_PATH, threadSegment);
  const absolutePath = NodePath.resolve(projectRoot, relativePath);
  assertInsideRoot(projectRoot, absolutePath);

  return {
    threadSegment,
    relativePath,
    absolutePath,
  };
}

export function resolveGeneratedMediaPath(input: {
  readonly projectRoot: string;
  readonly threadId: string;
  readonly fileName: string;
}): GeneratedMediaPath {
  const directory = resolveGeneratedMediaDirectory(input);
  const fileName = sanitizeGeneratedMediaFileName(input.fileName);
  const fileRelativePath = joinPosix(directory.relativePath, fileName);
  const fileAbsolutePath = NodePath.resolve(directory.absolutePath, fileName);
  assertInsideRoot(resolveProjectRoot(input.projectRoot), fileAbsolutePath);

  return {
    ...directory,
    fileName,
    fileRelativePath,
    fileAbsolutePath,
  };
}

export function representGeneratedMediaArtifact(input: {
  readonly projectRoot: string;
  readonly threadId: string;
  readonly fileName: string;
  readonly title?: string;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
  readonly score?: number;
}): GeneratedMediaArtifactRepresentation {
  const path = resolveGeneratedMediaPath(input);
  const extension = normalizeGeneratedMediaExtension(NodePath.extname(path.fileName));
  const artifact = createMediaArtifact({
    id: `generated:${path.threadSegment}:${path.fileName}`,
    target: path.fileRelativePath,
    source: "generated",
    title: input.title?.trim() || path.fileName,
    extension,
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.modifiedAt !== undefined ? { modifiedAt: input.modifiedAt } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
  });
  if (!artifact) {
    throw new Error(`Generated media extension is not representable: ${path.fileName}`);
  }

  return {
    ...path,
    artifact,
    markdownReference: `[${escapeMarkdownLinkText(artifact.title)}](${path.fileRelativePath})`,
  };
}

export function sanitizeGeneratedMediaFileName(fileName: string): string {
  const baseName = lastPathSegment(fileName);
  const extensionMatch = /\.([a-z0-9]{1,8})$/iu.exec(baseName);
  const extension = normalizeGeneratedMediaExtension(extensionMatch?.[1]);
  const rawStem = extensionMatch ? baseName.slice(0, -extensionMatch[0].length) : baseName;
  const safeStem = toSafeGeneratedMediaPathSegment(rawStem, "generated-media");

  return `${safeStem}.${extension}`;
}

export function normalizeGeneratedMediaExtension(
  extension: string | undefined,
): CommonLocalMediaExtension {
  const normalized = extension === undefined ? null : normalizeLocalMediaExtension(extension);
  if (normalized !== null && isCommonLocalMediaExtension(normalized)) {
    return normalized;
  }
  return DEFAULT_GENERATED_MEDIA_EXTENSION;
}

export function toSafeGeneratedMediaPathSegment(input: string, fallback: string): string {
  const segment = input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "")
    .slice(0, SEGMENT_MAX_LENGTH)
    .replace(/[-_]+$/gu, "");

  return segment.length > 0 ? segment : fallback;
}

function resolveProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.trim();
  if (trimmed.length === 0) {
    throw new Error("projectRoot is required for generated media paths.");
  }
  return NodePath.resolve(trimmed);
}

function lastPathSegment(path: string): string {
  const segments = path.trim().replace(/\\/gu, "/").split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) return segment;
  }
  return "";
}

function joinPosix(...segments: readonly string[]): string {
  return segments.join("/").replace(/\/+/gu, "/");
}

function assertInsideRoot(root: string, absolutePath: string): void {
  const relative = NodePath.relative(root, absolutePath);
  if (relative === "" || relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    throw new Error(`Generated media path escaped project root: ${absolutePath}`);
  }
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\\\]]/gu, "\\$&");
}
