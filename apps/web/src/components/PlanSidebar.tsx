import { memo, useCallback, useMemo, useState } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
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
import { projectEnvironment } from "~/state/projects";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";

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

type WorkflowLaneStatus = "Running" | "Waiting" | "Needs you" | "Done" | "Stopped" | "Failed";
type WorkflowLaneControlAction = "pause" | "replace" | "freeze" | "continue-manually";
type WorkflowControlAction = "pause" | "freeze" | "continue-manually";

interface WorkflowLane {
  readonly id: string;
  readonly role: string;
  readonly status: WorkflowLaneStatus;
  readonly summary: string;
  readonly brief: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fastMode?: boolean;
  readonly startsAfter: ReadonlyArray<string>;
  readonly nextNeed: string;
  readonly latestOutput?: string;
  readonly artifacts: ReadonlyArray<string>;
  readonly openQuestions: ReadonlyArray<string>;
  readonly activityLog: ReadonlyArray<string>;
}

interface WorkflowLaneTarget {
  readonly id: string;
  readonly role: string;
}

interface WorkflowSubAgentPlan {
  readonly id: string;
  readonly role: string;
  readonly goal?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fastMode?: boolean;
  readonly startsAfter: ReadonlyArray<string>;
}

interface WorkflowRecord {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly laneId?: string;
  readonly laneRole?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly status?: string;
  readonly severity?: string;
  readonly cardType?: string;
  readonly action?: string;
  readonly result?: string;
  readonly decision?: string;
  readonly guidance?: string;
  readonly memoryText?: string;
  readonly reason?: string;
  readonly requiredFix?: string;
  readonly filesTouched: ReadonlyArray<string>;
  readonly testsRun: ReadonlyArray<string>;
  readonly knownRisks: ReadonlyArray<string>;
  readonly passed: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
  readonly checksRun: ReadonlyArray<string>;
  readonly artifacts: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly alternatives: ReadonlyArray<string>;
  readonly overrides: ReadonlyArray<string>;
}

function workflowActivityPayload(
  activity: OrchestrationThreadActivity,
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}

function workflowActivityLaneId(activity: OrchestrationThreadActivity): string | null {
  const payload = workflowActivityPayload(activity);
  return typeof payload?.laneId === "string" ? payload.laneId : null;
}

function workflowRecordMatchesLane(record: WorkflowRecord, lane: WorkflowLaneTarget): boolean {
  return record.laneId === lane.id;
}

function workflowRecordButtonLabel(record: WorkflowRecord): string {
  return record.title ?? record.summary;
}

function latestWorkflowLaneActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  lane: WorkflowLaneTarget,
  kind: string,
): OrchestrationThreadActivity | undefined {
  return activities
    .filter((activity) => activity.kind === kind && workflowActivityLaneId(activity) === lane.id)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function latestWorkflowLaneActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  lane: WorkflowLaneTarget,
  kinds: ReadonlyArray<string>,
): ReadonlyArray<OrchestrationThreadActivity> {
  return activities
    .filter((activity) => {
      if (!kinds.includes(activity.kind)) return false;
      return workflowActivityLaneId(activity) === lane.id;
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
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
        ...(typeof payload?.laneId === "string" ? { laneId: payload.laneId } : {}),
        ...(typeof payload?.laneRole === "string" ? { laneRole: payload.laneRole } : {}),
        ...(typeof payload?.title === "string" ? { title: payload.title } : {}),
        ...(typeof payload?.detail === "string" ? { detail: payload.detail } : {}),
        ...(typeof payload?.status === "string" ? { status: payload.status } : {}),
        ...(typeof payload?.severity === "string" ? { severity: payload.severity } : {}),
        ...(typeof payload?.cardType === "string" ? { cardType: payload.cardType } : {}),
        ...(typeof payload?.action === "string" ? { action: payload.action } : {}),
        ...(typeof payload?.result === "string" ? { result: payload.result } : {}),
        ...(typeof payload?.decision === "string" ? { decision: payload.decision } : {}),
        ...(typeof payload?.guidance === "string" ? { guidance: payload.guidance } : {}),
        ...(typeof payload?.memoryText === "string" ? { memoryText: payload.memoryText } : {}),
        ...(typeof payload?.reason === "string" ? { reason: payload.reason } : {}),
        ...(typeof payload?.requiredFix === "string" ? { requiredFix: payload.requiredFix } : {}),
        filesTouched: payloadStringList(payload, "filesTouched"),
        testsRun: payloadStringList(payload, "testsRun"),
        knownRisks: payloadStringList(payload, "knownRisks"),
        passed: payloadStringList(payload, "passed"),
        failed: payloadStringList(payload, "failed"),
        checksRun: payloadStringList(payload, "checksRun"),
        artifacts: payloadStringList(payload, "artifacts"),
        concerns: payloadStringList(payload, "concerns"),
        alternatives: payloadStringList(payload, "alternatives"),
        overrides: payloadStringList(payload, "overrides"),
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

function payloadSubAgents(
  payload: Record<string, unknown> | null,
): ReadonlyArray<WorkflowSubAgentPlan> {
  const value = payload?.subAgents;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.role !== "string") return [];
    return [
      {
        id: item.id,
        role: item.role,
        ...(typeof item.goal === "string" ? { goal: item.goal } : {}),
        prompt: typeof item.prompt === "string" ? item.prompt : "Report findings through the Lead.",
        ...(typeof item.model === "string" ? { model: item.model } : {}),
        ...(typeof item.reasoningEffort === "string"
          ? { reasoningEffort: item.reasoningEffort }
          : {}),
        ...(typeof item.fastMode === "boolean" ? { fastMode: item.fastMode } : {}),
        startsAfter: Array.isArray(item.startsAfter)
          ? item.startsAfter.filter((entry): entry is string => typeof entry === "string")
          : [],
      },
    ];
  });
}

