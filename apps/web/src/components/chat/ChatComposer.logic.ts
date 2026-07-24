import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_VIDEO_BYTES,
} from "@t3tools/contracts";

import type { ComposerAttachment } from "../../composerDraftStore";

export interface ComposerPromptEditorDisabledInput {
  readonly isComposerApprovalState: boolean;
  readonly isConnecting: boolean;
  readonly isEnvironmentUnavailable: boolean;
  readonly hasActivePendingProgress: boolean;
}

export function shouldDisableComposerPromptEditor({
  isComposerApprovalState,
}: ComposerPromptEditorDisabledInput): boolean {
  // Draft editing must stay available while reconnecting; send remains blocked elsewhere.
  return isComposerApprovalState;
}

const MIME_TYPE_BY_FILE_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  qt: "video/quicktime",
  tex: "application/x-tex",
  webm: "video/webm",
  webp: "image/webp",
};

function fileExtension(fileName: string): string {
  return /\.([a-z0-9]{1,16})$/iu.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
}

export function inferComposerFileMimeType(file: Pick<File, "name" | "type">): string {
  const declaredMimeType = file.type.trim().toLowerCase();
  if (declaredMimeType.length > 0 && declaredMimeType !== "application/octet-stream") {
    return declaredMimeType;
  }
  return MIME_TYPE_BY_FILE_EXTENSION[fileExtension(file.name)] ?? "application/octet-stream";
}

export interface ComposerAttachmentFactoryDependencies {
  readonly createId: () => string;
  readonly createPreviewUrl: (file: File) => string | undefined;
}

function sizeLimitLabel(maxBytes: number): string {
  return `${Math.round(maxBytes / (1024 * 1024))}MB`;
}

function unsupportedComposerAttachment(input: {
  readonly file: File;
  readonly mimeType: string;
  readonly reason: string;
  readonly dependencies: ComposerAttachmentFactoryDependencies;
  readonly previewUrl?: string;
}): ComposerAttachment {
  return {
    type: "file",
    id: input.dependencies.createId(),
    name: input.file.name || "attachment",
    mimeType: input.mimeType,
    sizeBytes: input.file.size,
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    file: input.file,
    status: "unsupported",
    unsupportedReason: input.reason,
  };
}

export function createComposerAttachment(
  file: File,
  dependencies: ComposerAttachmentFactoryDependencies,
): ComposerAttachment {
  const mimeType = inferComposerFileMimeType(file);
  const name = file.name || (mimeType.startsWith("video/") ? "video" : "attachment");
  if (file.size <= 0) {
    return unsupportedComposerAttachment({
      file,
      mimeType,
      reason: "Attachment is empty.",
      dependencies,
    });
  }

  if (mimeType.startsWith("image/")) {
    const previewUrl = dependencies.createPreviewUrl(file);
    if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return unsupportedComposerAttachment({
        file,
        mimeType,
        reason: `Image exceeds the ${sizeLimitLabel(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)} send limit.`,
        dependencies,
        ...(previewUrl ? { previewUrl } : {}),
      });
    }
    return {
      type: "image",
      id: dependencies.createId(),
      name: file.name || "image",
      mimeType,
      sizeBytes: file.size,
      previewUrl: previewUrl ?? "",
      file,
    };
  }

  if (mimeType.startsWith("video/")) {
    const previewUrl = dependencies.createPreviewUrl(file);
    if (file.size > PROVIDER_SEND_TURN_MAX_VIDEO_BYTES) {
      return unsupportedComposerAttachment({
        file,
        mimeType,
        reason: `Video exceeds the ${sizeLimitLabel(PROVIDER_SEND_TURN_MAX_VIDEO_BYTES)} send limit.`,
        dependencies,
        ...(previewUrl ? { previewUrl } : {}),
      });
    }
    return {
      type: "video",
      id: dependencies.createId(),
      name,
      mimeType,
      sizeBytes: file.size,
      previewUrl: previewUrl ?? "",
      file,
    };
  }

  if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    return unsupportedComposerAttachment({
      file,
      mimeType,
      reason: `File exceeds the ${sizeLimitLabel(PROVIDER_SEND_TURN_MAX_FILE_BYTES)} send limit.`,
      dependencies,
    });
  }

  return {
    type: "file",
    id: dependencies.createId(),
    name,
    mimeType,
    sizeBytes: file.size,
    file,
  };
}
