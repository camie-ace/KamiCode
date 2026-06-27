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
  className?: string;
}

export const MediaShelf = memo(function MediaShelf({
  artifacts,
  environmentId,
  threadRef,
  composerTarget,
  activeArtifactKey,
  onActiveArtifactKeyChange,
  className,
}: MediaShelfProps) {
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
        "rounded-xl border border-border/65 bg-background/95 p-2 shadow-sm backdrop-blur",
        className,
      )}
      aria-label={`Thread media shelf with ${artifacts.length} item${artifacts.length === 1 ? "" : "s"}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-1 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/65 bg-card/80 text-muted-foreground">
            <ImagesIcon className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-medium text-foreground">Recent Media</h2>
              <span className="rounded-full border border-border/60 bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {artifacts.length}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground/70">
              {activeArtifact
                ? `Selected: ${activeArtifact.title}`
                : "Preview, use, or copy thread media."}
            </p>
          </div>
        </div>
        {artifacts.length > COLLAPSED_MEDIA_LIMIT ? (
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
      <div
        className={cn(
          "flex gap-2 overflow-x-auto pb-1",
          expanded && "max-h-[20rem] flex-wrap overflow-y-auto pr-1",
        )}
      >
        {visibleArtifacts.map((artifact, index) => (
          <div key={artifact.dedupeKey} className="w-[min(18rem,82vw)] shrink-0">
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
    </section>
  );
});
