import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  FilterIcon,
  ListFilterIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import type { DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import {
  buildLocalMediaSearchResultSetDisplayModel,
  type LocalMediaSearchResultArtifact,
  type LocalMediaSearchResultDisplayModel,
  type LocalMediaSearchResultSet,
  type LocalMediaSearchScopeRefinementModel,
} from "~/mediaArtifacts";
import { Button } from "../ui/button";
import { MediaArtifactCard } from "./MediaArtifactCard";

interface LocalMediaSearchResultsProps {
  resultSet: LocalMediaSearchResultSet;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  composerTarget?: ScopedThreadRef | DraftId | undefined;
  className?: string | undefined;
  onRefineScope?: (
    refinement: LocalMediaSearchScopeRefinementModel,
    resultSet: LocalMediaSearchResultSet,
  ) => void;
  renderArtifactCard?: (input: {
    artifact: LocalMediaSearchResultArtifact;
    display: LocalMediaSearchResultDisplayModel;
  }) => ReactNode;
}

export const LocalMediaSearchResults = memo(function LocalMediaSearchResults({
  resultSet,
  environmentId,
  threadRef,
  composerTarget,
  className,
  onRefineScope,
  renderArtifactCard,
}: LocalMediaSearchResultsProps) {
  const display = buildLocalMediaSearchResultSetDisplayModel(resultSet);

  return (
    <section
      className={cn(
        "my-3 rounded-2xl border border-border/70 bg-card/75 p-3 shadow-sm",
        "supports-[backdrop-filter]:bg-card/70 supports-[backdrop-filter]:backdrop-blur",
        className,
      )}
      aria-labelledby={`${display.id}-heading`}
      data-local-media-search-results
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/65 bg-background/75 text-muted-foreground shadow-xs">
            <SearchIcon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 id={`${display.id}-heading`} className="truncate text-sm font-semibold">
                {display.title}
              </h3>
              <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                {display.summary}
              </span>
            </div>
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/65 px-2 py-0.5">
                <ListFilterIcon className="size-3" aria-hidden />
                Scope: {display.scopeLabel}
              </span>
              {display.scopeDetail ? (
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/75">
                  {display.scopeDetail}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {display.scopeWarning ? (
          <div className="rounded-xl border border-warning/35 bg-warning/8 p-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">Broad PC scope</p>
                <p className="mt-0.5 text-xs text-muted-foreground/85">{display.scopeWarning}</p>
              </div>
            </div>
            {display.refinements.length > 0 ? (
              <RefinementControls
                label={display.refinementLabel}
                refinements={display.refinements}
                disabled={!onRefineScope}
                onSelect={(refinement) => onRefineScope?.(refinement, resultSet)}
              />
            ) : null}
          </div>
        ) : display.refinements.length > 0 ? (
          <RefinementControls
            label={display.refinementLabel}
            refinements={display.refinements}
            disabled={!onRefineScope}
            onSelect={(refinement) => onRefineScope?.(refinement, resultSet)}
          />
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2" role="list" aria-label={display.summary}>
          {display.results.map((result) => (
            <article key={result.key} className="min-w-0" role="listitem">
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {result.rankLabel}
                </span>
                <ConfidenceBadge result={result} />
                {result.scoreLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/65 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <StarIcon className="size-3" aria-hidden />
                    {result.scoreLabel}
                  </span>
                ) : null}
                {result.modifiedLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/65 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <CalendarClockIcon className="size-3" aria-hidden />
                    Modified {result.modifiedLabel}
                  </span>
                ) : null}
              </div>
              {renderArtifactCard ? (
                renderArtifactCard({ artifact: result.artifact, display: result })
              ) : (
                <MediaArtifactCard
                  artifact={result.artifact}
                  environmentId={environmentId}
                  threadRef={threadRef}
                  composerTarget={composerTarget}
                  compact
                />
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
});

function RefinementControls({
  label,
  refinements,
  disabled,
  onSelect,
}: {
  label: string;
  refinements: readonly LocalMediaSearchScopeRefinementModel[];
  disabled: boolean;
  onSelect: (refinement: LocalMediaSearchScopeRefinementModel) => void;
}) {
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <FilterIcon className="size-3" aria-hidden />
        {label}
      </span>
      {refinements.map((refinement) => (
        <Button
          key={refinement.id}
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled}
          title={refinement.description}
          onClick={() => onSelect(refinement)}
        >
          {refinement.label}
        </Button>
      ))}
    </div>
  );
}

function ConfidenceBadge({ result }: { result: LocalMediaSearchResultDisplayModel }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px]",
        result.confidenceTone === "strong" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        result.confidenceTone === "medium" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        result.confidenceTone === "muted" &&
          "border-border/60 bg-background/65 text-muted-foreground",
      )}
    >
      {result.confidenceLabel}
    </span>
  );
}
