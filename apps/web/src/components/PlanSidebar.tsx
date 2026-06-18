import { memo, useState, useCallback } from "react";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Textarea } from "./ui/textarea";
import ChatMarkdown from "./ChatMarkdown";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  LoaderIcon,
  PanelRightCloseIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../session-logic";
import type { LatestProposedPlanState } from "../session-logic";
import { formatTimestamp } from "../timestampFormat";
import {
  proposedPlanTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  downloadPlanAsTextFile,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { readEnvironmentApi } from "~/environmentApi";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success-foreground">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}

type WorkflowLaneStatus = "Running" | "Waiting" | "Done" | "Stopped";

interface WorkflowLane {
  readonly role: string;
  readonly status: WorkflowLaneStatus;
  readonly summary: string;
  readonly brief: string;
  readonly nextNeed: string;
  readonly latestOutput?: string;
}

interface WorkflowRecord {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly laneRole?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly status?: string;
  readonly severity?: string;
}

function laneStatusFromStep(status: string | undefined): WorkflowLaneStatus {
  if (status === "completed") return "Done";
  if (status === "inProgress") return "Running";
  return "Waiting";
}

function findStep(
  activePlan: ActivePlanState | null,
  patterns: ReadonlyArray<RegExp>,
): ActivePlanState["steps"][number] | undefined {
  return activePlan?.steps.find((step) => patterns.some((pattern) => pattern.test(step.step)));
}

function workflowActivityPayload(
  activity: OrchestrationThreadActivity,
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}

function latestWorkflowLaneActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  laneRole: string,
  kind: string,
): OrchestrationThreadActivity | undefined {
  return activities
    .filter((activity) => {
      const payload = workflowActivityPayload(activity);
      return activity.kind === kind && payload?.laneRole === laneRole;
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function latestWorkflowActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  kind: string,
): OrchestrationThreadActivity | undefined {
  return activities
    .filter((activity) => activity.kind === kind)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function workflowRecords(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  kind: string,
): WorkflowRecord[] {
  return activities
    .filter((activity) => activity.kind === kind)
    .map((activity) => {
      const payload = workflowActivityPayload(activity);
      return {
        id: activity.id,
        kind: activity.kind,
        summary: activity.summary,
        createdAt: activity.createdAt,
        ...(typeof payload?.laneRole === "string" ? { laneRole: payload.laneRole } : {}),
        ...(typeof payload?.title === "string" ? { title: payload.title } : {}),
        ...(typeof payload?.detail === "string" ? { detail: payload.detail } : {}),
        ...(typeof payload?.status === "string" ? { status: payload.status } : {}),
        ...(typeof payload?.severity === "string" ? { severity: payload.severity } : {}),
      };
    })
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function payloadStringList(
  payload: Record<string, unknown> | null,
  key: string,
): ReadonlyArray<string> {
  const value = payload?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function enrichWorkflowLane(
  lane: WorkflowLane,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowLane {
  const stopped = latestWorkflowLaneActivity(activities, lane.role, "workflow.lane.stopped");
  if (stopped) {
    return {
      ...lane,
      status: "Stopped",
      latestOutput: stopped.summary,
      nextNeed: "Partial findings are preserved for Lead synthesis.",
    };
  }
  const guidance = latestWorkflowLaneActivity(activities, lane.role, "workflow.lane.guidance");
  if (guidance) {
    const payload = workflowActivityPayload(guidance);
    const guidanceText =
      typeof payload?.guidance === "string" ? payload.guidance : guidance.summary;
    return {
      ...lane,
      latestOutput: guidanceText,
      nextNeed: "Apply the latest user guidance and report any changes.",
    };
  }
  return lane;
}

function buildWorkflowLanes(
  activePlan: ActivePlanState | null,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowLane[] {
  const steps = activePlan?.steps ?? [];
  const allDone = steps.length > 0 && steps.every((step) => step.status === "completed");
  const anyRunning = steps.some((step) => step.status === "inProgress");
  const planner = findStep(activePlan, [/plan/i, /scope/i, /design/i, /research/i]);
  const builder = findStep(activePlan, [/implement/i, /build/i, /engine/i, /core/i, /package/i]);
  const verifier = findStep(activePlan, [/test/i, /verify/i, /check/i, /coverage/i]);
  const documenter = findStep(activePlan, [/document/i, /readme/i, /memory/i, /note/i]);

  const lanes: WorkflowLane[] = [
    {
      role: "Lead",
      status: allDone ? "Done" : anyRunning ? "Running" : "Waiting",
      summary: "Owns synthesis",
      brief: activePlan?.explanation ?? "Interprets the goal and coordinates the workflow lanes.",
      nextNeed: allDone ? "Prepare final summary" : "Keep lanes aligned and report decisions.",
    },
    {
      role: "Planner",
      status: laneStatusFromStep(planner?.status),
      summary: "Defines scope",
      brief: planner?.step ?? "Create the build plan and acceptance criteria.",
      nextNeed:
        planner?.status === "completed" ? "Hand off plan to Builder" : "Finish concrete plan.",
    },
    {
      role: "Builder",
      status: laneStatusFromStep(builder?.status),
      summary: "Implements",
      brief: builder?.step ?? "Implement the main requested change.",
      nextNeed:
        builder?.status === "completed"
          ? "Hand off implementation to Verifier"
          : "Complete build work.",
    },
    {
      role: "Verifier",
      status: laneStatusFromStep(verifier?.status),
      summary: "Tests evidence",
      brief: verifier?.step ?? "Run tests and capture verification evidence.",
      nextNeed:
        verifier?.status === "completed" ? "Report pass/fail evidence" : "Run verification checks.",
    },
    {
      role: "Documenter",
      status: laneStatusFromStep(documenter?.status),
      summary: "Records outcome",
      brief: documenter?.step ?? "Document usage notes and durable project context.",
      nextNeed:
        documenter?.status === "completed" ? "Confirm notes are preserved" : "Write concise notes.",
    },
  ];

  return lanes.map((lane) => enrichWorkflowLane(lane, activities));
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  activities?: ReadonlyArray<OrchestrationThreadActivity>;
  label?: string;
  workflowActive?: boolean;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  mode?: "sheet" | "sidebar" | "embedded";
  onSubmitWorkflowGuidance?: (laneRole: string, guidance: string) => void;
  onStopWorkflowLane?: (laneRole: string) => void;
  onStopWorkflow?: () => void;
  onCustomizeWorkflow?: (input: {
    acceptanceCriteria: ReadonlyArray<string>;
    lanes: ReadonlyArray<string>;
  }) => void;
  onClose: () => void;
}

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  activities = [],
  label = "Plan",
  workflowActive = false,
  environmentId,
  threadRef,
  markdownCwd,
  workspaceRoot,
  timestampFormat,
  mode = "sidebar",
  onSubmitWorkflowGuidance,
  onStopWorkflowLane,
  onStopWorkflow,
  onCustomizeWorkflow,
  onClose,
}: PlanSidebarProps) {
  const [proposedPlanExpanded, setProposedPlanExpanded] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const [expandedLaneRole, setExpandedLaneRole] = useState<string | null>(null);
  const [guidanceLaneRole, setGuidanceLaneRole] = useState<string | null>(null);
  const [guidanceText, setGuidanceText] = useState("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [customCriteriaText, setCustomCriteriaText] = useState("");
  const [customLanesText, setCustomLanesText] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const workflowLanes = workflowActive ? buildWorkflowLanes(activePlan, activities) : [];
  const workflowStartedActivity = workflowActive
    ? latestWorkflowActivity(activities, "workflow.started")
    : undefined;
  const workflowStartedPayload = workflowStartedActivity
    ? workflowActivityPayload(workflowStartedActivity)
    : null;
  const workflowGoal =
    typeof workflowStartedPayload?.goal === "string" ? workflowStartedPayload.goal : null;
  const customizedActivity = workflowActive
    ? latestWorkflowActivity(activities, "workflow.customized")
    : undefined;
  const customizedPayload = customizedActivity ? workflowActivityPayload(customizedActivity) : null;
  const workflowInitialLanes = [
    ...new Set([
      ...payloadStringList(workflowStartedPayload, "initialLanes"),
      ...payloadStringList(customizedPayload, "lanes"),
    ]),
  ];
  const acceptanceCriteria = [
    ...new Set([
      ...payloadStringList(workflowStartedPayload, "acceptanceCriteria"),
      ...payloadStringList(customizedPayload, "acceptanceCriteria"),
    ]),
  ];
  const handoffs = workflowRecords(activities, "workflow.handoff");
  const objections = workflowRecords(activities, "workflow.objection");
  const evidence = workflowRecords(activities, "workflow.evidence");
  const verifierResult = latestWorkflowActivity(activities, "workflow.verifier.result");
  const verifierPayload = verifierResult ? workflowActivityPayload(verifierResult) : null;
  const workflowCompleted = latestWorkflowActivity(activities, "workflow.completed");
  const workflowCompletedPayload = workflowCompleted
    ? workflowActivityPayload(workflowCompleted)
    : null;

  const handleCopyPlan = useCallback(() => {
    if (!planMarkdown) return;
    copyToClipboard(planMarkdown);
  }, [planMarkdown, copyToClipboard]);

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown));
  }, [planMarkdown]);

  const handleSaveToWorkspace = useCallback(() => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !workspaceRoot || !planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then((result) => {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save plan",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      })
      .then(
        () => setIsSavingToWorkspace(false),
        () => setIsSavingToWorkspace(false),
      );
  }, [environmentId, planMarkdown, workspaceRoot]);

  const handleSubmitGuidance = useCallback(() => {
    if (!guidanceLaneRole) return;
    const trimmed = guidanceText.trim();
    if (!trimmed) return;
    onSubmitWorkflowGuidance?.(guidanceLaneRole, trimmed);
    setGuidanceLaneRole(null);
    setGuidanceText("");
  }, [guidanceLaneRole, guidanceText, onSubmitWorkflowGuidance]);

  const handleStopLane = useCallback(
    (laneRole: string) => {
      if (!window.confirm(`Stop this ${laneRole} lane? Preserved findings will remain visible.`)) {
        return;
      }
      onStopWorkflowLane?.(laneRole);
    },
    [onStopWorkflowLane],
  );

  const handleStopWorkflow = useCallback(() => {
    if (!window.confirm("Stop this workflow? Completed and partial work will remain visible.")) {
      return;
    }
    onStopWorkflow?.();
  }, [onStopWorkflow]);

  const handleCustomizeWorkflow = useCallback(() => {
    const criteria = customCriteriaText
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const lanes = customLanesText
      .split(/[\r\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    onCustomizeWorkflow?.({
      acceptanceCriteria: criteria,
      lanes,
    });
    setCustomizeOpen(false);
  }, [customCriteriaText, customLanesText, onCustomizeWorkflow]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[340px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="info"
            size="sm"
            className="rounded-md px-1.5 py-0 font-semibold tracking-wide uppercase"
          >
            {label}
          </Badge>
          {activePlan ? (
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {formatTimestamp(activePlan.createdAt, timestampFormat)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {workflowActive && onStopWorkflow ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={handleStopWorkflow}
              className="text-muted-foreground/60 hover:text-destructive"
            >
              Stop workflow
            </Button>
          ) : null}
          {planMarkdown ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground/50 hover:text-foreground/70"
                    aria-label="Plan actions"
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={handleCopyPlan}>
                  {isCopied ? "Copied!" : "Copy to clipboard"}
                </MenuItem>
                <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
                <MenuItem
                  onClick={handleSaveToWorkspace}
                  disabled={!workspaceRoot || isSavingToWorkspace}
                >
                  Save to workspace
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()} sidebar`}
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 space-y-4">
          {/* Explanation */}
          {activePlan?.explanation ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground/80">
              {activePlan.explanation}
            </p>
          ) : null}

          {workflowActive ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground/90">
                    Workflow started
                  </span>
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="rounded-md px-1.5 py-0 text-[10px]"
                  >
                    Active
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground/75">
                  {workflowGoal ??
                    activePlan?.explanation ??
                    "KamiCode is coordinating the workflow."}
                </p>
                {workflowInitialLanes.length > 0 ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                    Initial lanes: {workflowInitialLanes.join(", ")}
                  </p>
                ) : null}
                {acceptanceCriteria.length > 0 ? (
                  <div className="mt-2 border-t border-primary/10 pt-2">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                      Acceptance criteria
                    </p>
                    <ul className="mt-1 space-y-1 text-[11px] leading-snug text-muted-foreground/65">
                      {acceptanceCriteria.map((criterion) => (
                        <li key={criterion} className="flex gap-1.5">
                          <span className="text-primary/70">-</span>
                          <span>{criterion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {onCustomizeWorkflow ? (
                  <div className="mt-2">
                    {customizeOpen ? (
                      <div className="space-y-2 border-t border-primary/10 pt-2">
                        <Textarea
                          value={customCriteriaText}
                          onChange={(event) => setCustomCriteriaText(event.currentTarget.value)}
                          placeholder="Acceptance criteria, one per line"
                          className="min-h-20 text-xs"
                        />
                        <Textarea
                          value={customLanesText}
                          onChange={(event) => setCustomLanesText(event.currentTarget.value)}
                          placeholder="Lanes, comma-separated"
                          className="min-h-16 text-xs"
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button size="xs" variant="ghost" onClick={() => setCustomizeOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            size="xs"
                            onClick={handleCustomizeWorkflow}
                            disabled={!customCriteriaText.trim() && !customLanesText.trim()}
                          >
                            Save customize
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          setCustomCriteriaText(acceptanceCriteria.join("\n"));
                          setCustomLanesText(workflowInitialLanes.join(", "));
                          setCustomizeOpen(true);
                        }}
                      >
                        Customize
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                  Workflow lanes
                </p>
                <Badge variant="secondary" size="sm" className="rounded-md px-1.5 py-0 text-[10px]">
                  Lead owned
                </Badge>
              </div>
              {workflowLanes.map((lane) => (
                <div
                  key={lane.role}
                  className="rounded-lg border border-border/50 bg-background/45"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 p-2.5 text-left"
                      onClick={() =>
                        setExpandedLaneRole((current) => (current === lane.role ? null : lane.role))
                      }
                      aria-expanded={expandedLaneRole === lane.role}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-foreground/90">
                          {lane.role}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground/50">
                          {lane.summary}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
                        {lane.brief}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                        Next: {lane.nextNeed}
                      </p>
                    </button>
                    <span
                      className={cn(
                        "mt-2.5 mr-2.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        lane.status === "Done" && "bg-emerald-500/10 text-emerald-400",
                        lane.status === "Running" && "bg-blue-500/10 text-blue-400",
                        lane.status === "Waiting" && "bg-muted/40 text-muted-foreground",
                        lane.status === "Stopped" && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {lane.status}
                    </span>
                  </div>
                  {expandedLaneRole === lane.role ? (
                    <div className="border-t border-border/50 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground/70">
                      <p>
                        <span className="font-medium text-foreground/70">Latest output:</span>{" "}
                        {lane.latestOutput ?? lane.brief}
                      </p>
                      <p className="mt-1">
                        <span className="font-medium text-foreground/70">Open need:</span>{" "}
                        {lane.nextNeed}
                      </p>
                    </div>
                  ) : null}
                  {guidanceLaneRole === lane.role ? (
                    <div className="space-y-2 border-t border-border/50 px-2.5 py-2">
                      <Textarea
                        value={guidanceText}
                        onChange={(event) => setGuidanceText(event.currentTarget.value)}
                        placeholder={`Guidance to ${lane.role}`}
                        className="min-h-20 text-xs"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setGuidanceLaneRole(null);
                            setGuidanceText("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="xs"
                          onClick={handleSubmitGuidance}
                          disabled={!guidanceText.trim() || !onSubmitWorkflowGuidance}
                        >
                          Send guidance
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex gap-1.5 px-2.5 pb-2.5">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setGuidanceLaneRole(lane.role);
                        setExpandedLaneRole(lane.role);
                      }}
                      disabled={!onSubmitWorkflowGuidance}
                    >
                      Add guidance
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleStopLane(lane.role)}
                      disabled={!onStopWorkflowLane}
                    >
                      Stop
                    </Button>
                  </div>
                </div>
              ))}
              {handoffs.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-border/50 bg-background/35 p-2.5">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                    Handoffs
                  </p>
                  {handoffs.map((record) => (
                    <div
                      key={record.id}
                      className="text-[11px] leading-snug text-muted-foreground/70"
                    >
                      <span className="font-medium text-foreground/75">
                        {record.laneRole ?? "Workflow"}:
                      </span>{" "}
                      {record.title ?? record.summary}
                      {record.detail ? (
                        <p className="mt-0.5 text-muted-foreground/50">{record.detail}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {verifierResult ? (
                <div className="rounded-lg border border-border/50 bg-background/35 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                      Verifier result
                    </p>
                    <Badge
                      variant="secondary"
                      size="sm"
                      className={cn(
                        "rounded-md px-1.5 py-0 text-[10px]",
                        verifierPayload?.status === "pass" && "text-emerald-400",
                        verifierPayload?.status === "fail" && "text-destructive",
                      )}
                    >
                      {typeof verifierPayload?.status === "string"
                        ? verifierPayload.status
                        : "reviewed"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground/75">
                    {verifierResult.summary}
                  </p>
                  {typeof verifierPayload?.detail === "string" ? (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                      {verifierPayload.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {objections.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                  <p className="text-[10px] font-semibold tracking-widest text-amber-400/80 uppercase">
                    Objections
                  </p>
                  {objections.map((record) => (
                    <div
                      key={record.id}
                      className="text-[11px] leading-snug text-muted-foreground/75"
                    >
                      <span className="font-medium text-foreground/75">
                        {record.severity ?? "concern"}:
                      </span>{" "}
                      {record.title ?? record.summary}
                      {record.detail ? (
                        <p className="mt-0.5 text-muted-foreground/50">{record.detail}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {evidence.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-border/50 bg-background/35 p-2.5">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                    Test evidence
                  </p>
                  {evidence.map((record) => (
                    <div
                      key={record.id}
                      className="text-[11px] leading-snug text-muted-foreground/70"
                    >
                      <span className="font-medium text-foreground/75">
                        {record.status ?? "captured"}:
                      </span>{" "}
                      {record.title ?? record.summary}
                      {record.detail ? (
                        <p className="mt-0.5 text-muted-foreground/50">{record.detail}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {workflowCompleted ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-foreground/90">
                      Workflow complete
                    </span>
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="rounded-md px-1.5 py-0 text-[10px] text-emerald-400"
                    >
                      Done
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground/75">
                    {workflowCompleted.summary}
                  </p>
                  {typeof workflowCompletedPayload?.detail === "string" ? (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                      {workflowCompletedPayload.detail}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Plan Steps */}
          {activePlan && activePlan.steps.length > 0 ? (
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                {workflowActive ? "Task checklist" : "Steps"}
              </p>
              {activePlan.steps.map((step) => (
                <div
                  key={`${step.status}:${step.step}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200",
                    step.status === "inProgress" && "bg-blue-500/5",
                    step.status === "completed" && "bg-emerald-500/5",
                  )}
                >
                  {stepStatusIcon(step.status)}
                  <p
                    className={cn(
                      "text-[13px] leading-snug",
                      step.status === "completed"
                        ? "text-muted-foreground/50 line-through decoration-muted-foreground/20"
                        : step.status === "inProgress"
                          ? "text-foreground/90"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {step.step}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Proposed Plan Markdown */}
          {planMarkdown ? (
            <div className="space-y-2">
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 text-left"
                onClick={() => setProposedPlanExpanded((v) => !v)}
              >
                {proposedPlanExpanded ? (
                  <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                ) : (
                  <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                )}
                <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/60">
                  {planTitle ?? "Full Plan"}
                </span>
              </button>
              {proposedPlanExpanded ? (
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <ChatMarkdown
                    text={displayedPlanMarkdown ?? ""}
                    cwd={markdownCwd}
                    threadRef={threadRef}
                    isStreaming={false}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Empty state */}
          {!activePlan && !planMarkdown ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Plans will appear here when generated.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});

export default PlanSidebar;
export type { PlanSidebarProps };
