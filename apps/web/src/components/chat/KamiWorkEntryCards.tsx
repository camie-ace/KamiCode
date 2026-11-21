import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { m } from "~/i18n/messages";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CircleAlertIcon } from "lucide-react";
import { use } from "react";
import type { EvidenceRunWorkEntry, ProjectTriggerWorkEntry } from "../../session-logic";
import { TimelineRowCtx } from "./timelineRowContext";
import {
  artifactFileName,
  formatEvidenceSummaryForDisplay,
  testHarnessArtifactUrl,
} from "~/testHarnessArtifacts";
import { TestHarnessTraceViewer } from "../TestHarnessTraceViewer";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { CameraIcon, ClockIcon, FileTextIcon, VideoIcon, type LucideIcon } from "lucide-react";
function evidenceStatusClass(status: EvidenceRunWorkEntry["status"]): string {
  switch (status) {
    case "pass":
      return "border-success/35 bg-success/10 text-success dark:text-success";
    case "fail":
    case "error":
      return "border-error/35 bg-error/10 text-error dark:text-error";
    case "blocked":
      return "border-warning/35 bg-warning/10 text-warning dark:text-warning";
  }
}

function EvidenceArtifactLink(props: {
  label: string;
  path: string | undefined;
  icon: LucideIcon;
}) {
  if (!props.path) {
    return null;
  }
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={testHarnessArtifactUrl(props.path)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/65 bg-background/60 px-2 py-1 text-2xs text-muted-foreground/80 transition-colors hover:border-border hover:text-foreground"
          />
        }
      >
        <Icon className="size-3" />
        <span>{props.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{artifactFileName(props.path)}</TooltipPopup>
    </Tooltip>
  );
}

function formatProjectTriggerToolTitle(tool: ProjectTriggerWorkEntry["tool"]): string {
  switch (tool) {
    case "create_trigger":
      return "Trigger saved";
    case "update_trigger":
      return "Trigger updated";
    case "set_trigger_enabled":
      return "Trigger status updated";
    case "delete_trigger":
      return "Trigger deleted";
    case "list_triggers":
      return "Project triggers";
  }
}

