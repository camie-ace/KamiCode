import {
  MessageId,
  ThreadId,
  type ProjectTriggerId,
  type ProjectTriggerThreadTemplate,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { persistChatAttachments } from "../assets/PersistChatAttachments.ts";
import { attachmentRelativePath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  claimPendingAttachments,
  releaseClaimedAttachments,
} from "../orchestration-v2/AttachmentClaims.ts";

/** Scheduled payloads must survive the originating composer releasing its uploads. */
export const captureTriggerAttachments = Effect.fn("ProjectTriggers.captureAttachments")(
  function* (input: {
    triggerId: ProjectTriggerId;
    revision: string;
    attachments: NonNullable<ProjectTriggerThreadTemplate["attachments"]>;
  }) {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const threadId = ThreadId.make(`project-trigger:${input.triggerId}:${input.revision}`);
    const createdPaths: string[] = [];
    return yield* Effect.gen(function* () {
      const normalized = yield* Effect.forEach(
        input.attachments,
        (attachment, index) =>
          Effect.gen(function* () {
            if (!("dataUrl" in attachment)) return attachment;
            const persisted = yield* persistChatAttachments({
              threadId,
              messageId: MessageId.make(`${input.triggerId}:${input.revision}:${index}`),
              attachments: [attachment],
            });
            const stored = persisted[0]!;
            createdPaths.push(path.join(config.attachmentsDir, attachmentRelativePath(stored)!));
            return stored;
          }),
        { concurrency: 1 },
      );
      const claimed = yield* claimPendingAttachments({ threadId, attachments: normalized });
      createdPaths.push(...claimed.claimedPaths);
      return { attachments: claimed.attachments, createdPaths };
    }).pipe(Effect.tapError(() => releaseClaimedAttachments(createdPaths)));
  },
);
