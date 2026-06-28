import { CircleAlertIcon, FileIcon, VideoIcon, XIcon } from "lucide-react";
import type { ComposerAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";

function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function attachmentKindLabel(attachment: ComposerAttachment): string {
  if (attachment.status === "unsupported") {
    return "Unsupported";
  }
  if (attachment.type === "image") {
    return attachment.mimeType.toLowerCase() === "image/gif" ? "GIF context" : "Image context";
  }
  if (attachment.type === "video") {
    return "Video context";
  }
  return "File context";
}

function attachmentDetailLabel(attachment: ComposerAttachment): string {
  if (attachment.status === "unsupported") {
    return attachment.unsupportedReason;
  }
  return `${attachment.mimeType || "unknown type"} - ${formatAttachmentSize(attachment.sizeBytes)}`;
}

export function ComposerAttachmentStrip(props: {
  attachments: ReadonlyArray<ComposerAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
  nonPersistedAttachmentIds: ReadonlySet<string>;
  className?: string;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemove: (attachmentId: string) => void;
}) {
  if (props.attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", props.className)}>
      {props.attachments.map((attachment) => {
        const isUnsupported = attachment.status === "unsupported";
        const showPersistenceWarning = props.nonPersistedAttachmentIds.has(attachment.id);
        return (
          <div
            key={attachment.id}
            className={cn(
              "group relative flex min-h-16 w-full max-w-[260px] overflow-hidden rounded-xl border bg-background/90 text-left shadow-sm sm:w-[220px]",
              isUnsupported ? "border-amber-500/45" : "border-border/80",
            )}
          >
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden border-r border-border/70 bg-muted/60">
              {attachment.type === "image" && attachment.previewUrl ? (
                <button
                  type="button"
                  className="h-full w-full cursor-zoom-in"
                  aria-label={`Preview ${attachment.name}`}
                  onClick={() => {
                    const preview = buildExpandedImagePreview(props.images, attachment.id);
                    if (preview) props.onExpandImage(preview);
                  }}
                >
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : attachment.type === "video" && attachment.previewUrl ? (
                <video
                  src={attachment.previewUrl}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={`Preview ${attachment.name}`}
                />
              ) : attachment.previewUrl && attachment.mimeType.startsWith("image/") ? (
                <img
                  src={attachment.previewUrl}
                  alt=""
                  className="h-full w-full object-cover opacity-75 grayscale"
                />
              ) : attachment.type === "video" ? (
                <VideoIcon className="size-5 text-muted-foreground/70" />
              ) : (
                <FileIcon className="size-5 text-muted-foreground/70" />
              )}
            </div>

            <div className="grid min-w-0 flex-1 content-center gap-0.5 px-2.5 py-2 pr-8">
              <div className="truncate text-xs font-medium text-foreground/90">
                {attachment.name || "Untitled attachment"}
              </div>
              <div
                className={cn(
                  "text-[11px] font-medium",
                  isUnsupported ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {attachmentKindLabel(attachment)}
              </div>
              <div className="truncate text-[11px] text-muted-foreground/75">
                {attachmentDetailLabel(attachment)}
              </div>
            </div>

            {showPersistenceWarning ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="img"
                      aria-label="Draft attachment may not persist"
                      className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                    >
                      <CircleAlertIcon className="size-3" />
                    </span>
                  }
                />
                <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
                  Draft attachment is kept in memory only and may be lost on navigation.
                </TooltipPopup>
              </Tooltip>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
              onClick={() => props.onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