function normalizeWorkflowAgentId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isWorkflowLeadRole(value: string): boolean {
  return value.trim().toLowerCase() === "lead";
}

function mergeWorkflowSubAgents(
  plannedSubAgents: ReadonlyArray<WorkflowSubAgentPlan>,
  requestedRoles: ReadonlyArray<string>,
): ReadonlyArray<WorkflowSubAgentPlan> {
  const merged = new Map<string, WorkflowSubAgentPlan>();
  for (const agent of plannedSubAgents) {
    merged.set(agent.id, agent);
  }
  for (const role of requestedRoles.filter((entry) => !isWorkflowLeadRole(entry))) {
    const existing = [...merged.values()].some(
      (agent) => agent.role.toLowerCase() === role.toLowerCase(),
    );
    if (existing) continue;
    const id = normalizeWorkflowAgentId(role) || `sub-agent-${merged.size + 1}`;
    merged.set(id, {
      id,
      role,
      goal: role,
      prompt: role.toLowerCase().includes("research")
        ? "Gather context and report useful findings to the Lead."
        : role.toLowerCase().includes("critic")
          ? "Look for flaws, weak assumptions, and non-blocking concerns."
          : "Handle the assigned workflow responsibility and report through the Lead.",
      startsAfter: [],
    });
  }
  return [...merged.values()];
}

function formatWorkflowLaneRefs(
  laneIds: ReadonlyArray<string>,
  lanes: ReadonlyArray<WorkflowLane>,
): string {
  if (laneIds.length === 0) return "Lead";
  return laneIds
    .map((laneId) => lanes.find((lane) => lane.id === laneId)?.role ?? laneId)
    .join(", ");
}

function modelOptionValue(
  modelSelection: ModelSelection | undefined,
  ids: ReadonlyArray<string>,
): string | boolean | null {
  const option = modelSelection?.options?.find((entry) => ids.includes(entry.id));
  const value = option?.value;
  return typeof value === "string" || typeof value === "boolean" ? value : null;
}

function workflowVerifierStatus(value: unknown): "pass" | "fail" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["pass", "passed", "accept", "accepted", "success", "succeeded"].includes(normalized)) {
    return "pass";
  }
  if (["fail", "failed", "reject", "rejected", "error", "blocked"].includes(normalized)) {
    return "fail";
  }
  return null;
}

function workflowLaneStatusFromActivity(
  activity: OrchestrationThreadActivity | undefined,
): WorkflowLaneStatus | null {
  if (!activity) return null;
  const payload = workflowActivityPayload(activity);
  switch (activity.kind) {
    case "workflow.lane.started":
      return "Running";
    case "workflow.lane.completed":
      return "Done";
    case "workflow.lane.blocked":
      return "Needs you";
    case "workflow.lane.stopped":
      return "Stopped";
    case "workflow.lane.guidance":
      return "Running";
    case "workflow.lane.control": {
      const action = typeof payload?.action === "string" ? payload.action : "";
      if (action === "pause") return "Waiting";
      if (action === "replace") return "Running";
      if (action === "freeze") return "Done";
      if (action === "continue-manually") return "Stopped";
      return "Needs you";
    }
    case "workflow.verifier.result": {
      const status = workflowVerifierStatus(payload?.status);
      if (status === "pass") return "Done";
      if (status === "fail") return "Failed";
      return "Needs you";
    }
    default:
      return null;
  }
}

function workflowLeadStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowLaneStatus {
  const latest = activities
    .filter((activity) =>
      [
        "workflow.started",
        "workflow.completed",
        "workflow.blocked",
        "workflow.stopped",
        "workflow.control",
      ].includes(activity.kind),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latest) return "Waiting";
  if (latest.kind === "workflow.completed") return "Done";
  if (latest.kind === "workflow.blocked") return "Needs you";
  if (latest.kind === "workflow.stopped") return "Stopped";
  if (latest.kind === "workflow.control") {
    const payload = workflowActivityPayload(latest);
    const action = typeof payload?.action === "string" ? payload.action : "";
    if (action === "pause") return "Waiting";
    if (action === "freeze") return "Done";
    if (action === "continue-manually") return "Stopped";
    return "Needs you";
  }
  return "Running";
}

