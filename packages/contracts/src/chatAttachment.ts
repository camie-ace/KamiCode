import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 100;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_TOTAL_IMAGE_BYTES = 80 * 1024 * 1024;
export const PROVIDER_SEND_TURN_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET = new Set<string>(
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
);

/** Whether a pasted or picked image mime type can be sent on a provider turn. */
export function isProviderSendTurnSupportedImageMimeType(mimeType: string): boolean {
  return PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET.has(mimeType.toLowerCase());
}
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;

export const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const PROVIDER_SEND_TURN_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_VIDEO_DATA_URL_CHARS = 35_000_000;
const PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS = 14_000_000;
const MEDIA_TITLE_MAX_CHARS = 255;
const MEDIA_MIME_TYPE_MAX_CHARS = 100;
const MEDIA_EXTENSION_MAX_CHARS = 16;

const MediaMimeType = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MEDIA_MIME_TYPE_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[^;]+)*$/i),
);

const MediaDimension = NonNegativeInt.check(Schema.isLessThanOrEqualTo(100_000));
const MediaDurationMs = NonNegativeInt.check(Schema.isLessThanOrEqualTo(24 * 60 * 60 * 1000));
const MediaTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(MEDIA_TITLE_MAX_CHARS));
const MediaExtension = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MEDIA_EXTENSION_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9]+$/i),
);

const ChatAttachmentSharedFields = {
  id: ChatAttachmentId,
  name: MediaTitle,
  mimeType: MediaMimeType,
} as const;

const UploadMediaMetadataFields = {
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
} as const;

export const SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS = 32_000;
export const SNAP_SHOT_ACCESSIBILITY_MAX_NODES = 10_000;
export const SNAP_SHOT_ACCESSIBILITY_MAX_SERIALIZED_CHARS = 32_000;

const SnapShotAccessibilityBounds = Schema.Struct({
  x: NonNegativeInt,
  y: NonNegativeInt,
  width: PositiveInt,
  height: PositiveInt,
});

const SnapShotAccessibilityState = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  busy: Schema.optional(Schema.Boolean),
  checked: Schema.optional(Schema.Literals(["on", "off", "mixed"])),
  editable: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  expanded: Schema.optional(Schema.Boolean),
  focused: Schema.optional(Schema.Boolean),
  selected: Schema.optional(Schema.Boolean),
  visible: Schema.optional(Schema.Boolean),
});

export interface SnapShotAccessibilityNode {
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly description?: string;
  readonly bounds: typeof SnapShotAccessibilityBounds.Type | null;
  readonly state?: typeof SnapShotAccessibilityState.Type;
  readonly actions?: Array<string>;
  readonly children: Array<SnapShotAccessibilityNode>;
}

export const SnapShotAccessibilityNode: Schema.Codec<SnapShotAccessibilityNode> = Schema.Struct({
  role: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(1_000))),
  value: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(8_000))),
  description: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
  bounds: Schema.NullOr(SnapShotAccessibilityBounds),
  state: Schema.optionalKey(SnapShotAccessibilityState),
  actions: Schema.optionalKey(
    Schema.mutable(Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(100)))).check(
      Schema.isMaxLength(32),
    ),
  ),
  children: Schema.mutable(
    Schema.Array(
      Schema.suspend((): Schema.Codec<SnapShotAccessibilityNode> => SnapShotAccessibilityNode),
    ),
  ).check(Schema.isMaxLength(SNAP_SHOT_ACCESSIBILITY_MAX_NODES)),
});

const SnapShotAccessibilityWire = Schema.Union([
  Schema.Struct({
    format: Schema.Literal("flat-text"),
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS)),
    truncated: Schema.Boolean,
  }),
  Schema.Struct({
    format: Schema.Literal("element-tree"),
    coordinateSpace: Schema.Literal("captured-image"),
    imageSize: Schema.Struct({ width: PositiveInt, height: PositiveInt }),
    truncated: Schema.Boolean,
    root: SnapShotAccessibilityNode,
  }),
]);

export const SnapShotAccessibility = SnapShotAccessibilityWire.check(
  Schema.makeFilter((accessibility: typeof SnapShotAccessibilityWire.Type) => {
    if (accessibility.format === "flat-text") return undefined;
    let nodes = 0;
    const stack = [accessibility.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      nodes += 1;
      if (nodes > SNAP_SHOT_ACCESSIBILITY_MAX_NODES) {
        return `Accessibility trees must not exceed ${SNAP_SHOT_ACCESSIBILITY_MAX_NODES} nodes.`;
      }
      stack.push(...node.children);
    }
    return (
      JSON.stringify(accessibility).length <= SNAP_SHOT_ACCESSIBILITY_MAX_SERIALIZED_CHARS ||
      `Accessibility trees must not exceed ${SNAP_SHOT_ACCESSIBILITY_MAX_SERIALIZED_CHARS} serialized characters.`
    );
  }),
);
export type SnapShotAccessibility = typeof SnapShotAccessibility.Type;

export const SnapShotSource = Schema.Struct({
  kind: Schema.Literal("snap-shot"),
  capturedAt: IsoDateTime,
  appName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  windowTitle: TrimmedString.check(Schema.isMaxLength(1_000)),
  accessibleText: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(SNAP_SHOT_ACCESSIBLE_TEXT_MAX_CHARS)),
  ),
  accessibility: Schema.optional(SnapShotAccessibility),
  appIdentifier: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  appIconDataUrl: Schema.optional(
    TrimmedNonEmptyString.check(
      Schema.isMaxLength(100_000),
      Schema.isPattern(/^data:image\/png;base64,/i),
    ),
  ),
});
export type SnapShotSource = typeof SnapShotSource.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  source: Schema.optional(SnapShotSource),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

