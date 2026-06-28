import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ImagesIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import type { MediaArtifact, ThreadMediaArtifact } from "~/mediaArtifacts";
import { mediaArtifactDedupKey } from "~/mediaArtifacts";
import { MediaArtifactCard } from "./MediaArtifactCard";

interface MediaPanelProps {
  artifacts: ReadonlyArray<ThreadMediaArtifact>;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  composerTarget?: ScopedThreadRef | DraftId | undefined;
  activeArtifactKey?: string | null | undefined;
  onActiveArtifactKeyChange?: (artifactKey: string | null) => void;
  className?: string;
}

export const MediaPanel = memo(function MediaPanel({
  artifacts,
  environmentId,
  threadRef,
  composerTarget,
  activeArtifactKey,
  onActiveArtifactKeyChange,
  className,
}: MediaPanelProps) {
  const [localActiveKey, setLocalActiveKey] = useState<string | null>(null);
  const activeKey = activeArtifactKey !== undefined ? activeArtifactKey : localActiveKey;
  const artifactKeys = useMemo(
    () => new Set(artifacts.map((artifact) => artifact.dedupeKey)),
    [artifacts],
  );
  const setActiveKey = useCallback(
    (artifactKey: string | null) => {
      setLocalActiveKey(artifactKey);
      onActiveArtifactKeyChange?.(artifactKey);
    },
    [onActiveArtifactKeyChange],
  );

  useEffect(() => {
    const latestKey = artifacts[0]?.dedupeKey ?? null;
    if (!activeKey || !artifactKeys.has(activeKey)) {
      setActiveKey(latestKey);
    }
  }, [activeKey, artifactKeys, artifacts, setActiveKey]);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.dedupeKey === activeKey) ?? artifacts[0] ?? null,
    [activeKey, artifacts],
  );
  const markActive = useCallback(
    (artifact: MediaArtifact) => {
      const threadArtifactKey = (artifact as Partial<ThreadMediaArtifact>).dedupeKey;
      setActiveKey(
        typeof threadArtifactKey === "string" ? threadArtifactKey : mediaArtifactDedupKey(artifact),
      );
    },
    [setActiveKey],
  );

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}>
      <div className="border-b border-border/70 bg-card/35 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/65 bg-background/75 text-muted-foreground shadow-xs">
            <ImagesIcon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Media</h2>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {artifacts.length} {artifacts.length === 1 ? "asset" : "assets"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Images, videos, and attachments collected from this thread.
            </p>
          </div>
        </div>
      </div>

      {artifacts.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-xs">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/65 bg-card/55 text-muted-foreground">
              <ImagesIcon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-foreground">No media yet</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Attach an image, generate media, or ask the agent to find local media. Anything
              relevant will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeArtifact ? (
            <div className="mb-4 rounded-2xl border border-border/65 bg-card/45 p-2.5 shadow-sm">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
                  Selected
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{activeArtifact.title}</p>
              </div>
              <MediaArtifactCard
                artifact={activeArtifact}
                environmentId={environmentId}
                threadRef={threadRef}
                composerTarget={composerTarget}
                active
                onInteract={markActive}
              />
            </div>
          ) : null}

          <div className="mb-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
              All media
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {artifacts.map((artifact, index) => (
              <MediaArtifactCard
                key={artifact.dedupeKey}
                artifact={artifact}
                environmentId={environmentId}
                threadRef={threadRef}
                composerTarget={composerTarget}
                compact
                active={artifact.dedupeKey === activeArtifact?.dedupeKey}
                recent={index === 0}
                onInteract={markActive}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
});
