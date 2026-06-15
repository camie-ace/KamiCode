import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  HistoryIcon,
  ImagesIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  VideoIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  artifactFileName,
  formatEvidenceSummaryForDisplay,
  testHarnessArtifactUrl,
} from "~/testHarnessArtifacts";
import { cn } from "~/lib/utils";
import { TestHarnessTraceViewer } from "./TestHarnessTraceViewer";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";

type TestHarnessRunStatus = "pass" | "fail" | "blocked" | "error";

interface TestHarnessRunArtifactPaths {
  readonly trace?: string | undefined;
  readonly screenshots?: ReadonlyArray<string> | undefined;
  readonly video?: string | undefined;
  readonly videos?: ReadonlyArray<string> | undefined;
  readonly summary?: string | undefined;
  readonly markdown?: string | undefined;
}

interface TestHarnessRunScreenshot {
  readonly label: string;
  readonly path: string;
}

interface TestHarnessRunVideo {
  readonly label: string;
  readonly path: string;
}

interface TestHarnessRunHistoryItem {
  readonly runId: string;
  readonly status: TestHarnessRunStatus;
  readonly success: boolean;
  readonly goal: string | null;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly evidenceSummary: string;
  readonly outputSummary?: string | undefined;
  readonly artifactPaths: TestHarnessRunArtifactPaths;
  readonly screenshots: ReadonlyArray<TestHarnessRunScreenshot>;
  readonly videos?: ReadonlyArray<TestHarnessRunVideo> | undefined;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly networkFailures: ReadonlyArray<string>;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly markdownPath?: string | undefined;
  readonly summaryPath?: string | undefined;
}

interface TestHarnessRunsResponse {
  readonly runs: ReadonlyArray<TestHarnessRunHistoryItem>;
}

interface TestHarnessRunsControlProps {
  readonly projectId: string | undefined;
  readonly projectCwd: string | undefined;
  readonly onOpenPanel?: (() => void) | undefined;
}

const RUN_HISTORY_REFRESH_INTERVAL_MS = 5_000;

function statusLabel(status: TestHarnessRunStatus): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "blocked":
      return "BLOCKED";
    case "error":
      return "ERROR";
  }
}

function statusIcon(status: TestHarnessRunStatus) {
  switch (status) {
    case "pass":
      return CheckCircle2Icon;
    case "fail":
    case "error":
      return XCircleIcon;
    case "blocked":
      return AlertTriangleIcon;
  }
}

function statusClass(status: TestHarnessRunStatus): string {
  switch (status) {
    case "pass":
      return "border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
    case "fail":
    case "error":
      return "border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-200";
    case "blocked":
      return "border-amber-400/35 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }
}

function formatRunTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatRunDuration(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatLastUpdated(value: string | null): string {
  if (!value) {
    return "Not refreshed yet";
  }
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(Date.parse(value))}`;
}

function runIssueSummary(run: TestHarnessRunHistoryItem): string | null {
  if (run.consoleErrors.length === 0 && run.networkFailures.length === 0) {
    return null;
  }
  return `${run.consoleErrors.length} console issue(s), ${run.networkFailures.length} network failure(s)`;
}

async function fetchTestHarnessRuns(input: {
  readonly projectId: string | undefined;
  readonly projectCwd: string;
  readonly signal: AbortSignal;
}): Promise<TestHarnessRunsResponse> {
  const params = new URLSearchParams({
    cwd: input.projectCwd,
    limit: "20",
  });
  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const response = await fetch(`/api/test-harness/runs?${params.toString()}`, {
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`Run history request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as TestHarnessRunsResponse;
}

function ArtifactLink(props: {
  readonly label: string;
  readonly path: string | undefined;
  readonly icon: LucideIcon;
}) {
  if (!props.path) {
    return null;
  }
  const Icon = props.icon;
  return (
    <a
      href={testHarnessArtifactUrl(props.path)}
      target="_blank"
      rel="noreferrer"
      title={artifactFileName(props.path)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <Icon className="size-3" />
      {props.label}
      <ExternalLinkIcon className="size-2.5 opacity-55" />
    </a>
  );
}

function StatusPill({ status }: { readonly status: TestHarnessRunStatus }) {
  const StatusIcon = statusIcon(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.12em]",
        statusClass(status),
      )}
    >
      <StatusIcon className="size-3" />
      {statusLabel(status)}
    </span>
  );
}

