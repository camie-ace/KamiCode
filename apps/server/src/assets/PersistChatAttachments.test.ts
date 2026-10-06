import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId, MessageId, type UploadChatAttachment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import { attachmentRelativePath } from "../attachmentStore.ts";
import { persistChatAttachments } from "./PersistChatAttachments.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "kamicode-attachment-persistence-",
}).pipe(Layer.provideMerge(NodeServices.layer));
const attachments: ReadonlyArray<UploadChatAttachment> = [
  {
    type: "image",
    name: "image.png",
    mimeType: "image/png",
    sizeBytes: 4,
    dataUrl: "data:image/png;base64,dGVzdA==",
  },
  {
    type: "gif",
    name: "motion.gif",
    mimeType: "image/gif",
    sizeBytes: 4,
    dataUrl: "data:image/gif;base64,dGVzdA==",
    width: 100,
  },
  {
    type: "video",
    name: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 4,
    dataUrl: "data:video/mp4;base64,dGVzdA==",
    durationMs: 1000,
  },
  {
    type: "file",
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 4,
    dataUrl: "data:text/plain;base64,dGVzdA==",
  },
];
it.effect("persists all KamiCode attachment types with distinct files and their metadata", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    const result = yield* persistChatAttachments({
      threadId: ThreadId.make("media-thread"),
      messageId: MessageId.make("media-message"),
      attachments,
    });
    expect(new Set(result.map((attachment) => attachment.id)).size).toBe(4);
    for (const [index, attachment] of result.entries()) {
      const { dataUrl: _dataUrl, ...metadata } = attachments[index]!;
      expect(attachment).toMatchObject(metadata);
      expect(attachment).not.toHaveProperty("dataUrl");
      expect(
        yield* fs.readFileString(
          path.join(config.attachmentsDir, attachmentRelativePath(attachment)!),
        ),
      ).toBe("test");
    }
  }).pipe(Effect.provide(testLayer)),
);
it.effect("rejects mismatched payload size and MIME type", () =>
  Effect.gen(function* () {
    for (const attachment of [
      { ...attachments[0]!, sizeBytes: 10 },
      { ...attachments[0]!, mimeType: "image/jpeg" },
    ]) {
      const result = yield* Effect.exit(
        persistChatAttachments({
          threadId: ThreadId.make("invalid-media"),
          messageId: MessageId.make("invalid-message"),
          attachments: [attachment],
        }),
      );
      expect(result._tag).toBe("Failure");
    }
  }).pipe(Effect.provide(testLayer)),
);