function formatProjectTriggerDate(value: string | null | undefined): string {
  if (!value) {
    return "Not scheduled";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatProjectTriggerRuntime(value: string | undefined): string {
  if (value === "remote") {
    return "remote runtime";
  }
  if (value === "local") {
    return "local runtime";
  }
  return value ?? "runtime unset";
}

function ProjectTriggerSummaryCard(props: {
  trigger: NonNullable<ProjectTriggerWorkEntry["trigger"]>;
}) {
  const { trigger } = props;
  const scheduleParts = [
    trigger.schedule.expression ?? "No schedule",
    trigger.schedule.timezone ?? "UTC",
    formatProjectTriggerRuntime(trigger.schedule.runtime),
  ];
  const prompt = trigger.threadTemplate?.prompt?.trim();

  return (
    <div className="rounded-lg border border-kami/30 bg-kami/5 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground/90">{trigger.name}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-3xs font-medium",
                trigger.enabled
                  ? "border-success/35 bg-success/10 text-success dark:text-success"
                  : "border-border/70 bg-background/65 text-muted-foreground",
              )}
            >
              {trigger.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          {trigger.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/75">
              {trigger.description}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md border border-kami/25 bg-background/60 px-2 py-0.5 font-mono text-3xs text-muted-foreground/75">
          {trigger.id}
        </span>
      </div>

      <div className="mt-2 grid gap-1.5 text-2xs leading-4 text-muted-foreground/78 sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground/55">Schedule: </span>
          <span>{scheduleParts.join(" / ")}</span>
        </div>
        <div>
          <span className="text-muted-foreground/55">Next: </span>
          <span>{formatProjectTriggerDate(trigger.nextRunAt)}</span>
        </div>
        <div>
          <span className="text-muted-foreground/55">Last: </span>
          <span>{formatProjectTriggerDate(trigger.lastRunAt)}</span>
        </div>
        {trigger.threadTemplate?.runtimeMode ? (
          <div>
            <span className="text-muted-foreground/55">Autonomy: </span>
            <span>{trigger.threadTemplate.runtimeMode}</span>
          </div>
        ) : null}
      </div>

      {prompt ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap border-t border-kami/15 pt-2 text-xs leading-5 text-foreground/78">
          {prompt}
        </p>
      ) : null}

      {trigger.warnings.length > 0 ? (
        <div className="mt-2 space-y-1">
          {trigger.warnings.map((warning) => (
            <div
              key={`${trigger.id}:warning:${warning}`}
              className="flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning/10 px-2 py-1 text-2xs leading-4 text-warning dark:text-warning"
            >
              <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTriggerToolCard({ result }: { result: ProjectTriggerWorkEntry }) {
  const visibleTriggers = result.triggers?.slice(0, 4) ?? [];
  const hiddenTriggerCount = Math.max(0, (result.triggers?.length ?? 0) - visibleTriggers.length);
  const errorMessage = result.error?.message;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-kami/30 bg-background/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-kami/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-kami/12 text-kami">
            <ClockIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground/90">
              {formatProjectTriggerToolTitle(result.tool)}
            </p>
            <p className="truncate text-3xs text-muted-foreground/58">
              {result.success ? "Trigger tool completed" : "Trigger tool failed"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-3xs font-medium tracking-caption",
            result.success
              ? "border-kami/35 bg-kami/10 text-kami"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {result.success ? "SAVED" : "FAILED"}
        </span>
      </div>

      <div className="space-y-2 px-3 py-3">
        {errorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {result.trigger ? <ProjectTriggerSummaryCard trigger={result.trigger} /> : null}

        {visibleTriggers.length > 0 ? (
          <div className="space-y-2">
            {visibleTriggers.map((trigger) => (
              <ProjectTriggerSummaryCard key={trigger.id} trigger={trigger} />
            ))}
            {hiddenTriggerCount > 0 ? (
              <p className="px-1 text-2xs text-muted-foreground/60">
                +{hiddenTriggerCount} more trigger{hiddenTriggerCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        ) : null}

        {result.tool === "list_triggers" && visibleTriggers.length === 0 && !errorMessage ? (
          <p className="text-xs text-muted-foreground/70">No project triggers returned.</p>
        ) : null}

        {result.tool === "delete_trigger" && !result.trigger && !errorMessage ? (
          <p className="text-xs text-muted-foreground/70">
            {result.deleted ? "Deleted" : "No matching trigger was deleted"}
            {result.triggerId ? `: ${result.triggerId}` : ""}
            {result.deletedAt ? ` at ${formatProjectTriggerDate(result.deletedAt)}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EvidenceRunCard({ evidenceRun }: { evidenceRun: EvidenceRunWorkEntry }) {
  const { onOpenTestsPanel } = use(TimelineRowCtx);
  const visibleScreenshots = evidenceRun.screenshots.slice(-6);
  const hiddenScreenshotCount = Math.max(
    0,
    evidenceRun.screenshots.length - visibleScreenshots.length,
  );
  const summary =
    evidenceRun.outputSummary ??
    (evidenceRun.evidenceSummary
      ? formatEvidenceSummaryForDisplay(evidenceRun.evidenceSummary)
      : undefined) ??
    "No evidence summary was returned.";
  const duration =
    evidenceRun.durationMs !== undefined ? formatDuration(evidenceRun.durationMs, m) : null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border/70 bg-background/55">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/55 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-3xs font-medium tracking-label",
                evidenceStatusClass(evidenceRun.status),
              )}
            >
              {evidenceRun.status.toUpperCase()}
            </span>
            <span className="text-xs font-medium text-foreground/85">Evidence run</span>
            <span className="text-3xs text-muted-foreground/55">
              {evidenceRun.runner}
              {duration ? ` - ${duration}` : ""}
            </span>
          </div>
          {evidenceRun.goal ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/75">{evidenceRun.goal}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {onOpenTestsPanel ? (
            <Button variant="outline" size="xs" onClick={() => onOpenTestsPanel(evidenceRun.runId)}>
              Open Tests
            </Button>
          ) : null}
          <TestHarnessTraceViewer tracePath={evidenceRun.tracePath} compact />
          <EvidenceArtifactLink
            label="Summary"
            path={evidenceRun.markdownPath ?? evidenceRun.summaryPath}
            icon={FileTextIcon}
          />
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="whitespace-pre-wrap wrap-break-word text-xs leading-5 text-foreground/82">
          {summary}
        </p>

        {evidenceRun.finalUrl || evidenceRun.title ? (
          <div className="flex flex-wrap gap-1.5">
            {evidenceRun.title ? (
              <span className="rounded-md border border-border/50 bg-card/55 px-2 py-0.5 text-3xs text-muted-foreground/75">
                Title: {evidenceRun.title}
              </span>
            ) : null}
            {evidenceRun.finalUrl ? (
              <span className="max-w-full truncate rounded-md border border-border/50 bg-card/55 px-2 py-0.5 text-3xs text-muted-foreground/75">
                Final URL: {evidenceRun.finalUrl}
              </span>
            ) : null}
          </div>
        ) : null}

        {visibleScreenshots.length > 0 ? (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-3xs uppercase tracking-caption text-muted-foreground/55">
              <CameraIcon className="size-3" />
              <span>Screenshots</span>
              {hiddenScreenshotCount > 0 ? <span>+{hiddenScreenshotCount} earlier</span> : null}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visibleScreenshots.map((screenshot) => (
                <a
                  key={`${evidenceRun.runId}:screenshot:${screenshot.path}`}
                  href={testHarnessArtifactUrl(screenshot.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-lg border border-border/60 bg-card/40"
                >
                  <img
                    src={testHarnessArtifactUrl(screenshot.path)}
                    alt={screenshot.label}
                    loading="lazy"
                    className="block max-h-56 w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
                  />
                  <div className="border-t border-border/45 px-2 py-1 text-3xs text-muted-foreground/70">
                    {screenshot.label}
                  </div>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {evidenceRun.videos.length > 0 ? (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-3xs uppercase tracking-caption text-muted-foreground/55">
              <VideoIcon className="size-3" />
              <span>Videos</span>
            </div>
            <div className="space-y-2">
              {evidenceRun.videos.map((video) => (
                <div
                  key={`${evidenceRun.runId}:video:${video.path}`}
                  className="overflow-hidden rounded-lg border border-border/60 bg-card/40"
                >
                  <video
                    controls
                    src={testHarnessArtifactUrl(video.path)}
                    className="max-h-72 w-full bg-black"
                  />
                  <div className="border-t border-border/45 px-2 py-1 text-3xs text-muted-foreground/70">
                    {video.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(evidenceRun.consoleErrors.length > 0 || evidenceRun.networkFailures.length > 0) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {evidenceRun.consoleErrors.length > 0 ? (
              <EvidenceIssueList label="Console" items={evidenceRun.consoleErrors} />
            ) : null}
            {evidenceRun.networkFailures.length > 0 ? (
              <EvidenceIssueList label="Network" items={evidenceRun.networkFailures} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceIssueList(props: { label: string; items: ReadonlyArray<string> }) {
  return (
    <div className="rounded-lg border border-border/55 bg-card/35 p-2">
      <div className="mb-1 text-3xs uppercase tracking-caption text-muted-foreground/55">
        {props.label} ({props.items.length})
      </div>
      <ul className="space-y-1 text-2xs leading-4 text-muted-foreground/80">
        {props.items.slice(0, 3).map((item) => (
          <li key={`${props.label}:${item}`} className="line-clamp-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