function ScreenshotGallery({
  screenshots,
}: {
  readonly screenshots: ReadonlyArray<TestHarnessRunScreenshot>;
}) {
  const latestScreenshot = screenshots.at(-1);
  const thumbnailScreenshots = screenshots.slice(-5);

  if (!latestScreenshot) {
    return (
      <div className="flex h-28 items-center justify-center border-b border-border/55 bg-muted/30 text-xs text-muted-foreground">
        <ImagesIcon className="mr-2 size-4" />
        No screenshot captured
      </div>
    );
  }

  return (
    <div className="border-b border-border/55 bg-background/45">
      <a
        href={testHarnessArtifactUrl(latestScreenshot.path)}
        target="_blank"
        rel="noreferrer"
        className="block"
        title={`Open ${artifactFileName(latestScreenshot.path)}`}
      >
        <img
          src={testHarnessArtifactUrl(latestScreenshot.path)}
          alt={latestScreenshot.label}
          loading="lazy"
          className="max-h-48 w-full object-contain"
        />
      </a>
      {thumbnailScreenshots.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-t border-border/45 p-1.5">
          {thumbnailScreenshots.map((screenshot) => (
            <a
              key={screenshot.path}
              href={testHarnessArtifactUrl(screenshot.path)}
              target="_blank"
              rel="noreferrer"
              title={artifactFileName(screenshot.path)}
              className={cn(
                "h-12 w-20 shrink-0 overflow-hidden rounded-md border bg-background/70",
                screenshot.path === latestScreenshot.path ? "border-ring" : "border-border/60",
              )}
            >
              <img
                src={testHarnessArtifactUrl(screenshot.path)}
                alt={screenshot.label}
                loading="lazy"
                className="size-full object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TestHarnessRunCard({
  run,
  dense = false,
}: {
  readonly run: TestHarnessRunHistoryItem;
  readonly dense?: boolean | undefined;
}) {
  const duration = formatRunDuration(run.durationMs);
  const summary = formatEvidenceSummaryForDisplay(run.outputSummary ?? run.evidenceSummary);
  const issueSummary = runIssueSummary(run);
  const latestVideo = run.videos?.at(-1)?.path ?? run.artifactPaths.video;

  return (
    <article className="overflow-hidden rounded-xl border border-border/65 bg-card/35">
      <ScreenshotGallery screenshots={run.screenshots} />
      <div className={cn("space-y-2 p-3", !dense && "sm:p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill status={run.status} />
          <span className="text-[10px] text-muted-foreground/70">
            {formatRunTime(run.completedAt)}
            {duration ? ` - ${duration}` : ""}
          </span>
        </div>
        {run.goal ? (
          <div className="line-clamp-2 text-xs font-medium text-foreground/85">{run.goal}</div>
        ) : (
          <div className="text-xs font-medium text-muted-foreground">No goal recorded</div>
        )}
        <p className="line-clamp-3 text-xs leading-5 text-muted-foreground/85">{summary}</p>
        {run.finalUrl || run.title ? (
          <div className="flex flex-wrap gap-1.5">
            {run.title ? (
              <span className="rounded-md border border-border/50 bg-background/45 px-2 py-0.5 text-[10px] text-muted-foreground/75">
                {run.title}
              </span>
            ) : null}
            {run.finalUrl ? (
              <span className="max-w-full truncate rounded-md border border-border/50 bg-background/45 px-2 py-0.5 text-[10px] text-muted-foreground/75">
                {run.finalUrl}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <TestHarnessTraceViewer tracePath={run.artifactPaths.trace} compact />
          <ArtifactLink
            label="Summary"
            path={run.markdownPath ?? run.artifactPaths.markdown ?? run.summaryPath}
            icon={FileTextIcon}
          />
          {run.screenshots.length > 0 ? (
            <ArtifactLink
              label={`${run.screenshots.length} screenshot${run.screenshots.length === 1 ? "" : "s"}`}
              path={run.screenshots.at(-1)?.path}
              icon={CameraIcon}
            />
          ) : null}
          <ArtifactLink label="Recording" path={latestVideo} icon={VideoIcon} />
        </div>
        {issueSummary ? (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-200">
            {issueSummary}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RunHistoryEmptyState({
  loading,
  onRefresh,
}: {
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 p-5 text-center">
      <div className="mx-auto flex size-9 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
        <HistoryIcon className="size-4" />
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">No test runs yet</div>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        Switch the composer to Test mode and ask the agent to validate a visible behavior. Evidence
        will appear here after the first harness run.
      </p>
      <Button className="mt-4" size="xs" variant="outline" onClick={onRefresh} disabled={loading}>
        {loading ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-3" />
        )}
        Refresh
      </Button>
    </div>
  );
}

function RunHistoryErrorState({
  error,
  hasStaleRuns,
  loading,
  onRefresh,
}: {
  readonly error: string;
  readonly hasStaleRuns: boolean;
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            {hasStaleRuns ? "Could not refresh test runs" : "Could not load test runs"}
          </div>
          <div className="mt-1 text-rose-700/80 dark:text-rose-200/80">{error}</div>
        </div>
        <Button size="xs" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3" />
          )}
          Retry
        </Button>
      </div>
    </div>
  );
}

function RunHistoryList({
  runs,
  dense,
}: {
  readonly runs: ReadonlyArray<TestHarnessRunHistoryItem>;
  readonly dense?: boolean | undefined;
}) {
  return (
    <div className={cn("space-y-2", !dense && "sm:space-y-3")}>
      {runs.map((run) => (
        <TestHarnessRunCard key={run.runId} run={run} dense={dense} />
      ))}
    </div>
  );
}

export default function TestHarnessRunsControl({
  projectId,
  projectCwd,
  onOpenPanel,
}: TestHarnessRunsControlProps) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [runs, setRuns] = useState<ReadonlyArray<TestHarnessRunHistoryItem>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const latestRun = runs[0];
  const visible = open || sheetOpen;
  const shouldFetchRuns = Boolean(projectCwd) && (visible || runs.length === 0);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    setRuns([]);
    setError(null);
    setLastLoadedAt(null);
  }, [projectCwd, projectId]);

  useEffect(() => {
    if (!shouldFetchRuns || !projectCwd) {
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTestHarnessRuns({
      projectId,
      projectCwd,
      signal: abortController.signal,
    })
      .then((response) => {
        setRuns(response.runs);
        setLastLoadedAt(new Date().toISOString());
      })
      .catch((cause: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [shouldFetchRuns, projectCwd, projectId, refreshNonce]);

  useEffect(() => {
    if (!visible || !projectCwd) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, RUN_HISTORY_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [visible, projectCwd]);

  const headerMeta = useMemo(() => {
    if (loading && runs.length === 0) {
      return "Loading recent evidence...";
    }
    if (latestRun) {
      return `${statusLabel(latestRun.status)} latest - ${formatRunTime(latestRun.completedAt)}`;
    }
    return "Recent visible harness evidence for this project.";
  }, [latestRun, loading, runs.length]);

  const historyBody = (
    <>
      {error ? (
        <RunHistoryErrorState
          error={error}
          hasStaleRuns={runs.length > 0}
          loading={loading}
          onRefresh={refresh}
        />
      ) : null}

      {!loading && !error && runs.length === 0 ? (
        <RunHistoryEmptyState loading={loading} onRefresh={refresh} />
      ) : null}

      {loading && runs.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-muted/15 p-5 text-center text-xs text-muted-foreground">
          <Loader2Icon className="mx-auto mb-2 size-4 animate-spin" />
          Loading test runs...
        </div>
      ) : null}

      {runs.length > 0 ? <RunHistoryList runs={runs} dense /> : null}
    </>
  );

  if (onOpenPanel) {
    return (
      <Button
        variant="outline"
        size="xs"
        className={cn(
          "gap-1.5",
          latestRun &&
            "border-border/80 bg-card/65 text-foreground hover:border-border hover:bg-card",
        )}
        disabled={!projectCwd}
        aria-label="Open test runs panel"
        title={latestRun ? `Latest test run: ${statusLabel(latestRun.status)}` : "Test run history"}
        onClick={onOpenPanel}
      >
        <HistoryIcon className="size-3" />
        <span className="hidden text-[11px] sm:inline">
          {latestRun ? `Test ${statusLabel(latestRun.status)}` : "Test runs"}
        </span>
        {latestRun ? (
          <span
            className={cn(
              "ml-0.5 size-1.5 rounded-full",
              latestRun.status === "pass"
                ? "bg-emerald-500"
                : latestRun.status === "blocked"
                  ? "bg-amber-500"
                  : "bg-rose-500",
            )}
          />
        ) : null}
      </Button>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              className={cn(
                "gap-1.5",
                latestRun &&
                  "border-border/80 bg-card/65 text-foreground hover:border-border hover:bg-card",
              )}
              disabled={!projectCwd}
              aria-label="Open test run history"
              title={
                latestRun ? `Latest test run: ${statusLabel(latestRun.status)}` : "Test run history"
              }
            >
              <HistoryIcon className="size-3" />
              <span className="hidden text-[11px] sm:inline">
                {latestRun ? `Test ${statusLabel(latestRun.status)}` : "Test runs"}
              </span>
              {latestRun ? (
                <span
                  className={cn(
                    "ml-0.5 size-1.5 rounded-full",
                    latestRun.status === "pass"
                      ? "bg-emerald-500"
                      : latestRun.status === "blocked"
                        ? "bg-amber-500"
                        : "bg-rose-500",
                  )}
                />
              ) : null}
            </Button>
          }
        />
        <PopoverPopup
          align="end"
          side="bottom"
          className="w-[min(92vw,30rem)] [--viewport-inline-padding:--spacing(3)]"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-foreground">Test runs</div>
                  {latestRun ? <StatusPill status={latestRun.status} /> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{headerMeta}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {formatLastUpdated(lastLoadedAt)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refresh}
                  disabled={loading || !projectCwd}
                  aria-label="Refresh test runs"
                >
                  {loading ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    setSheetOpen(true);
                    setOpen(false);
                  }}
                  disabled={!projectCwd}
                  aria-label="Open test runs panel"
                >
                  <Maximize2Icon className="size-3" />
                </Button>
              </div>
            </div>

            <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">{historyBody}</div>
          </div>
        </PopoverPopup>
      </Popover>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetPopup side="right" variant="inset" className="max-w-2xl">
          <SheetHeader>
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <SheetTitle>Test Runs</SheetTitle>
                <SheetDescription>
                  Recent visible harness evidence for the active project. This refreshes while open.
                </SheetDescription>
                <div className="mt-2 text-xs text-muted-foreground/70">
                  {formatLastUpdated(lastLoadedAt)}
                </div>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={refresh}
                disabled={loading || !projectCwd}
              >
                {loading ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3" />
                )}
                Refresh
              </Button>
            </div>
          </SheetHeader>
          <SheetPanel className="space-y-3">
            {error ? (
              <RunHistoryErrorState
                error={error}
                hasStaleRuns={runs.length > 0}
                loading={loading}
                onRefresh={refresh}
              />
            ) : null}
            {!loading && !error && runs.length === 0 ? (
              <RunHistoryEmptyState loading={loading} onRefresh={refresh} />
            ) : null}
            {loading && runs.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-muted/15 p-5 text-center text-xs text-muted-foreground">
                <Loader2Icon className="mx-auto mb-2 size-4 animate-spin" />
                Loading test runs...
              </div>
            ) : null}
            {runs.length > 0 ? <RunHistoryList runs={runs} /> : null}
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}

export function TestHarnessRunsPanel({
  projectId,
  projectCwd,
}: Pick<TestHarnessRunsControlProps, "projectId" | "projectCwd">) {
  const [runs, setRuns] = useState<ReadonlyArray<TestHarnessRunHistoryItem>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const latestRun = runs[0];

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    setRuns([]);
    setError(null);
    setLastLoadedAt(null);
  }, [projectCwd, projectId]);

  useEffect(() => {
    if (!projectCwd) {
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTestHarnessRuns({
      projectId,
      projectCwd,
      signal: abortController.signal,
    })
      .then((response) => {
        setRuns(response.runs);
        setLastLoadedAt(new Date().toISOString());
      })
      .catch((cause: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [projectCwd, projectId, refreshNonce]);

  useEffect(() => {
    if (!projectCwd) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, RUN_HISTORY_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [projectCwd]);

  const headerMeta = useMemo(() => {
    if (!projectCwd) {
      return "Select a project to inspect visible test evidence.";
    }
    if (loading && runs.length === 0) {
      return "Loading recent evidence...";
    }
    if (latestRun) {
      return `${statusLabel(latestRun.status)} latest - ${formatRunTime(latestRun.completedAt)}`;
    }
    return "Recent visible harness evidence for this project.";
  }, [latestRun, loading, projectCwd, runs.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HistoryIcon className="size-4 text-muted-foreground" />
              <div className="text-sm font-medium text-foreground">Tests</div>
              {latestRun ? <StatusPill status={latestRun.status} /> : null}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{headerMeta}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">
              {formatLastUpdated(lastLoadedAt)}
            </div>
          </div>
          <Button variant="outline" size="xs" onClick={refresh} disabled={loading || !projectCwd}>
            {loading ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            Refresh
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!projectCwd ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 p-5 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
              <HistoryIcon className="size-4" />
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">No project selected</div>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              Test evidence is scoped to a project folder. Open a project thread to inspect harness
              runs.
            </p>
          </div>
        ) : null}

        {error ? (
          <RunHistoryErrorState
            error={error}
            hasStaleRuns={runs.length > 0}
            loading={loading}
            onRefresh={refresh}
          />
        ) : null}

        {projectCwd && !loading && !error && runs.length === 0 ? (
          <RunHistoryEmptyState loading={loading} onRefresh={refresh} />
        ) : null}

        {projectCwd && loading && runs.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-muted/15 p-5 text-center text-xs text-muted-foreground">
            <Loader2Icon className="mx-auto mb-2 size-4 animate-spin" />
            Loading test runs...
          </div>
        ) : null}

        {runs.length > 0 ? <RunHistoryList runs={runs} /> : null}
      </div>
    </div>
  );
}
