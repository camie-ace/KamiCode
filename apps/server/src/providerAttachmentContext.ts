import type { ChatAttachment } from "@t3tools/contracts";

import { resolveAttachmentPath } from "./attachmentStore.ts";

export function appendProviderAttachmentContext(input: {
  readonly messageText: string | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly attachmentsDir: string;
}): string | undefined {
  const references = input.attachments.flatMap((attachment) => {
    if (attachment.type === "image" || attachment.type === "gif") {
      return [];
    }
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return [];
    }
    return [
      JSON.stringify({
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        path: attachmentPath,
      }),
    ];
  });

  const normalizedMessage = input.messageText?.trim();
  if (references.length === 0) {
    return normalizedMessage && normalizedMessage.length > 0 ? normalizedMessage : undefined;
  }

  const attachmentContext = [
    "<attached_files>",
    "The user attached the following files. Read them from their exact local paths before responding when their contents are relevant.",
    ...references.map((reference) => `- ${reference}`),
    "</attached_files>",
  ].join("\n");

  return normalizedMessage && normalizedMessage.length > 0
    ? `${normalizedMessage}\n\n${attachmentContext}`
    : attachmentContext;
}
