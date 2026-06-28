import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CopyIcon,
  EyeIcon,
  ExternalLinkIcon,
  FileImageIcon,
  FilmIcon,
  FolderOpenIcon,
  ImageIcon,
  Maximize2Icon,
  PlusIcon,
  ZoomInIcon,
  ZoomOutIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useOptionalAssetUrl } from "~/assets/assetUrls";
import { useComposerDraftStore, type ComposerAttachment, type DraftId } from "~/composerDraftStore";
import { cn, randomUUID } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import type { MediaArtifact } from "~/mediaArtifacts";
import {
  isImageMediaArtifactKind,
  isPreviewableMediaArtifactKind,
  mediaArtifactCanReveal,
  mediaArtifactExternalTarget,
  mediaArtifactReference,
} from "~/mediaArtifacts";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { revealInFileExplorerLabel } from "../preview/fileExplorerLabel";

interface MediaArtifactCardProps {
  artifact: MediaArtifact;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  composerTarget?: ScopedThreadRef | DraftId | undefined;
  compact?: boolean;
  active?: boolean;
  recent?: boolean;
  onInteract?: (artifact: MediaArtifact) => void;
}

export const MediaArtifactCard = memo(function MediaArtifactCard({
  artifact,
  environmentId,
  threadRef,
  composerTarget,
  compact = false,
  active = false,
  recent = false,
  onInteract,
}: MediaArtifactCardProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const directPreviewUrl = artifact.previewUrl ?? artifact.url ?? null;
  const resolvedAssetUrl = useOptionalAssetUrl(
    environmentId,
    directPreviewUrl || !threadRef || !artifact.path
      ? null
      : {
          _tag: "workspace-file",
          threadId: threadRef.threadId,
          path: artifact.path,
        },
  );
  useEffect(() => {
    setPreviewFailed(false);
  }, [artifact.id, directPreviewUrl, resolvedAssetUrl]);
  const previewUrl = directPreviewUrl ?? resolvedAssetUrl;
  const addAttachments = useComposerDraftStore((store) => store.addAttachments);
  const displayPath = mediaArtifactReference(artifact);
  const isPreviewableKind = isPreviewableMediaArtifactKind(artifact.kind);
  const canPreview = Boolean(previewUrl) && isPreviewableKind && !previewFailed;
  const isImageLike = isImageMediaArtifactKind(artifact.kind);
  const isVideo = artifact.kind === "video";
  const canUseInChat = Boolean(
    composerTarget && previewUrl && (isImageLike || isVideo) && !previewFailed,
  );
  const revealLabel = revealInFileExplorerLabel(getNavigatorPlatform());
  const desktopBridgeAvailable = hasDesktopBridge();
  const canReveal = mediaArtifactCanReveal(artifact, hasDesktopLocalMediaRevealBridge());
  const externalTarget = mediaArtifactExternalTarget(artifact, previewUrl, {
    desktopBridgeAvailable,
  });
  const canOpenExternal = Boolean(externalTarget);
  const canCopyImage = Boolean(canPreview && isImageLike && canWriteImageToClipboard());
  const metadataRows = useMemo(
    () => buildMetadataRows(artifact, displayPath, undefined, 6),
    [artifact, displayPath],
  );
  const compactMetadata = useMemo(() => buildCompactMetadata(artifact), [artifact]);
  const previewUnavailableMessage = previewFailed
    ? "Preview failed to load."
    : isPreviewableKind
      ? "Preview unavailable."
      : "Unsupported preview format.";
  const previewRecoveryMessage = buildPreviewRecoveryMessage({
    canOpenExternal,
    canReveal,
    revealLabel,
  });

  useEffect(() => {
    setPathCopied(false);
    setImageCopied(false);
  }, [artifact.id]);

  const copyPath = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Clipboard unavailable",
          description: displayPath,
        }),
      );
      return;
    }
    void navigator.clipboard.writeText(displayPath).then(
      () => {
        setPathCopied(true);
        resetBooleanStateSoon(setPathCopied);
      },
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not copy media path",
            description: error instanceof Error ? error.message : "Clipboard write failed.",
          }),
        );
      },
    );
    onInteract?.(artifact);
  }, [artifact, displayPath, onInteract]);

  const copyImage = useCallback(() => {
    if (!previewUrl || !canCopyImage) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Image clipboard unavailable",
          description: "This browser cannot copy image data from this preview.",
        }),
      );
      return;
    }

    void writeImageToClipboard(previewUrl, artifact).then(
      () => {
        setImageCopied(true);
        resetBooleanStateSoon(setImageCopied);
      },
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not copy image",
            description: error instanceof Error ? error.message : "Clipboard image write failed.",
          }),
        );
      },
    );
    onInteract?.(artifact);
  }, [artifact, canCopyImage, onInteract, previewUrl]);

  const openExternally = useCallback(() => {
    if (!externalTarget) return;
    const desktopBridge = getDesktopBridge();
    const localApi = readLocalApi();
    const open = externalTarget.startsWith("file:")
      ? desktopBridge
        ? desktopBridge.openExternal(externalTarget).then((opened) => {
            if (!opened) throw new Error("Unable to open media externally.");
          })
        : Promise.reject(new Error("Desktop bridge unavailable."))
      : localApi
        ? localApi.shell.openExternal(externalTarget)
        : Promise.reject(new Error("External open API unavailable."));

    void open.catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not open media",
          description: error instanceof Error ? error.message : "Open externally failed.",
        }),
      );
    });
    onInteract?.(artifact);
  }, [artifact, externalTarget, onInteract]);

  const revealMedia = useCallback(() => {
    if (!artifact.path || !canReveal) return;
    const localApi = readLocalApi();
    if (!localApi) return;
    void localApi.shell.revealLocalMediaFile({ path: artifact.path }).then(
      (revealed) => {
        if (revealed) return;
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Could not reveal media",
            description:
              "Only absolute local media paths with supported media extensions can be revealed.",
          }),
        );
      },
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not reveal media",
            description: error instanceof Error ? error.message : "Reveal failed.",
          }),
        );
      },
    );
    onInteract?.(artifact);
  }, [artifact, canReveal, onInteract]);

  const useInChat = useCallback(() => {
    if (!composerTarget || !previewUrl || (!isImageLike && !isVideo) || previewFailed) return;
    void fetch(previewUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load ${artifact.title}.`);
        const blob = await response.blob();
        const mimeType =
          blob.type ||
          artifact.mimeType ||
          mediaMimeTypeForExtension(artifact.kind, artifact.extension);
        const file = new File([blob], artifact.title, {
          type: mimeType,
        });
        const attachment: ComposerAttachment = {
          type: isVideo ? "video" : "image",
          id: randomUUID(),
          name: artifact.title,
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl: URL.createObjectURL(file),
          file,
        };
        addAttachments(composerTarget, [attachment]);
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not attach media",
            description: error instanceof Error ? error.message : "The media could not be loaded.",
          }),
        );
      });
    onInteract?.(artifact);
  }, [
    addAttachments,
    artifact,
    artifact.extension,
    artifact.kind,
    artifact.title,
    composerTarget,
    isImageLike,
    isVideo,
    onInteract,
    previewFailed,
    previewUrl,
  ]);

  const openViewer = useCallback(() => {
    if (!canPreview) return;
    onInteract?.(artifact);
    setViewerOpen(true);
  }, [artifact, canPreview, onInteract]);

  const viewer =
    viewerOpen && previewUrl ? (
      <MediaArtifactViewer
        artifact={artifact}
        url={previewUrl}
        canUseInChat={canUseInChat}
        canCopyImage={canCopyImage}
        canOpenExternal={canOpenExternal}
        canReveal={canReveal}
        imageCopied={imageCopied}
        pathCopied={pathCopied}
        revealLabel={revealLabel}
        onCopyImage={copyImage}
        onCopyPath={copyPath}
        onOpenExternal={openExternally}
        onReveal={revealMedia}
        onUseInChat={useInChat}
        onClose={() => setViewerOpen(false)}
      />
    ) : null;

  if (compact) {
    return (
      <>
        <article
          className={cn(
            "group/media relative min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background/62 shadow-sm transition-all",
            "hover:-translate-y-0.5 hover:border-border hover:bg-background/82 hover:shadow-md",
            "supports-[backdrop-filter]:bg-background/54 supports-[backdrop-filter]:backdrop-blur",
            active && "border-primary/55 bg-primary/8 shadow-primary/10 ring-1 ring-primary/35",
          )}
          data-media-artifact-card
          data-media-artifact-active={active ? "true" : undefined}
        >
          <button
            type="button"
            className={cn(
              "relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-muted/35 text-muted-foreground transition-colors",
              "after:pointer-events-none after:absolute after:inset-0 after:bg-gradient-to-t after:from-black/28 after:via-transparent after:to-transparent",
              canPreview && "cursor-zoom-in hover:bg-muted/50",
              !canPreview && "cursor-default",
            )}
            onClick={openViewer}
            disabled={!canPreview}
            aria-label={`Preview ${artifact.title}`}
          >
            {canPreview && isImageLike ? (
              <img
                src={previewUrl ?? undefined}
                alt={artifact.title}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setPreviewFailed(true)}
              />
            ) : canPreview && isVideo ? (
              <video
                src={previewUrl ?? undefined}
                className="h-full w-full bg-black object-cover"
                muted
                preload="metadata"
                onError={() => setPreviewFailed(true)}
              />
            ) : artifact.kind === "video" ? (
              <PreviewUnavailableState icon="video" compact label="Preview unavailable" />
            ) : artifact.kind === "gif" ? (
              <PreviewUnavailableState icon="gif" compact label="Preview unavailable" />
            ) : (
              <PreviewUnavailableState icon="image" compact label="Preview unavailable" />
            )}
            <div className="absolute left-2 top-2 z-10 flex min-w-0 items-center gap-1">
              {recent ? <MediaBadge tone="accent">Recent</MediaBadge> : null}
              {active ? <MediaBadge tone="accent">Active</MediaBadge> : null}
            </div>
            {canPreview ? (
              <span className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-full border border-white/14 bg-black/45 p-1 text-white opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/media:opacity-100">
                <Maximize2Icon className="size-3.5" aria-hidden />
              </span>
            ) : null}
          </button>
          <div className="grid gap-2 p-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                {artifact.title}
              </p>
              <p
                className="mt-0.5 truncate text-[11px] text-muted-foreground/72"
                title={compactMetadata}
              >
                {compactMetadata}
              </p>
            </div>
            {!canPreview ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/8 px-2 py-1.5 text-[11px] text-muted-foreground/85">
                <AlertTriangleIcon className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
                <p>
                  {previewUnavailableMessage} {previewRecoveryMessage}
                </p>
              </div>
            ) : null}
            <div
              className="grid grid-cols-2 gap-1.5"
              role="group"
              aria-label={`Actions for ${artifact.title}`}
            >
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!canPreview}
                onClick={openViewer}
                className="bg-background/76"
              >
                <EyeIcon />
                {isVideo ? "Play" : "Preview"}
              </Button>
              {isImageLike || isVideo ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        disabled={!canUseInChat}
                        onClick={useInChat}
                      />
                    }
                  >
                    <PlusIcon />
                    Use
                  </TooltipTrigger>
                  <TooltipPopup>Attach this media to the composer</TooltipPopup>
                </Tooltip>
              ) : canOpenExternal ? (
                <Button type="button" size="xs" variant="secondary" onClick={openExternally}>
                  <ExternalLinkIcon />
                  Open
                </Button>
              ) : (
                <Button type="button" size="xs" variant="secondary" onClick={copyPath}>
                  <CopyIcon />
                  Copy
                </Button>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              {isImageLike ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={!canCopyImage}
                  onClick={copyImage}
                  title={
                    canCopyImage
                      ? "Copy the preview image to the clipboard"
                      : "Image clipboard support is unavailable"
                  }
                  aria-label={imageCopied ? "Copied image" : "Copy image"}
                >
                  <CopyIcon />
                </Button>
              ) : null}
              {canOpenExternal ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={openExternally}
                  title="Open media externally"
                  aria-label="Open media externally"
                >
                  <ExternalLinkIcon />
                </Button>
              ) : null}
              {canReveal ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={revealMedia}
                  title={revealLabel}
                  aria-label={revealLabel}
                >
                  <FolderOpenIcon />
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={copyPath}
                title={pathCopied ? "Copied path" : "Copy path"}
                aria-label={pathCopied ? "Copied path" : "Copy path"}
              >
                <CopyIcon />
              </Button>
            </div>
          </div>
        </article>
        {viewer}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group/media mt-3 grid min-w-0 gap-3 rounded-xl border border-border/70 bg-card/80 shadow-sm transition-colors",
          "hover:border-border hover:bg-card",
          active && "border-primary/55 bg-primary/5",
          compact
            ? "mt-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2 p-2 shadow-none"
            : "p-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]",
        )}
        data-media-artifact-card
        data-media-artifact-active={active ? "true" : undefined}
      >
        <button
          type="button"
          className={cn(
            "relative flex items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/45 text-muted-foreground transition-colors",
            canPreview && "cursor-zoom-in hover:bg-muted/65",
            !canPreview && "cursor-default bg-muted/30",
            compact ? "h-20 min-h-20 rounded-md" : "min-h-32",
          )}
          onClick={openViewer}
          disabled={!canPreview}
          aria-label={`Preview ${artifact.title}`}
        >
          {canPreview && isImageLike ? (
            <img
              src={previewUrl ?? undefined}
              alt={artifact.title}
              className={cn("h-full w-full object-contain", compact ? "max-h-20" : "max-h-48")}
              loading="lazy"
              onError={() => setPreviewFailed(true)}
            />
          ) : canPreview && isVideo ? (
            <video
              src={previewUrl ?? undefined}
              className={cn(
                "h-full w-full bg-black object-contain",
                compact ? "max-h-20" : "max-h-48",
              )}
              muted
              preload="metadata"
              onError={() => setPreviewFailed(true)}
            />
          ) : artifact.kind === "video" ? (
            <PreviewUnavailableState icon="video" compact={compact} label="Preview unavailable" />
          ) : artifact.kind === "gif" ? (
            <PreviewUnavailableState icon="gif" compact={compact} label="Preview unavailable" />
          ) : artifact.kind === "unknown" ? (
            <PreviewUnavailableState icon="image" compact={compact} label="Unsupported format" />
          ) : (
            <PreviewUnavailableState icon="image" compact={compact} label="Preview unavailable" />
          )}
          {canPreview ? (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-black/10 bg-background/90 p-1 text-foreground opacity-0 shadow-sm transition-opacity group-hover/media:opacity-100">
              <Maximize2Icon className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </button>
        <div className="flex min-w-0 flex-col">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {artifact.title}
              </p>
              {recent ? <MediaBadge tone="accent">Recent</MediaBadge> : null}
              {active ? <MediaBadge tone="accent">Active</MediaBadge> : null}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              <MediaBadge>{kindLabel(artifact.kind)}</MediaBadge>
              <MediaBadge>{sourceLabel(artifact.source)}</MediaBadge>
              {artifact.origin ? <MediaBadge>{originLabel(artifact.origin)}</MediaBadge> : null}
            </div>
          </div>
          <p
            className={cn(
              "mt-1 truncate font-mono text-[11px] text-muted-foreground/70",
              compact && "text-[10px]",
            )}
            title={displayPath}
          >
            {displayPath}
          </p>
          {!canPreview ? (
            <div
              className={cn(
                "mt-2 flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/8 px-2 py-1.5 text-xs text-muted-foreground/85",
                compact && "mt-1 rounded-md px-1.5 py-1 text-[11px]",
              )}
            >
              <AlertTriangleIcon
                className={cn("mt-0.5 size-3.5 shrink-0 text-warning", compact && "size-3")}
                aria-hidden
              />
              <p>
                {previewUnavailableMessage} {previewRecoveryMessage}
              </p>
            </div>
          ) : null}
          {compact ? (
            <p
              className="mt-1 truncate text-[11px] text-muted-foreground/70"
              title={compactMetadata}
            >
              {compactMetadata}
            </p>
          ) : (
            <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
              {metadataRows.map((row) => (
                <div
                  key={row.label}
                  className="min-w-0 rounded-md border border-border/45 bg-background/45 px-2 py-1"
                >
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">
                    {row.label}
                  </dt>
                  <dd className="truncate text-muted-foreground/85" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div
            className={cn("mt-3 flex flex-wrap items-center gap-1.5", compact && "mt-2")}
            role="group"
            aria-label={`Actions for ${artifact.title}`}
          >
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!canPreview}
              onClick={openViewer}
            >
              <EyeIcon />
              {isVideo ? "Play" : "Preview"}
            </Button>
            {isImageLike || isVideo ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={!canUseInChat}
                      onClick={useInChat}
                    />
                  }
                >
                  <PlusIcon />
                  Use in chat
                </TooltipTrigger>
                <TooltipPopup>Attach this media to the composer</TooltipPopup>
              </Tooltip>
            ) : null}
            {isImageLike ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={!canCopyImage}
                onClick={copyImage}
                title={
                  canCopyImage
                    ? "Copy the preview image to the clipboard"
                    : "Image clipboard support is unavailable"
                }
              >
                <CopyIcon />
                {imageCopied ? "Copied image" : "Copy image"}
              </Button>
            ) : null}
            {canOpenExternal ? (
              <Button type="button" size="xs" variant="ghost" onClick={openExternally}>
                <ExternalLinkIcon />
                Open
              </Button>
            ) : null}
            {canReveal ? (
              <Button type="button" size="xs" variant="ghost" onClick={revealMedia}>
                <FolderOpenIcon />
                Reveal
              </Button>
            ) : null}
            <Button type="button" size="xs" variant="ghost" onClick={copyPath}>
              <CopyIcon />
              {pathCopied ? "Copied path" : "Copy path"}
            </Button>
          </div>
        </div>
      </div>
      {viewer}
    </>
  );
});

export function MediaArtifactViewer(props: {
  artifact: MediaArtifact;
  url: string;
  canUseInChat: boolean;
  canCopyImage: boolean;
  canOpenExternal: boolean;
  canReveal: boolean;
  imageCopied: boolean;
  pathCopied: boolean;
  revealLabel: string;
  onCopyImage: () => void;
  onCopyPath: () => void;
  onOpenExternal: () => void;
  onReveal: () => void;
  onUseInChat: () => void;
  onClose: () => void;
}) {
  const isImageLike = isImageMediaArtifactKind(props.artifact.kind);
  const isVideo = props.artifact.kind === "video";
  const [imageMode, setImageMode] = useState<"fit" | "zoom">("fit");
  const [zoom, setZoom] = useState(1);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [measuredMetadata, setMeasuredMetadata] = useState<MeasuredMediaMetadata | null>(null);
  const displayPath = mediaArtifactReference(props.artifact);
  const zoomPercent = Math.round(zoom * 100);
  const metadataRows = buildMetadataRows(props.artifact, displayPath, measuredMetadata, 10);
  const viewerMetadataRows = isImageLike
    ? [
        ...metadataRows,
        { label: "Zoom", value: imageMode === "fit" ? "Fit to screen" : `${zoomPercent}%` },
      ]
    : metadataRows;

  const zoomIn = () => {
    setImageMode("zoom");
    setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))));
  };
  const zoomOut = () => {
    setImageMode("zoom");
    setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/72 px-3 py-4 backdrop-blur-md [-webkit-app-region:no-drag] sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${props.artifact.title}`}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label="Close media preview"
        onClick={props.onClose}
      />
      <div
        className={cn(
          "relative z-10 grid max-h-[92vh] w-[min(92rem,96vw)] overflow-hidden rounded-[1.35rem] border border-white/12 bg-[#090a0c] shadow-[0_32px_120px_rgba(0,0,0,0.62)]",
          detailsOpen
            ? "grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_minmax(0,1fr)]"
            : "grid-rows-[auto_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.035] px-3 py-2.5",
            detailsOpen && "lg:col-span-2",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/8 text-white/72">
              {isVideo ? (
                <FilmIcon className="size-4" aria-hidden />
              ) : (
                <ImageIcon className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-white">
                {props.artifact.title}
              </p>
              <p className="truncate font-mono text-[11px] text-white/42" title={displayPath}>
                {displayPath}
              </p>
            </div>
          </div>
          {isImageLike ? (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/24 p-1">
              <Button
                type="button"
                size="xs"
                variant={imageMode === "fit" ? "secondary" : "ghost"}
                className="border-white/10 text-white hover:bg-white/12"
                onClick={() => setImageMode("fit")}
              >
                Fit
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="border-white/10 text-white hover:bg-white/12"
                onClick={zoomOut}
                aria-label="Zoom out"
              >
                <ZoomOutIcon />
              </Button>
              <Button
                type="button"
                size="xs"
                variant={imageMode === "zoom" && zoom === 1 ? "secondary" : "ghost"}
                className="border-white/10 text-white hover:bg-white/12"
                onClick={() => {
                  setImageMode("zoom");
                  setZoom(1);
                }}
              >
                {imageMode === "fit" ? "100%" : `${zoomPercent}%`}
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="border-white/10 text-white hover:bg-white/12"
                onClick={zoomIn}
                aria-label="Zoom in"
              >
                <ZoomInIcon />
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant={detailsOpen ? "secondary" : "ghost"}
            className="border-white/10 text-white hover:bg-white/12"
            aria-pressed={detailsOpen}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {detailsOpen ? "Hide details" : "Details"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="border-white/10 text-white hover:bg-white/12"
            onClick={props.onCopyPath}
          >
            <CopyIcon />
            {props.pathCopied ? "Copied path" : "Copy path"}
          </Button>
          {isImageLike ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!props.canCopyImage}
              className="border-white/10 text-white hover:bg-white/12"
              onClick={props.onCopyImage}
            >
              <CopyIcon />
              {props.imageCopied ? "Copied image" : "Copy image"}
            </Button>
          ) : null}
          {props.canOpenExternal ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="border-white/10 text-white hover:bg-white/12"
              onClick={props.onOpenExternal}
            >
              <ExternalLinkIcon />
              Open
            </Button>
          ) : null}
          {props.canReveal ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="border-white/10 text-white hover:bg-white/12"
              onClick={props.onReveal}
            >
              <FolderOpenIcon />
              {props.revealLabel}
            </Button>
          ) : null}
          {isImageLike || isVideo ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!props.canUseInChat}
              className="border-white/20 bg-white/8 text-white hover:bg-white/14"
              onClick={props.onUseInChat}
            >
              <PlusIcon />
              Use in chat
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="border-white/10 text-white hover:bg-white/12"
            onClick={props.onClose}
            aria-label="Close media preview"
          >
            <XIcon />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.09),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.055),_rgba(255,255,255,0.01))]">
          <div className="flex min-h-full items-center justify-center p-3 sm:p-5">
            {isImageLike ? (
              <img
                src={props.url}
                alt={props.artifact.title}
                className={cn(
                  "rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10",
                  imageMode === "fit" ? "max-h-[calc(92vh-9rem)] max-w-full" : "max-w-none",
                )}
                style={imageMode === "zoom" ? { width: `${zoom * 100}%` } : undefined}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setMeasuredMetadata({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                }}
              />
            ) : isVideo ? (
              <video
                src={props.url}
                controls
                autoPlay
                className="max-h-[calc(92vh-9rem)] max-w-full rounded-xl bg-black shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  const durationMs = Number.isFinite(video.duration)
                    ? Math.max(0, Math.round(video.duration * 1000))
                    : undefined;
                  setMeasuredMetadata({
                    width: video.videoWidth,
                    height: video.videoHeight,
                    ...(durationMs !== undefined ? { durationMs } : {}),
                  });
                }}
              />
            ) : (
              <PreviewUnavailableState icon="image" compact={false} label="Unsupported format" />
            )}
          </div>
        </div>
        {detailsOpen ? (
          <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-white/[0.035] p-3 lg:border-l lg:border-t-0">
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
                Asset details
              </p>
              <p className="mt-1 text-xs text-white/62">
                {kindLabel(props.artifact.kind)} from {sourceLabel(props.artifact.source)}
              </p>
            </div>
            <dl className="grid gap-2 text-[11px]">
              {viewerMetadataRows.map((row) => (
                <div
                  key={row.label}
                  className="min-w-0 rounded-xl border border-white/8 bg-black/20 px-2.5 py-2"
                >
                  <dt className="uppercase tracking-[0.14em] text-white/35">{row.label}</dt>
                  <dd className="mt-0.5 truncate text-white/76" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function PreviewUnavailableState(props: {
  icon: "gif" | "image" | "video";
  compact: boolean;
  label: string;
}) {
  const Icon = props.icon === "video" ? FilmIcon : props.icon === "gif" ? ImageIcon : FileImageIcon;
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-2 text-center">
      <Icon className={cn("size-7", props.compact && "size-5")} aria-hidden />
      {!props.compact ? (
        <span className="text-[11px] font-medium text-muted-foreground/75">{props.label}</span>
      ) : null}
    </div>
  );
}

function MediaBadge(props: { children: string; tone?: "muted" | "accent" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
        props.tone === "accent"
          ? "border-primary/35 bg-primary/10 text-primary"
          : "border-border/70 bg-background/70 text-muted-foreground",
      )}
    >
      {props.children}
    </span>
  );
}

interface MeasuredMediaMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
}

function buildMetadataRows(
  artifact: MediaArtifact,
  displayPath: string,
  measuredMetadata?: MeasuredMediaMetadata | null,
  maxRows = 7,
) {
  const dimensions = formatDimensions(
    artifact.width ?? measuredMetadata?.width,
    artifact.height ?? measuredMetadata?.height,
  );
  const durationMs = artifact.durationMs ?? measuredMetadata?.durationMs;
  const rows = [
    { label: "Source", value: sourceLabel(artifact.source) },
    { label: "Kind", value: kindLabel(artifact.kind) },
    ...(artifact.origin ? [{ label: "Origin", value: originLabel(artifact.origin) }] : []),
    ...(dimensions ? [{ label: "Dimensions", value: dimensions }] : []),
    ...(durationMs !== undefined
      ? [{ label: "Duration", value: formatDurationMs(durationMs) }]
      : []),
    ...(artifact.mimeType ? [{ label: "MIME", value: artifact.mimeType }] : []),
    ...(artifact.sizeBytes !== undefined
      ? [{ label: "Size", value: formatBytes(artifact.sizeBytes) }]
      : []),
    ...(artifact.modifiedAt ? [{ label: "Modified", value: artifact.modifiedAt }] : []),
    {
      label: "Ext",
      value: artifact.extension ? `.${artifact.extension}` : "unknown",
    },
    { label: "Ref", value: displayPath },
  ];
  return rows.slice(0, maxRows);
}

function buildCompactMetadata(artifact: MediaArtifact): string {
  return [
    kindLabel(artifact.kind),
    sourceLabel(artifact.source),
    ...(artifact.origin ? [originLabel(artifact.origin)] : []),
    ...(formatDimensions(artifact.width, artifact.height)
      ? [formatDimensions(artifact.width, artifact.height)!]
      : []),
    ...(artifact.durationMs !== undefined ? [formatDurationMs(artifact.durationMs)] : []),
    ...(artifact.sizeBytes !== undefined ? [formatBytes(artifact.sizeBytes)] : []),
  ].join(" - ");
}

function kindLabel(kind: MediaArtifact["kind"]): string {
  switch (kind) {
    case "gif":
      return "GIF";
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "unknown":
      return "Media";
  }
}

function sourceLabel(source: MediaArtifact["source"]): string {
  switch (source) {
    case "generated":
      return "Generated";
    case "local":
      return "Local";
    case "web":
      return "Web";
    case "project":
      return "Project";
  }
}

function originLabel(origin: NonNullable<MediaArtifact["origin"]>): string {
  switch (origin) {
    case "attached":
      return "Attached";
    case "found":
      return "Found";
    case "generated":
      return "Generated";
  }
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "unknown";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDimensions(width: number | undefined, height: number | undefined): string | null {
  if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) {
    return null;
  }
  return `${Math.round(width)}x${Math.round(height)}`;
}

function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "unknown";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isPositiveFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function buildPreviewRecoveryMessage(input: {
  readonly canOpenExternal: boolean;
  readonly canReveal: boolean;
  readonly revealLabel: string;
}): string {
  const actions = [
    "Copy path",
    ...(input.canOpenExternal ? ["Open externally"] : []),
    ...(input.canReveal ? [input.revealLabel] : []),
  ];
  return `Use ${formatActionList(actions)}.`;
}

function formatActionList(actions: ReadonlyArray<string>): string {
  if (actions.length <= 1) {
    return actions[0] ?? "Copy path";
  }
  if (actions.length === 2) {
    return `${actions[0]} or ${actions[1]}`;
  }
  return `${actions.slice(0, -1).join(", ")}, or ${actions[actions.length - 1]}`;
}

function resetBooleanStateSoon(setValue: (value: boolean) => void) {
  if (typeof window === "undefined") return;
  window.setTimeout(() => setValue(false), 2_000);
}

async function writeImageToClipboard(url: string, artifact: MediaArtifact): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard API unavailable.");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${artifact.title}.`);
  }

  const responseBlob = await response.blob();
  const mimeType = normalizeImageClipboardMimeType(
    responseBlob.type || artifact.mimeType || imageMimeTypeForExtension(artifact.extension),
  );
  if (!mimeType) {
    throw new Error("The preview did not resolve to a supported image type.");
  }
  if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports(mimeType)) {
    throw new Error(`This browser cannot copy ${mimeType} images.`);
  }

  const clipboardBlob =
    responseBlob.type === mimeType
      ? responseBlob
      : responseBlob.slice(0, responseBlob.size, mimeType);
  await clipboard.write([new ClipboardItem({ [mimeType]: clipboardBlob })]);
}

function normalizeImageClipboardMimeType(mimeType: string): string | null {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized.startsWith("image/")) return null;
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function canWriteImageToClipboard(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined",
  );
}

function getDesktopBridge() {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

function hasDesktopBridge(): boolean {
  return Boolean(getDesktopBridge());
}

function hasDesktopLocalMediaRevealBridge(): boolean {
  return Boolean(getDesktopBridge()?.revealLocalMediaFile);
}

function getNavigatorPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function mediaMimeTypeForExtension(kind: MediaArtifact["kind"], extension: string): string {
  return kind === "video"
    ? videoMimeTypeForExtension(extension)
    : imageMimeTypeForExtension(extension);
}

function imageMimeTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    default:
      return extension ? `image/${extension}` : "image/png";
  }
}

function videoMimeTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "mov":
      return "video/quicktime";
    case "ogv":
    case "ogg":
      return "video/ogg";
    case "webm":
      return "video/webm";
    case "m4v":
      return "video/x-m4v";
    case "mp4":
      return "video/mp4";
    default:
      return extension ? `video/${extension}` : "video/mp4";
  }
}
