import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type ChatAttachment,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  type UploadChatAttachment,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_VIDEO_BYTES,
} from "@t3tools/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

function uploadAttachmentMaxBytes(type: UploadChatAttachment["type"]): number {
  switch (type) {
    case "image":
    case "gif":
      return PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
    case "video":
      return PROVIDER_SEND_TURN_MAX_VIDEO_BYTES;
    case "file":
      return PROVIDER_SEND_TURN_MAX_FILE_BYTES;
  }
}

function isUploadMimeCompatible(input: {
  readonly type: UploadChatAttachment["type"];
  readonly mimeType: string;
}): boolean {
  switch (input.type) {
    case "image":
      return input.mimeType.startsWith("image/");
    case "gif":
      return input.mimeType === "image/gif";
    case "video":
      return input.mimeType.startsWith("video/");
    case "file":
      return true;
  }
}

function toPersistedAttachment(input: {
  readonly attachment: UploadChatAttachment;
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}): ChatAttachment {
  const base = {
    id: input.id,
    name: input.attachment.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  };

  switch (input.attachment.type) {
    case "image":
      return {
        ...base,
        type: "image",
        ...(input.attachment.width !== undefined ? { width: input.attachment.width } : {}),
        ...(input.attachment.height !== undefined ? { height: input.attachment.height } : {}),
      };
    case "gif":
      return {
        ...base,
        type: "gif",
        ...(input.attachment.width !== undefined ? { width: input.attachment.width } : {}),
        ...(input.attachment.height !== undefined ? { height: input.attachment.height } : {}),
      };
    case "video":
      return {
        ...base,
        type: "video",
        ...(input.attachment.width !== undefined ? { width: input.attachment.width } : {}),
        ...(input.attachment.height !== undefined ? { height: input.attachment.height } : {}),
        ...(input.attachment.durationMs !== undefined
          ? { durationMs: input.attachment.durationMs }
          : {}),
      };
    case "file":
      return {
        ...base,
        type: "file",
      };
  }
}

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          command.workspaceRoot,
          command.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (command.type !== "thread.turn.start") {
      return command as OrchestrationCommand;
    }

    const normalizedAttachments = yield* Effect.forEach(
      command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          const parsedMimeType = parsed?.mimeType.toLowerCase();
          if (
            !parsed ||
            !parsedMimeType ||
            !isUploadMimeCompatible({ type: attachment.type, mimeType: parsedMimeType })
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid ${attachment.type} attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (
            bytes.byteLength === 0 ||
            bytes.byteLength > uploadAttachmentMaxBytes(attachment.type)
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: `${attachment.type} attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(command.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = toPersistedAttachment({
            attachment,
            id: attachmentId,
            mimeType: parsedMimeType,
            sizeBytes: bytes.byteLength,
          });

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...command,
      message: {
        ...command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });
