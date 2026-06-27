import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, ImagesIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import type { MediaArtifact, ThreadMediaArtifact } from "~/mediaArtifacts";
import { mediaArtifactDedupKey } from "~/mediaArtifacts";
import { Button } from "../ui/button";
import { MediaArtifactCard } from "./MediaArtifactCard";

const COLLAPSED_MEDIA_LIMIT = 4;

interface MediaShelfProps {
  artifacts: ReadonlyArray<ThreadMediaArtifact>;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  composerTarget?: ScopedThreadRef | DraftId | undefined;
  activeArtifactKey?: string | null | undefined;
  onActiveArtifactKeyChange?: (artifactKey: string | null) => void;
  onOpenMediaPanel?: () => void;
  className?: string;
}

export const MediaShelf = memo(function MediaShelf({
  artifacts,
  environmentId,
  threadRef,
  composerTarget,
  activeArtifactKey,
  onActiveArtifactKeyChange,
  onOpenMediaPanel,
  className,
}: MediaShelfProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState(false);
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
  }, [activeKey, artifactKeys, artifacts]);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.dedupeKey === activeKey) ?? artifacts[0] ?? null,
    [activeKey, artifacts],
  );
  const visibleArtifacts = expanded ? artifacts : artifacts.slice(0, COLLAPSED_MEDIA_LIMIT);
  const hiddenCount = Math.max(0, artifacts.length - visibleArtifacts.length);
  const markActive = useCallback((artifact: MediaArtifact) => {
    const threadArtifactKey = (artifact as Partial<ThreadMediaArtifact>).dedupeKey;
    setActiveKey(
      typeof threadArtifactKey === "string" ? threadArtifactKey : mediaArtifactDedupKey(artifact),
    );
  }, []);

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-card/78 shadow-[0_18px_52px_rgba(0,0,0,0.18)] backdrop-blur-xl",
        "supports-[backdrop-filter]:bg-card/62",
        className,
      )}
      aria-label={`Thread media shelf with ${artifacts.length} item${artifacts.length === 1 ? "" : "s"}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/45 bg-gradient-to-r from-background/72 via-background/42 to-transparent px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/65 bg-background/75 text-muted-foreground shadow-xs">
            <ImagesIcon className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">
                Recent Media
              </h2>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {artifacts.length} {artifacts.length === 1 ? "asset" : "assets"}
              </span>
              {activeArtifact ? (
                <span className="rounded-full border border-border/55 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                  Selected
                </span>
              ) : null}
            </div>
            <p className="truncate text-[11px] text-muted-foreground/70">
              {activeArtifact ? activeArtifact.title : "Preview, use, or copy thread media."}
            </p>
          </div>
        </div>
        {onOpenMediaPanel ? (
          <Button type="button" size="xs" variant="secondary" onClick={onOpenMediaPanel}>
            Open Media
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          {collapsed ? "Peek" : "Collapse"}
        </Button>
        {!collapsed && artifacts.length > COLLAPSED_MEDIA_LIMIT ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </Button>
        ) : null}
      </div>
      {!collapsed ? (
        <div
          className={cn(
            "flex gap-3 overflow-x-auto px-3 py-3 [scrollbar-width:thin]",
            "snap-x snap-mandatory",
            expanded && "max-h-[28rem] flex-wrap overflow-y-auto pr-2",
          )}
        >
          {visibleArtifacts.map((artifact, index) => (
            <div key={artifact.dedupeKey} className="w-[min(14.5rem,76vw)] shrink-0 snap-start">
              <MediaArtifactCard
                artifact={artifact}
                environmentId={environmentId}
                threadRef={threadRef}
                composerTarget={composerTarget}
                compact
                active={artifact.dedupeKey === activeArtifact?.dedupeKey}
                recent={index === 0}
                onInteract={markActive}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
});
