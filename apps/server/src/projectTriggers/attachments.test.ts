import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ChatAttachmentId, ProjectTriggerId, type ChatAttachment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import { attachmentRelativePath, createPendingAttachmentId } from "../attachmentStore.ts";
import { captureTriggerAttachments } from "./attachments.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "kami-trigger-attachments-",
}).pipe(Layer.provideMerge(NodeServices.layer));
it.effect("keeps scheduled uploads after draft release and preserves inline media metadata", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    const pending: ChatAttachment = {
      type: "video",
      id: ChatAttachmentId.make(createPendingAttachmentId()!),
      name: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4,
      durationMs: 1200,
    };
    const pendingPath = path.join(config.attachmentsDir, attachmentRelativePath(pending)!);
    yield* fs.writeFileString(pendingPath, "test");
    const captured = yield* captureTriggerAttachments({
      triggerId: ProjectTriggerId.make("scheduled"),
      revision: "first",
      attachments: [
        pending,
        {
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          dataUrl: "data:text/plain;base64,dGVzdA==",
        },
      ],
    });
    yield* fs.remove(pendingPath);
    expect(captured.attachments[0]).toMatchObject({ type: "video", durationMs: 1200 });
    expect(captured.attachments[0]?.id).not.toBe(pending.id);
    expect(captured.createdPaths).toHaveLength(2);
    for (const attachment of captured.attachments) {
      expect(
        yield* fs.readFileString(
          path.join(config.attachmentsDir, attachmentRelativePath(attachment)!),
        ),
      ).toBe("test");
    }
  }).pipe(Effect.provide(testLayer)),
);
it.effect("rolls back earlier inline files if another payload is invalid", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    const result = yield* Effect.exit(
      captureTriggerAttachments({
        triggerId: ProjectTriggerId.make("invalid"),
        revision: "first",
        attachments: [
          {
            type: "file",
            name: "valid.txt",
            mimeType: "text/plain",
            sizeBytes: 4,
            dataUrl: "data:text/plain;base64,dGVzdA==",
          },
          {
            type: "file",
            name: "invalid.txt",
            mimeType: "text/plain",
            sizeBytes: 100,
            dataUrl: "data:text/plain;base64,dGVzdA==",
          },
        ],
      }),
    );
    expect(result._tag).toBe("Failure");
    expect(yield* fs.readDirectory(config.attachmentsDir)).toEqual([]);
  }).pipe(Effect.provide(testLayer)),
);