function enrichWorkflowLane(
  lane: WorkflowLane,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowLane {
  const laneLifecycle = latestWorkflowLaneActivities(activities, lane, [
    "workflow.lane.started",
    "workflow.lane.completed",
    "workflow.lane.blocked",
    "workflow.lane.stopped",
    "workflow.lane.control",
    "workflow.lane.guidance",
    "workflow.verifier.result",
  ]);
  const latestLaneLifecycle = laneLifecycle[0];
  const control = latestWorkflowLaneActivity(activities, lane, "workflow.lane.control");
  const guidance = latestWorkflowLaneActivity(activities, lane, "workflow.lane.guidance");
  const handoff = latestWorkflowLaneActivity(activities, lane, "workflow.handoff");
  const routeBack = latestWorkflowLaneActivity(activities, lane, "workflow.route-back");
  const verifierResult = latestWorkflowLaneActivity(activities, lane, "workflow.verifier.result");
  const runtimeStatus = workflowLaneStatusFromActivity(latestLaneLifecycle);
  const output = [handoff, routeBack, verifierResult, guidance, control, latestLaneLifecycle]
    .filter((activity): activity is OrchestrationThreadActivity => Boolean(activity))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const payload = output ? workflowActivityPayload(output) : null;
  const verifierStatus =
    output?.kind === "workflow.verifier.result" ? workflowVerifierStatus(payload?.status) : null;
  const latestOutput =
    typeof payload?.detail === "string"
      ? payload.detail
      : typeof payload?.guidance === "string"
        ? payload.guidance
        : typeof payload?.reason === "string"
          ? payload.reason
          : output?.summary;
  const nextNeed =
    output?.kind === "workflow.route-back"
      ? typeof payload?.requiredFix === "string"
        ? payload.requiredFix
        : "Address the verifier route-back before completion."
      : verifierStatus === "fail"
        ? typeof payload?.requiredFix === "string"
          ? payload.requiredFix
          : "Route the required fix back through the Lead."
        : output?.kind === "workflow.lane.blocked"
          ? typeof payload?.requiredFix === "string"
            ? payload.requiredFix
            : typeof payload?.reason === "string"
              ? payload.reason
              : "Resolve the lane blocker before completion."
          : output?.kind === "workflow.lane.guidance"
            ? "Apply the latest user guidance and report any changes."
            : output?.kind === "workflow.lane.completed"
              ? "Ready for Lead synthesis."
              : output?.kind === "workflow.lane.stopped"
                ? "Partial findings are preserved for Lead synthesis."
                : lane.nextNeed;
  const artifacts =
    output?.kind === "workflow.route-back"
      ? [...lane.artifacts, "Required fix handoff"]
      : verifierStatus === "fail"
        ? [...lane.artifacts, "Verifier rejection"]
        : lane.artifacts;
  const openQuestions =
    output?.kind === "workflow.route-back"
      ? [...lane.openQuestions, "Verifier evidence is required before completion."]
      : verifierStatus === "fail"
        ? [...lane.openQuestions, "Required verifier fix is still open."]
        : lane.openQuestions;
  return output
    ? {
        ...lane,
        ...(runtimeStatus ? { status: runtimeStatus } : {}),
        latestOutput: latestOutput ?? output.summary,
        nextNeed,
        artifacts,
        openQuestions,
        activityLog: [...lane.activityLog, output.summary],
      }
    : runtimeStatus
      ? { ...lane, status: runtimeStatus }
      : lane;
}

function buildWorkflowLanes(
  activePlan: ActivePlanState | null,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  currentModelSelection: ModelSelection | undefined,
): WorkflowLane[] {
  const plannedPayload = workflowActivityPayload(
    latestWorkflowActivity(activities, "workflow.planned") ?? ({} as OrchestrationThreadActivity),
  );
  const startedPayload = workflowActivityPayload(
    latestWorkflowActivity(activities, "workflow.started") ?? ({} as OrchestrationThreadActivity),
  );
  const customizedPayload = workflowActivityPayload(
    latestWorkflowActivity(activities, "workflow.customized") ??
      ({} as OrchestrationThreadActivity),
  );
  const requestedRoles = [
    ...payloadStringList(plannedPayload, "initialLanes"),
    ...payloadStringList(startedPayload, "initialLanes"),
    ...payloadStringList(customizedPayload, "lanes"),
  ];
  const plannedSubAgents = [
    ...payloadSubAgents(plannedPayload),
    ...payloadSubAgents(startedPayload),
    ...payloadSubAgents(customizedPayload),
  ];
  const workflowAgents = mergeWorkflowSubAgents(plannedSubAgents, requestedRoles);
  const currentReasoningEffort = modelOptionValue(currentModelSelection, [
    "reasoningEffort",
    "reasoning",
    "effort",
  ]);
  const currentFastMode = modelOptionValue(currentModelSelection, ["fastMode"]);
  const fallbackModel = currentModelSelection?.model ?? "Use lead default";
  const fallbackReasoning =
    typeof currentReasoningEffort === "string" ? currentReasoningEffort : "Use lead default";
  const fallbackFastMode = typeof currentFastMode === "boolean" ? currentFastMode : false;
  const plannedAgentLanes: WorkflowLane[] = workflowAgents.map((agent) => ({
    id: agent.id,
    role: agent.role,
    status: "Waiting",
    summary: agent.goal ?? "Handles this workflow responsibility",
    brief: agent.goal ?? "Handles this workflow responsibility and reports through the Lead.",
    prompt: agent.prompt,
    model: agent.model ?? fallbackModel,
    reasoningEffort: agent.reasoningEffort ?? fallbackReasoning,
    fastMode: agent.fastMode ?? fallbackFastMode,
    startsAfter: agent.startsAfter,
    nextNeed: "Wait for Lead launch or complete assigned work.",
    artifacts: ["Lane findings", "Handoff notes"],
    openQuestions: ["Awaiting Lead routing."],
    activityLog: [],
  }));

  const leadLane: WorkflowLane = {
    id: "lead",
    role: "Lead",
    status: workflowLeadStatus(activities),
    summary: "Owns synthesis",
    brief: activePlan?.explanation ?? "Interprets the goal and coordinates the workflow lanes.",
    prompt:
      "Plan the workflow, revise it from main-chat guidance, then coordinate launched sub-agents.",
    model: fallbackModel,
    reasoningEffort: fallbackReasoning,
    fastMode: fallbackFastMode,
    startsAfter: [],
    nextNeed: "Keep lanes aligned and report decisions.",
    artifacts: ["Lead synthesis", "Workflow decision log"],
    openQuestions: [],
    activityLog: [],
  };

  return [leadLane, ...plannedAgentLanes].map((lane) => enrichWorkflowLane(lane, activities));
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  activities?: ReadonlyArray<OrchestrationThreadActivity>;
  label?: string;
  workflowActive?: boolean;
  currentModelSelection?: ModelSelection | undefined;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  mode?: "sheet" | "sidebar" | "embedded";
  onSubmitWorkflowGuidance?: (lane: WorkflowLaneTarget, guidance: string) => void;
  onStopWorkflowLane?: (lane: WorkflowLaneTarget) => void;
  onStopWorkflow?: () => void;
  onWorkflowLaneControl?: (lane: WorkflowLaneTarget, action: WorkflowLaneControlAction) => void;
  onWorkflowControl?: (action: WorkflowControlAction) => void;
  onOpenTestsPanel?: () => void;
  onCustomizeWorkflow?: (input: {
    acceptanceCriteria: ReadonlyArray<string>;
    lanes: ReadonlyArray<string>;
    requireVerifierApproval: boolean;
    addRedTeamCritique: boolean;
    requireTestsBeforeFinal: boolean;
    showMemoryAuditNotes: boolean;
    exploreParallelApproaches: boolean;
    stopAfterPlanningForApproval: boolean;
    model: string | null;
    reasoningEffort: string | null;
    fastMode: boolean;
    subAgents: ReadonlyArray<WorkflowSubAgentPlan>;
  }) => void;
  onStartWorkflow?: () => void;
}

const EMPTY_PLAN_SIDEBAR_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  activities = EMPTY_PLAN_SIDEBAR_ACTIVITIES,
  label = "Plan",
  workflowActive = false,
  currentModelSelection,
  environmentId,
  threadRef,
  markdownCwd,
  workspaceRoot,
  timestampFormat,
  mode = "sidebar",
  onSubmitWorkflowGuidance,
  onStopWorkflowLane,
  onWorkflowLaneControl,
  onOpenTestsPanel,
  onStartWorkflow,
}: PlanSidebarProps) {
  const [proposedPlanExpanded, setProposedPlanExpanded] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const [guidanceLaneId, setGuidanceLaneId] = useState<string | null>(null);
  const [guidanceText, setGuidanceText] = useState("");
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "plan" });
  const [selectedWorkflowLaneId, setSelectedWorkflowLaneId] = useState<string | null>(null);
  const [selectedWorkflowRecordId, setSelectedWorkflowRecordId] = useState<string | null>(null);
  const [selectedLaneRecordId, setSelectedLaneRecordId] = useState<string | null>(null);

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const workflowLanes = workflowActive
    ? buildWorkflowLanes(activePlan, activities, currentModelSelection)
    : [];
  const workflowPlannedActivity = workflowActive
    ? latestWorkflowActivity(activities, "workflow.planned")
    : undefined;
  const workflowPlannedPayload = workflowPlannedActivity
    ? workflowActivityPayload(workflowPlannedActivity)
    : null;
  const workflowStartedActivity = workflowActive
    ? latestWorkflowActivity(activities, "workflow.started")
    : undefined;
  const workflowStartedPayload = workflowStartedActivity
    ? workflowActivityPayload(workflowStartedActivity)
    : null;
  const workflowStarted = Boolean(workflowStartedActivity);
  const workflowGoal =
    typeof workflowStartedPayload?.goal === "string"
      ? workflowStartedPayload.goal
      : typeof workflowPlannedPayload?.goal === "string"
        ? workflowPlannedPayload.goal
        : null;
  const workflowPattern =
    typeof workflowStartedPayload?.workflowPattern === "string"
      ? workflowStartedPayload.workflowPattern
      : typeof workflowPlannedPayload?.workflowPattern === "string"
        ? workflowPlannedPayload.workflowPattern
        : null;
  const customizedActivity = workflowActive
    ? latestWorkflowActivity(activities, "workflow.customized")
    : undefined;
  const customizedPayload = customizedActivity ? workflowActivityPayload(customizedActivity) : null;
  const workflowInitialLanes = [
    ...new Set([
      ...payloadStringList(workflowStartedPayload, "initialLanes"),
      ...payloadStringList(workflowPlannedPayload, "initialLanes"),
      ...payloadStringList(customizedPayload, "lanes"),
    ]),
  ];
  const acceptanceCriteria = [
    ...new Set([
      ...payloadStringList(workflowStartedPayload, "acceptanceCriteria"),
      ...payloadStringList(workflowPlannedPayload, "acceptanceCriteria"),
      ...payloadStringList(customizedPayload, "acceptanceCriteria"),
    ]),
  ];
  const handoffs = workflowRecords(activities, "workflow.handoff");
  const routeBacks = workflowRecords(activities, "workflow.route-back");
  const objections = workflowRecords(activities, "workflow.objection");
  const evidence = workflowRecords(activities, "workflow.evidence");
  const verifierResults = workflowRecords(activities, "workflow.verifier.result");
  const synthesis = workflowRecords(activities, "workflow.lead.synthesis");
  const memoryUpdates = workflowRecords(activities, "workflow.memory.update");
  const guidanceRecords = workflowRecords(activities, "workflow.lane.guidance");
  const laneStartedRecords = workflowRecords(activities, "workflow.lane.started");
  const laneCompletedRecords = workflowRecords(activities, "workflow.lane.completed");
  const laneBlockedRecords = workflowRecords(activities, "workflow.lane.blocked");
  const laneStoppedRecords = workflowRecords(activities, "workflow.lane.stopped");
  const laneControls = workflowRecords(activities, "workflow.lane.control");
  const workflowControls = workflowRecords(activities, "workflow.control");
  const laneRuntimeRecords = [
    ...laneStartedRecords,
    ...laneCompletedRecords,
    ...laneBlockedRecords,
    ...laneStoppedRecords,
    ...guidanceRecords,
    ...laneControls,
    ...handoffs,
    ...routeBacks,
    ...evidence,
    ...verifierResults,
    ...memoryUpdates,
  ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const detailRecords = [
    ...guidanceRecords,
    ...handoffs,
    ...routeBacks,
    ...evidence,
    ...verifierResults,
    ...synthesis,
    ...memoryUpdates,
  ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedWorkflowRecord =
    detailRecords.find((record) => record.id === selectedWorkflowRecordId) ?? null;
  const selectedWorkflowLane = useMemo(
    () => workflowLanes.find((lane) => lane.id === selectedWorkflowLaneId) ?? null,
    [selectedWorkflowLaneId, workflowLanes],
  );
  const workflowRecordCountByLaneId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of laneRuntimeRecords) {
      if (!record.laneId) continue;
      counts.set(record.laneId, (counts.get(record.laneId) ?? 0) + 1);
    }
    return counts;
  }, [laneRuntimeRecords]);
  const selectedWorkflowLaneRecords = useMemo(() => {
    if (!selectedWorkflowLane) return [];
    if (selectedWorkflowLane.id === "lead") {
      return detailRecords.filter((record) => !record.laneId);
    }
    return laneRuntimeRecords.filter((record) =>
      workflowRecordMatchesLane(record, selectedWorkflowLane),
    );
  }, [detailRecords, laneRuntimeRecords, selectedWorkflowLane]);
  const selectedLaneWorkflowRecord =
    selectedWorkflowLaneRecords.find((record) => record.id === selectedLaneRecordId) ?? null;
  const leadWorkflowLane = workflowLanes.find((lane) => lane.id === "lead") ?? null;
  const workflowRuntimeLabel = workflowStarted
    ? (leadWorkflowLane?.status ?? "Running")
    : "Awaiting start";
  const subAgentWorkflowLanes = workflowLanes.filter((lane) => lane.id !== "lead");
  const activeWorkflowLaneCount = subAgentWorkflowLanes.length;
  const runningLaneCount = subAgentWorkflowLanes.filter((lane) => lane.status === "Running").length;
  const blockedLaneCount = subAgentWorkflowLanes.filter(
    (lane) => lane.status === "Needs you" || lane.status === "Failed",
  ).length;
  const workflowCompleted = latestWorkflowActivity(activities, "workflow.completed");
  const workflowCompletedPayload = workflowCompleted
    ? workflowActivityPayload(workflowCompleted)
    : null;
  const workflowBlocked = latestWorkflowActivity(activities, "workflow.blocked");
  const workflowBlockedPayload = workflowBlocked ? workflowActivityPayload(workflowBlocked) : null;

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
    if (!workspaceRoot || !planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    setIsSavingToWorkspace(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath: filename,
          contents: normalizePlanMarkdownForExport(planMarkdown),
        },
      });
      setIsSavingToWorkspace(false);
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.value.relativePath,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save plan",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [environmentId, planMarkdown, workspaceRoot, writeProjectFile]);

  const handleSubmitGuidance = useCallback(() => {
    if (!guidanceLaneId) return;
    const trimmed = guidanceText.trim();
    if (!trimmed) return;
    const target = workflowLanes.find((lane) => lane.id === guidanceLaneId);
    if (!target) return;
    onSubmitWorkflowGuidance?.({ id: target.id, role: target.role }, trimmed);
    setGuidanceLaneId(null);
    setGuidanceText("");
  }, [guidanceLaneId, guidanceText, onSubmitWorkflowGuidance, workflowLanes]);

  const handleStopLane = useCallback(
    (lane: WorkflowLaneTarget) => {
      if (!window.confirm(`Stop this ${lane.role} lane? Preserved findings will remain visible.`)) {
        return;
      }
      onStopWorkflowLane?.(lane);
    },
    [onStopWorkflowLane],
  );

  const renderStringList = useCallback(
    (label: string, entries: ReadonlyArray<string>) =>
      entries.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] font-semibold text-foreground/60">{label}</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-muted-foreground/60">
            {entries.map((entry) => (
              <li key={entry} className="flex gap-1.5">
                <span>-</span>
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null,
    [],
  );

  const renderWorkflowRecordDetails = useCallback(
    (record: WorkflowRecord) => (
      <div className="rounded-md border border-border/50 bg-background/60 p-2 text-[11px] leading-snug text-muted-foreground/70">
        <p className="font-medium text-foreground/80">{record.title ?? record.summary}</p>
        <p className="mt-0.5 text-muted-foreground/50">
          {record.kind} | {formatTimestamp(record.createdAt, timestampFormat)}
          {record.laneRole ? ` | ${record.laneRole}` : ""}
        </p>
        {record.detail ? <p className="mt-1">{record.detail}</p> : null}
        {record.guidance ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Guidance:</span> {record.guidance}
          </p>
        ) : null}
        {record.reason ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Reason:</span> {record.reason}
          </p>
        ) : null}
        {record.action ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Action:</span> {record.action}
          </p>
        ) : null}
        {record.result ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Result:</span> {record.result}
          </p>
        ) : null}
        {record.decision ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Decision:</span> {record.decision}
          </p>
        ) : null}
        {record.memoryText ? (
          <p className="mt-1">
            <span className="font-medium text-foreground/70">Memory:</span> {record.memoryText}
          </p>
        ) : null}
        {renderStringList("Files touched", record.filesTouched)}
        {renderStringList("Tests run", record.testsRun)}
        {renderStringList("Checks run", record.checksRun)}
        {renderStringList("Artifacts", record.artifacts)}
        {renderStringList("Passed", record.passed)}
        {renderStringList("Failed", record.failed)}
        {renderStringList("Known risks", record.knownRisks)}
        {renderStringList("Concerns", record.concerns)}
        {renderStringList("Alternatives", record.alternatives)}
        {renderStringList("Overrides", record.overrides)}
        {record.requiredFix ? (
          <p className="mt-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-destructive">
            Required fix: {record.requiredFix}
          </p>
        ) : null}
      </div>
    ),
    [renderStringList, timestampFormat],
  );

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
            <div className="space-y-3">
              <div className="rounded-xl border border-primary/20 bg-gradient-to-b from-primary/8 to-background/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground/90">
                    {workflowStarted ? "Workflow runtime" : "Workflow plan"}
                  </span>
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="rounded-md px-1.5 py-0 text-[10px]"
                  >
                    {workflowRuntimeLabel}
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
                {workflowPattern ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                    Pattern: {workflowPattern}
                  </p>
                ) : null}
                {acceptanceCriteria.length > 0 ? (
                  <div className="mt-3 border-t border-primary/10 pt-2">
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
                {!workflowStarted && onStartWorkflow ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-primary/10 pt-2">
                    <Button size="xs" onClick={onStartWorkflow}>
                      Start workflow
                    </Button>
                  </div>
                ) : null}
                <div className="mt-2 rounded-lg border border-primary/10 bg-background/45 p-2.5">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                    Workflow changes
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/65">
                    Use the main chat to ask the Lead to change agents, prompts, models, reasoning
                    effort, fast mode, or sequencing before launch.
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                    {workflowStarted
                      ? "Lead updates and sub-agent handoffs appear here as runtime events."
                      : "This panel stays read-only; the Lead owns workflow revisions through chat."}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                  Agent cards
                </p>
                <Badge variant="secondary" size="sm" className="rounded-md px-1.5 py-0 text-[10px]">
                  {activeWorkflowLaneCount} sub-agents
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground/60">
                <span className="rounded-full border border-border/50 bg-background/55 px-2 py-0.5">
                  {runningLaneCount} running
                </span>
                <span className="rounded-full border border-border/50 bg-background/55 px-2 py-0.5">
                  {blockedLaneCount} need attention
                </span>
                <span className="rounded-full border border-border/50 bg-background/55 px-2 py-0.5">
                  {detailRecords.length} lead inbox items
                </span>
              </div>
              {workflowLanes.map((lane) => (
                <div
                  key={lane.id}
                  className={cn(
                    "rounded-lg border bg-background/45",
                    selectedWorkflowLaneId === lane.id
                      ? "border-primary/35 bg-primary/6"
                      : "border-border/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 p-2.5 text-left"
                      onClick={() =>
                        setSelectedWorkflowLaneId((current) =>
                          current === lane.id ? null : lane.id,
                        )
                      }
                      aria-expanded={selectedWorkflowLaneId === lane.id}
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
                      {(workflowRecordCountByLaneId.get(lane.id) ?? 0) > 0 ? (
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground/45">
                          {workflowRecordCountByLaneId.get(lane.id)} lane activity items
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground/45">
                        {selectedWorkflowLaneId === lane.id
                          ? lane.id === "lead"
                            ? "Lead panel open"
                            : "Sub-agent panel open"
                          : lane.id === "lead"
                            ? "Open lead panel"
                            : "Open sub-agent panel"}
                      </p>
                    </button>
                    <span
                      className={cn(
                        "mt-2.5 mr-2.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        lane.status === "Done" && "bg-emerald-500/10 text-emerald-400",
                        lane.status === "Running" && "bg-blue-500/10 text-blue-400",
                        lane.status === "Needs you" && "bg-amber-500/10 text-amber-300",
                        lane.status === "Waiting" && "bg-muted/40 text-muted-foreground",
                        lane.status === "Stopped" && "bg-destructive/10 text-destructive",
                        lane.status === "Failed" && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {workflowStarted ? lane.status : "Planned"}
                    </span>
                  </div>
                </div>
              ))}
              {selectedWorkflowLane ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                        {selectedWorkflowLane.id === "lead" ? "Lead panel" : "Sub-agent panel"}
                      </p>
                      <p className="mt-1 text-[13px] font-semibold text-foreground/90">
                        {selectedWorkflowLane.role}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="rounded-md px-1.5 py-0 text-[10px]"
                    >
                      {workflowStarted ? selectedWorkflowLane.status : "Planned"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-muted-foreground/75">
                    {selectedWorkflowLane.brief}
                  </p>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground/70">
                    <span className="font-medium text-foreground/75">Prompt:</span>{" "}
                    {selectedWorkflowLane.prompt ?? selectedWorkflowLane.brief}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    <div className="rounded-md border border-border/40 bg-background/35 px-2 py-1">
                      <p className="text-[10px] text-muted-foreground/45">Model</p>
                      <p className="truncate text-[11px] text-foreground/75">
                        {selectedWorkflowLane.model ?? "Use lead default"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/40 bg-background/35 px-2 py-1">
                      <p className="text-[10px] text-muted-foreground/45">Reasoning</p>
                      <p className="truncate text-[11px] text-foreground/75">
                        {selectedWorkflowLane.reasoningEffort ?? "Use lead default"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/40 bg-background/35 px-2 py-1">
                      <p className="text-[10px] text-muted-foreground/45">Fast mode</p>
                      <p className="text-[11px] text-foreground/75">
                        {selectedWorkflowLane.fastMode ? "On" : "Off"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/40 bg-background/35 px-2 py-1">
                      <p className="text-[10px] text-muted-foreground/45">Starts after</p>
                      <p className="truncate text-[11px] text-foreground/75">
                        {formatWorkflowLaneRefs(selectedWorkflowLane.startsAfter, workflowLanes)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] leading-snug text-muted-foreground/70">
                    <span className="font-medium text-foreground/75">Latest output:</span>{" "}
                    {selectedWorkflowLane.latestOutput ?? selectedWorkflowLane.brief}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
                    <span className="font-medium text-foreground/75">Open need:</span>{" "}
                    {selectedWorkflowLane.nextNeed}
                  </p>
                  {renderStringList("Artifacts", selectedWorkflowLane.artifacts)}
                  {renderStringList("Open questions", selectedWorkflowLane.openQuestions)}
                  {renderStringList("Activity log", selectedWorkflowLane.activityLog)}
                  {selectedWorkflowLaneRecords.length > 0 ? (
                    <div className="mt-3 space-y-1.5 rounded-lg border border-border/50 bg-background/35 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                          {selectedWorkflowLane.id === "lead" ? "Lead context" : "Lane activity"}
                        </p>
                        <Badge
                          variant="secondary"
                          size="sm"
                          className="rounded-md px-1.5 py-0 text-[10px]"
                        >
                          {selectedWorkflowLaneRecords.length}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedWorkflowLaneRecords.map((record) => (
                          <Button
                            key={record.id}
                            size="xs"
                            variant={selectedLaneRecordId === record.id ? "secondary" : "ghost"}
                            onClick={() =>
                              setSelectedLaneRecordId((current) =>
                                current === record.id ? null : record.id,
                              )
                            }
                          >
                            {workflowRecordButtonLabel(record)}
                          </Button>
                        ))}
                      </div>
                      {selectedLaneWorkflowRecord ? (
                        renderWorkflowRecordDetails(selectedLaneWorkflowRecord)
                      ) : (
                        <p className="text-[11px] leading-snug text-muted-foreground/50">
                          Select an activity card to inspect the handoff, evidence, or context.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {workflowStarted && selectedWorkflowLane.id !== "lead" ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => setGuidanceLaneId(selectedWorkflowLane.id)}
                        disabled={!onSubmitWorkflowGuidance}
                      >
                        Add guidance
                      </Button>
                      {onOpenTestsPanel ? (
                        <Button size="xs" variant="ghost" onClick={onOpenTestsPanel}>
                          Shared evidence
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleStopLane(selectedWorkflowLane)}
                        disabled={!onStopWorkflowLane}
                      >
                        Stop
                      </Button>
                      {onWorkflowLaneControl ? (
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`${selectedWorkflowLane.role} advanced controls`}
                              />
                            }
                          >
                            <EllipsisIcon className="size-3.5" />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem
                              onClick={() => onWorkflowLaneControl(selectedWorkflowLane, "pause")}
                            >
                              Pause lane
                            </MenuItem>
                            <MenuItem
                              onClick={() => onWorkflowLaneControl(selectedWorkflowLane, "replace")}
                            >
                              Replace lane
                            </MenuItem>
                            <MenuItem
                              onClick={() => onWorkflowLaneControl(selectedWorkflowLane, "freeze")}
                            >
                              Freeze result
                            </MenuItem>
                            <MenuItem
                              onClick={() =>
                                onWorkflowLaneControl(selectedWorkflowLane, "continue-manually")
                              }
                            >
                              Continue manually
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      ) : null}
                    </div>
                  ) : null}
                  {guidanceLaneId === selectedWorkflowLane.id ? (
                    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                      <Textarea
                        value={guidanceText}
                        onChange={(event) => setGuidanceText(event.currentTarget.value)}
                        placeholder={`Guidance to ${selectedWorkflowLane.role}`}
                        className="min-h-20 text-xs"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setGuidanceLaneId(null);
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
                          Re-trigger lane
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {workflowStarted && detailRecords.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-border/50 bg-background/35 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                      Lead inbox
                    </p>
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="rounded-md px-1.5 py-0 text-[10px]"
                    >
                      {detailRecords.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detailRecords.map((record) => (
                      <Button
                        key={record.id}
                        size="xs"
                        variant={selectedWorkflowRecordId === record.id ? "secondary" : "ghost"}
                        onClick={() =>
                          setSelectedWorkflowRecordId((current) =>
                            current === record.id ? null : record.id,
                          )
                        }
                      >
                        {workflowRecordButtonLabel(record)}
                      </Button>
                    ))}
                  </div>
                  {selectedWorkflowRecord
                    ? renderWorkflowRecordDetails(selectedWorkflowRecord)
                    : null}
                </div>
              ) : null}
              {workflowStarted && objections.length > 0 ? (
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
              {workflowStarted && (laneControls.length > 0 || workflowControls.length > 0) ? (
                <div className="space-y-1.5 rounded-lg border border-border/50 bg-background/35 p-2.5">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                    Control log
                  </p>
                  {[...workflowControls, ...laneControls].map((record) => (
                    <div
                      key={record.id}
                      className="text-[11px] leading-snug text-muted-foreground/70"
                    >
                      <span className="font-medium text-foreground/75">
                        {record.laneRole ?? "Workflow"}:
                      </span>{" "}
                      {record.summary}
                    </div>
                  ))}
                </div>
              ) : null}
              {workflowStarted && workflowBlocked ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-foreground/90">
                      Workflow blocked
                    </span>
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="rounded-md px-1.5 py-0 text-[10px] text-destructive"
                    >
                      Blocked
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground/75">
                    {workflowBlocked.summary}
                  </p>
                  {typeof workflowBlockedPayload?.detail === "string" ? (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground/50">
                      {workflowBlockedPayload.detail}
                    </p>
                  ) : null}
                  {typeof workflowBlockedPayload?.requiredFix === "string" ? (
                    <p className="mt-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                      Required fix: {workflowBlockedPayload.requiredFix}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {workflowStarted && workflowCompleted ? (
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
