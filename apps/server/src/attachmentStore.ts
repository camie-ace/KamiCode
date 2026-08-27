// @effect-diagnostics nodeBuiltinImport:off
import Mime from "@effect/platform-node/Mime";
import { WORKSPACE_DOCUMENT_FILE_EXTENSIONS } from "@t3tools/shared/filePreview";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ChatAttachment } from "@t3tools/contracts";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

const VIDEO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
};
const SAFE_VIDEO_FILE_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);
const SAFE_GENERIC_FILE_EXTENSIONS = new Set([
  ".bin",
  ".pdf",
  ...WORKSPACE_DOCUMENT_FILE_EXTENSIONS,
]);
const ATTACHMENT_FILENAME_EXTENSIONS = [
  ...SAFE_IMAGE_FILE_EXTENSIONS,
  ...SAFE_VIDEO_FILE_EXTENSIONS,
  ...SAFE_GENERIC_FILE_EXTENSIONS,
];
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);

export const PENDING_ATTACHMENT_THREAD_SEGMENT = "pending";
export const PENDING_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PARTIAL_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  return segment === PENDING_ATTACHMENT_THREAD_SEGMENT ? "_pending" : segment;
}

export function createPendingAttachmentId(): string {
  return `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${NodeCrypto.randomUUID()}`;
}

export function parseAttachmentUuid(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  return normalizedId.match(ATTACHMENT_ID_PATTERN)?.[2]?.toLowerCase() ?? null;
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${NodeCrypto.randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

function extensionFromFileName(fileName: string | undefined): string {
  const extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(fileName?.trim() ?? "");
  return extensionMatch ? `.${extensionMatch[1]!.toLowerCase()}` : "";
}

function inferVideoExtension(input: { mimeType: string; fileName?: string }): string {
  const key = input.mimeType.toLowerCase();
  const fromMime = Object.hasOwn(VIDEO_EXTENSION_BY_MIME_TYPE, key)
    ? VIDEO_EXTENSION_BY_MIME_TYPE[key]
    : undefined;
  if (fromMime) {
    return fromMime;
  }

  const fromMimeExtension = Mime.getExtension(input.mimeType);
  if (fromMimeExtension && SAFE_VIDEO_FILE_EXTENSIONS.has(fromMimeExtension)) {
    return fromMimeExtension;
  }

  const fileNameExtension = extensionFromFileName(input.fileName);
  if (SAFE_VIDEO_FILE_EXTENSIONS.has(fileNameExtension)) {
    return fileNameExtension;
  }

  return ".bin";
}

function inferGenericFileExtension(input: { mimeType: string; fileName?: string }): string {
  const fromMimeExtension = Mime.getExtension(input.mimeType);
  if (fromMimeExtension && SAFE_GENERIC_FILE_EXTENSIONS.has(fromMimeExtension)) {
    return fromMimeExtension;
  }

  const fileNameExtension = extensionFromFileName(input.fileName);
  if (SAFE_GENERIC_FILE_EXTENSIONS.has(fileNameExtension)) {
    return fileNameExtension;
  }

  return ".bin";
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "gif":
      return `${attachment.id}.gif`;
    case "video": {
      const extension = inferVideoExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "file": {
      const extension = inferGenericFileExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  for (const extension of ATTACHMENT_FILENAME_EXTENSIONS) {
    const maybePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${extension}`,
    });
    if (maybePath && NodeFS.existsSync(maybePath)) {
      return maybePath;
    }
  }
  return null;
}

export type AttachmentClaimPlan =
  | {
      readonly ok: true;
      readonly finalId: string;
      readonly currentPath: string;
      readonly finalPath: string;
    }
  | { readonly ok: false; readonly reason: string };

export function planAttachmentClaim(input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly attachmentId: string;
}): AttachmentClaimPlan {
  const uuid = parseAttachmentUuid(input.attachmentId);
  const requestedSegment = parseThreadSegmentFromAttachmentId(input.attachmentId);
  if (!uuid || !requestedSegment) {
    return { ok: false, reason: "invalid attachment id" };
  }

  if (!toSafeThreadAttachmentSegment(input.threadId)) {
    return { ok: false, reason: "invalid thread id" };
  }
  if (requestedSegment !== PENDING_ATTACHMENT_THREAD_SEGMENT) {
    return { ok: false, reason: "attachment must be a pending upload" };
  }

  const currentPath = resolveAttachmentPathById({
    attachmentsDir: input.attachmentsDir,
    attachmentId: input.attachmentId,
  });
  if (!currentPath) {
    return { ok: false, reason: "attachment not found (removed or expired)" };
  }
  const finalId = createAttachmentId(input.threadId);
  if (!finalId) {
    return { ok: false, reason: "failed to create attachment id" };
  }

  const expectedFinalPath = resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: `${finalId}${NodePath.extname(currentPath)}`,
  });
  if (!expectedFinalPath) {
    return { ok: false, reason: "failed to resolve attachment path" };
  }
  return {
    ok: true,
    finalId,
    currentPath,
    finalPath: expectedFinalPath,
  };
}

export function sweepStalePendingAttachments(input: {
  readonly attachmentsDir: string;
  readonly nowMs: number;
}): { readonly deleted: number } {
  let entries: string[];
  try {
    entries = NodeFS.readdirSync(input.attachmentsDir);
  } catch {
    return { deleted: 0 };
  }

  let deleted = 0;
  for (const entry of entries) {
    const isPartial = entry.endsWith(".part");
    if (!isPartial) {
      const attachmentId = parseAttachmentIdFromRelativePath(entry);
      if (
        !attachmentId ||
        parseThreadSegmentFromAttachmentId(attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT
      ) {
        continue;
      }
    }

    const resolved = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: entry,
    });
    if (!resolved) {
      continue;
    }
    try {
      const maxAgeMs = isPartial ? PARTIAL_UPLOAD_MAX_AGE_MS : PENDING_ATTACHMENT_MAX_AGE_MS;
      if (input.nowMs - NodeFS.statSync(resolved).mtimeMs > maxAgeMs) {
        NodeFS.unlinkSync(resolved);
        deleted += 1;
      }
    } catch {
      continue;
    }
  }

  return { deleted };
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized || normalized.includes("/")) {
    return null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}