export const PastedTextAttachmentSource = Schema.TaggedStruct("pasted-text", {});
export type PastedTextAttachmentSource = typeof PastedTextAttachmentSource.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  ...ChatAttachmentSharedFields,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
  source: Schema.optional(PastedTextAttachmentSource),
});
export type ChatFileAttachment = typeof ChatFileAttachment.Type;

/**
 * Catch-all for attachment types this build does not know. Attachments ride on
 * persisted events and thread streams, so a newer server or client must be able
 * to introduce a type without making older readers fail to decode the whole
 * message. Decoders keep the shared base fields; consumers skip these or render
 * them as unsupported. Mirrors how `OrchestrationThreadActivity` keeps `kind`
 * open. The known discriminators are excluded so a malformed image or file
 * attachment fails its own schema instead of sliding through here with its
 * size and mime constraints unchecked.
 */
export const ChatUnknownAttachment = Schema.Struct({
  type: TrimmedNonEmptyString.check(
    Schema.isMaxLength(50),
    Schema.isPattern(/^(?!(?:image|gif|video|file)$)/),
  ),
  ...ChatAttachmentSharedFields,
  sizeBytes: NonNegativeInt,
});
export type ChatUnknownAttachment = typeof ChatUnknownAttachment.Type;

export const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  /** Client-side id, so context records can bind before upload. */
  id: Schema.optional(ChatAttachmentId),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
  source: Schema.optional(SnapShotSource),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatGifAttachment = Schema.Struct({
  type: Schema.Literal("gif"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\/gif$/i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
});
export type ChatGifAttachment = typeof ChatGifAttachment.Type;

export const ChatVideoAttachment = Schema.Struct({
  type: Schema.Literal("video"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^video\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_VIDEO_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
});
export type ChatVideoAttachment = typeof ChatVideoAttachment.Type;

export const UploadChatGifAttachment = Schema.Struct({
  type: Schema.Literal("gif"),
  id: Schema.optional(ChatAttachmentId),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\/gif$/i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
});
export type UploadChatGifAttachment = typeof UploadChatGifAttachment.Type;

export const UploadChatVideoAttachment = Schema.Struct({
  type: Schema.Literal("video"),
  id: Schema.optional(ChatAttachmentId),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^video\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_VIDEO_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_VIDEO_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
});
export type UploadChatVideoAttachment = typeof UploadChatVideoAttachment.Type;

export const UploadChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  id: Schema.optional(ChatAttachmentId),
  name: MediaTitle,
  mimeType: MediaMimeType,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS),
  ),
});
export type UploadChatFileAttachment = typeof UploadChatFileAttachment.Type;

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatGifAttachment,
  ChatVideoAttachment,
  ChatFileAttachment,
  ChatUnknownAttachment,
]);
export type ChatAttachment = typeof ChatAttachment.Type;

export function getProviderAttachmentLimitError(
  attachments: ReadonlyArray<Pick<ChatAttachment, "type" | "mimeType" | "sizeBytes">>,
): string | undefined {
  if (attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    return `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message or question response.`;
  }
  const imageBytes = attachments.reduce(
    (total, attachment) =>
      total +
      (attachment.type === "image" || isProviderSendTurnSupportedImageMimeType(attachment.mimeType)
        ? attachment.sizeBytes
        : 0),
    0,
  );
  if (imageBytes > PROVIDER_SEND_TURN_MAX_TOTAL_IMAGE_BYTES) {
    return "Images can total up to 80 MiB per message or question response. Use smaller images or send fewer at once.";
  }
}

export const UploadChatAttachment = Schema.Union([
  UploadChatImageAttachment,
  UploadChatGifAttachment,
  UploadChatVideoAttachment,
  UploadChatFileAttachment,
]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const MediaArtifactKind = Schema.Literals(["image", "gif", "video", "file", "unknown"]);
export type MediaArtifactKind = typeof MediaArtifactKind.Type;
export const MediaArtifactSource = Schema.Literals(["generated", "local", "project", "web"]);
export type MediaArtifactSource = typeof MediaArtifactSource.Type;
export const MediaArtifactOrigin = Schema.Literals(["attached", "found", "generated"]);
export type MediaArtifactOrigin = typeof MediaArtifactOrigin.Type;

export const MediaArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: MediaArtifactKind,
  source: MediaArtifactSource,
  title: MediaTitle,
  extension: MediaExtension,
  path: Schema.optional(TrimmedNonEmptyString),
  url: Schema.optional(TrimmedNonEmptyString),
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  mimeType: Schema.optional(MediaMimeType),
  sizeBytes: Schema.optional(NonNegativeInt),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
  modifiedAt: Schema.optional(IsoDateTime),
  createdAt: Schema.optional(IsoDateTime),
  messageId: Schema.optional(MessageId),
  origin: Schema.optional(MediaArtifactOrigin),
});
export type MediaArtifact = typeof MediaArtifact.Type;

export const PersistChatAttachmentsInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  attachments: Schema.Array(UploadChatAttachment),
});
export type PersistChatAttachmentsInput = typeof PersistChatAttachmentsInput.Type;

export const PersistChatAttachmentsResult = Schema.Struct({
  attachments: Schema.Array(ChatAttachment),
});
export type PersistChatAttachmentsResult = typeof PersistChatAttachmentsResult.Type;

export class PersistChatAttachmentsError extends Schema.TaggedError<PersistChatAttachmentsError>()(
  "PersistChatAttachmentsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
