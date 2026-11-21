import type { ScheduledMessageSubmission } from "./chat/scheduleMessage";
import { ThreadRunSummary } from "@t3tools/client-runtime/state/models";
import { type Thread } from "../types";
import { type OrchestrationThreadActivity } from "@t3tools/contracts";
import { EnvironmentThread } from "@t3tools/client-runtime/state/models";
import { ProviderDriverKind } from "@t3tools/contracts";
import { type WorkflowLaneRunDetail } from "./PlanSidebar";
import { type ProjectTestEnvironment } from "@t3tools/contracts";
import { type WorkflowRecordKind } from "@t3tools/contracts";
import { buildMessageContext } from "../lib/composerContextRecords";
import type { UsageLimitSourceSnapshots } from "@t3tools/contracts";
import {
  type AssistantCitation,
  type ResponseContextRecord,
  type ChatFileAttachment,
  type EnvironmentId,
  type MessageId,
  type PreviewAnnotationPayload,
  type ScopedThreadRef,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { type ChatMessage } from "../types";
import { type SideChatParentPanel } from "~/lib/sideChatPane";
import { type DraftThreadEnvMode } from "../composerDraftStore";
import { type EnvironmentPresentation } from "../state/environments";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";
import { ThreadRecurringSchedulesPanel } from "./chat/ThreadRecurringSchedulesPanel";
interface WorkflowStartedChildLane {
  readonly activityId: string;
  readonly createdAt: string;
  readonly laneId: string;
  readonly laneRole: string;
  readonly childThreadId: ThreadId;
  readonly childTurnMessageId: string | null;
  readonly childTurnRequestedAt: string | null;
}

type WorkflowModelOptionSelection = NonNullable<ModelSelection["options"]>[number];
const WORKFLOW_USE_LEAD_DEFAULT = "Use lead default";

function existingWorkflowCompletionPresence(
  parentThreadId: ThreadId | null,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): {
  readonly handoffKeys: Set<string>;
  readonly completedKeys: Set<string>;
} {
  const handoffKeys = new Set<string>();
  const completedKeys = new Set<string>();
  if (!parentThreadId) return { handoffKeys, completedKeys };
  for (const activity of activities) {
    if (activity.kind !== "workflow.handoff" && activity.kind !== "workflow.lane.completed") {
      continue;
    }
    const payload = workflowActivityPayload(activity);
    const startedActivityId = workflowPayloadString(payload, "sourceStartedActivityId");
    const childThreadId = workflowPayloadString(payload, "childThreadId");
    const childTurnId = workflowPayloadString(payload, "childTurnId");
    if (!startedActivityId || !childThreadId || !childTurnId) {
      continue;
    }
    const key = workflowCompletionKey({
      parentThreadId,
      startedActivityId,
      childThreadId: ThreadId.make(childThreadId),
      childTurnId: TurnId.make(childTurnId),
    });
    if (activity.kind === "workflow.handoff") {
      handoffKeys.add(key);
    } else {
      completedKeys.add(key);
    }
  }
  return { handoffKeys, completedKeys };
}
function workflowStartedChildLanes(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowStartedChildLane[] {
  return activities.flatMap((activity) => {
    if (activity.kind !== "workflow.lane.started") return [];
    const payload = workflowActivityPayload(activity);
    const laneId = workflowPayloadString(payload, "laneId");
    const childThreadId = workflowPayloadString(payload, "childThreadId");
    if (!laneId || !childThreadId) return [];
    const laneRole = workflowPayloadString(payload, "laneRole") ?? laneId;
    return [
      {
        activityId: activity.id,
        createdAt: activity.createdAt,
        laneId,
        laneRole,
        childThreadId: ThreadId.make(childThreadId),
        childTurnMessageId: workflowPayloadString(payload, "childTurnMessageId"),
        childTurnRequestedAt: workflowPayloadString(payload, "childTurnRequestedAt"),
      },
    ];
  });
}
function workflowStartedRunMatchesLatestTurn(
  started: WorkflowStartedChildLane,
  latestTurn: ThreadRunSummary | null,
): boolean {
  if (!latestTurn) return false;
  if (!started.childTurnRequestedAt) return true;
  return (
    latestTurn.requestedAt !== null &&
    latestTurn.requestedAt.localeCompare(started.childTurnRequestedAt) >= 0
  );
}
import { deriveThreadRuntime } from "@t3tools/client-runtime/state/thread-execution";
function workflowCompletionKey(input: {
  parentThreadId: ThreadId;
  startedActivityId: string;
  childThreadId: ThreadId;
  childTurnId: TurnId;
}): string {
  return `${input.parentThreadId}:${input.startedActivityId}:${input.childThreadId}:${input.childTurnId}`;
}
function workflowChildResultText(text: string | null): { summary: string; detail: string } {
  if (!text) {
    return {
      summary: "Child thread settled without an assistant message",
      detail: "The child thread settled, but no assistant message was available to hand off.",
    };
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return {
    summary: truncate(normalized, 140),
    detail: truncate(text, 4000),
  };
}
import { workflowAssistantResult } from "../workflowProjection";
import { workflowMessages } from "../workflowProjection";
import { truncate } from "@t3tools/shared/String";
function workflowLaneSettingText(lane: WorkflowPlannedSubAgent): string {
  return [
    `model: ${lane.model ?? "inherit current selection"}`,
    `reasoning: ${lane.reasoningEffort ?? "inherit current selection"}`,
    `fastMode: ${
      typeof lane.fastMode === "boolean" ? (lane.fastMode ? "on" : "off") : "inherit current"
    }`,
  ].join("\n");
}
function workflowLaneStartsAfterText(lane: WorkflowPlannedSubAgent): string {
  const startsAfter = lane.startsAfter ?? [];
  return startsAfter.length > 0 ? startsAfter.join(", ") : "(none)";
}
function workflowModelOptionSelections(
  baseOptions: ModelSelection["options"],
): Array<WorkflowModelOptionSelection> {
  return (baseOptions ?? []).map((option) => ({ ...option }));
}
function setWorkflowModelOption(
  options: Array<WorkflowModelOptionSelection>,
  id: string,
  value: string | boolean,
): Array<WorkflowModelOptionSelection> {
  const next = [...options];
  const index = next.findIndex((option) => option.id === id);
  const selection = { id, value };
  if (index === -1) {
    next.push(selection);
  } else {
    next[index] = selection;
  }
  return next;
}
import { createModelSelection } from "@t3tools/shared/model";
function workflowLaneRequestedModel(lane: WorkflowPlannedSubAgent): string | null {
  const model = lane.model?.trim();
  if (!model) return null;
  return model.toLowerCase() === WORKFLOW_USE_LEAD_DEFAULT.toLowerCase() ? null : model;
}
function workflowActivityPayload(
  activity: OrchestrationThreadActivity,
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}
function workflowPayloadSubAgents(
  payload: Record<string, unknown> | null,
): WorkflowPlannedSubAgent[] {
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
        ...(typeof item.prompt === "string" ? { prompt: item.prompt } : {}),
        ...(typeof item.model === "string" ? { model: item.model } : {}),
        ...(typeof item.reasoningEffort === "string"
          ? { reasoningEffort: item.reasoningEffort }
          : {}),
        ...(typeof item.fastMode === "boolean" ? { fastMode: item.fastMode } : {}),
        ...(Array.isArray(item.startsAfter)
          ? {
              startsAfter: item.startsAfter.filter(
                (entry): entry is string => typeof entry === "string",
              ),
            }
          : {}),
      },
    ];
  });
}
function workflowLaneMatchesPayload(
  payload: Record<string, unknown> | null,
  lane: WorkflowLaneTarget,
): boolean {
  return workflowPayloadString(payload, "laneId") === lane.id;
}
function workflowPayloadString(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

import { getProviderModelCapabilities } from "../providerModels";
import { resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import { projectEnvironment } from "../state/projects";

import { workflowActivities } from "../workflowProjection";
import { deriveActivePlanState } from "../workflowPlans";

import { findLatestProposedPlan } from "../workflowPlans";
import { Atom } from "effect/reactivity";
function workflowChildCompletionObservations(input: {
  parentThread: Thread;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreadForId: (childThreadId: ThreadId) => EnvironmentThread | null;
}): WorkflowChildCompletionObservation[] {
  const presence = existingWorkflowCompletionPresence(input.parentThread.id, input.activities);
  return workflowStartedChildLanes(input.activities).flatMap((started) => {
    const childThread = input.childThreadForId(started.childThreadId);
    const latestTurn = childThread ? deriveLatestThreadRun(childThread.projection) : null;
    if (!childThread || !latestTurn || !workflowStartedRunMatchesLatestTurn(started, latestTurn)) {
      return [];
    }
    if (!isLatestRunSettled(latestTurn, deriveThreadRuntime(childThread.projection))) {
      return [];
    }
    const completionKey = workflowCompletionKey({
      parentThreadId: input.parentThread.id,
      startedActivityId: started.activityId,
      childThreadId: started.childThreadId,
      childTurnId: TurnId.make(latestTurn.runId),
    });
    const needsHandoff = !presence.handoffKeys.has(completionKey);
    const needsCompleted = !presence.completedKeys.has(completionKey);
    if (!needsHandoff && !needsCompleted) {
      return [];
    }
    const { summary, detail } = workflowChildResultText(
      workflowAssistantResult(childThread.projection, latestTurn.runId),
    );
    return [
      {
        completionKey,
        needsHandoff,
        needsCompleted,
        parentThreadId: input.parentThread.id,
        startedActivityId: started.activityId,
        laneId: started.laneId,
        laneRole: started.laneRole,
        childThreadId: started.childThreadId,
        childTurnId: TurnId.make(latestTurn.runId),
        childAssistantMessageId: latestTurn.assistantMessageId,
        summary,
        detail,
      },
    ];
  });
}
import { environmentThreadDetails } from "../state/threads";
interface WorkflowChildCompletionObservation {
  readonly completionKey: string;
  readonly needsHandoff: boolean;
  readonly needsCompleted: boolean;
  readonly parentThreadId: ThreadId;
  readonly startedActivityId: string;
  readonly laneId: string;
  readonly laneRole: string;
  readonly childThreadId: ThreadId;
  readonly childTurnId: TurnId;
  readonly childAssistantMessageId: string | null;
  readonly summary: string;
  readonly detail: string;
}
function workflowLaneRunDetails(input: {
  parentThread: Thread;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreadForId: (childThreadId: ThreadId) => EnvironmentThread | null;
}): WorkflowLaneRunDetail[] {
  return workflowStartedChildLanes(input.activities).flatMap((started) => {
    const childThread = input.childThreadForId(started.childThreadId);
    if (!childThread) return [];
    const latestTurn = deriveLatestThreadRun(childThread.projection);
    const settled = latestTurn
      ? isLatestRunSettled(latestTurn, deriveThreadRuntime(childThread.projection))
      : false;
    const failed = latestTurn?.status === "failed";
    const latestAssistantText = latestTurn
      ? workflowAssistantResult(childThread.projection, latestTurn.runId)
      : null;
    const messages = workflowMessages(childThread.projection)
      .filter((message) => message.text.trim().length > 0)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-8)
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text.trim(),
        streaming: message.streaming,
        createdAt: message.createdAt,
      }));
    const activities = workflowActivities(childThread.projection)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map((activity) => ({
        id: activity.id,
        kind: activity.kind,
        summary: activity.summary,
        createdAt: activity.createdAt,
      }));

    return [
      {
        laneId: started.laneId,
        laneRole: started.laneRole,
        runId: started.childThreadId,
        title: childThread.projection.thread.title,
        startedAt: started.createdAt,
        status: failed ? "Failed" : settled ? "Done" : latestTurn ? "Running" : "Waiting",
        latestSummary: latestAssistantText
          ? truncate(latestAssistantText.replace(/\s+/g, " "), 220)
          : null,
        messages,
        activities,
      },
    ];
  });
}

import { collectThreadMediaArtifacts } from "~/mediaArtifacts";
import { useDisplayableMediaArtifacts } from "~/mediaArtifactAssets";

import { TurnId } from "@t3tools/contracts";
import { ThreadWorkflowRecordCommand } from "@t3tools/contracts";
import { CommandId } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
interface WorkflowPlannedSubAgent extends WorkflowLaneTarget {
  readonly goal?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fastMode?: boolean;
  readonly startsAfter?: ReadonlyArray<string>;
}
import { newThreadId } from "~/lib/utils";
function workflowLaneThreadTitle(params: {
  parentTitle: string;
  workflowGoal: string;
  laneRole: string;
}): string {
  return truncate(
    `Workflow: ${params.parentTitle || params.workflowGoal} - ${params.laneRole}`,
    80,
  );
}
function buildWorkflowChildPrompt(params: {
  workflowGoal: string;
  parentThreadId: ThreadId;
  parentThreadTitle: string;
  lane: WorkflowPlannedSubAgent;
  guidance?: string;
}): string {
  const lanePrompt = params.lane.prompt ?? params.lane.goal ?? "Report findings through the Lead.";
  const laneGoal = params.lane.goal ?? lanePrompt;
  return [
    "You are a subordinate workflow agent, not the Lead.",
    "Work only on the lane assigned below. Keep decisions scoped to this lane and avoid taking over final workflow synthesis.",
    "",
    `Parent workflow thread: ${params.parentThreadTitle} (${params.parentThreadId})`,
    `Approved workflow goal: ${params.workflowGoal}`,
    "",
    "Lane identity:",
    `role: ${params.lane.role}`,
    `id: ${params.lane.id}`,
    "",
    "Approved lane goal:",
    laneGoal,
    "",
    "Approved lane prompt:",
    lanePrompt,
    "",
    "Approved lane settings:",
    workflowLaneSettingText(params.lane),
    "",
    `startsAfter: ${workflowLaneStartsAfterText(params.lane)}`,
    "",
    "Subordinate instructions:",
    "- Treat the parent thread as the Lead-owned workflow record.",
    "- Do not launch other workflow lanes, perform final synthesis, or mark verifier outcomes.",
    "- Keep changes and investigation scoped to this lane unless the approved prompt explicitly says otherwise.",
    "- If blocked, report the blocker, evidence, and the smallest Lead action needed.",
    ...(params.guidance ? ["", "New Lead guidance for this rerun:", params.guidance] : []),
    "",
    "Hand results back to the Lead explicitly in your final assistant message. Include what changed, files touched if any, tests/checks run if any, known risks, and any follow-up the Lead must handle.",
  ].join("\n");
}
function workflowLaneModelSelection(
  baseModelSelection: ModelSelection,
  lane: WorkflowPlannedSubAgent,
): ModelSelection {
  let options = workflowModelOptionSelections(baseModelSelection.options);
  const reasoningEffort = lane.reasoningEffort?.trim();
  if (reasoningEffort) {
    options = setWorkflowModelOption(options, "reasoningEffort", reasoningEffort);
  }
  if (typeof lane.fastMode === "boolean") {
    options = setWorkflowModelOption(options, "fastMode", lane.fastMode);
  }
  return createModelSelection(
    baseModelSelection.instanceId,
    workflowLaneRequestedModel(lane) ?? baseModelSelection.model,
    options,
  );
}
interface WorkflowLaneTarget {
  readonly id: string;
  readonly role: string;
}
function latestWorkflowPlanDetails(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  fallbackGoal: string,
): {
  readonly activity: OrchestrationThreadActivity | null;
  readonly payload: Record<string, unknown>;
  readonly goal: string;
  readonly plannedSubAgents: WorkflowPlannedSubAgent[];
} {
  const activity =
    activities
      .filter((entry) => entry.kind === "workflow.customized" || entry.kind === "workflow.planned")
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const payload = activity ? (workflowActivityPayload(activity) ?? {}) : {};
  const goal = typeof payload.goal === "string" ? payload.goal : fallbackGoal;
  return {
    activity,
    payload,
    goal,
    plannedSubAgents: workflowPayloadSubAgents(payload),
  };
}
function latestWorkflowChildThreadId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  lane: WorkflowLaneTarget,
): ThreadId | null {
  const latest = activities
    .filter((activity) => {
      if (activity.kind !== "workflow.lane.started") return false;
      return workflowLaneMatchesPayload(workflowActivityPayload(activity), lane);
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const childThreadId = latest
    ? workflowPayloadString(workflowActivityPayload(latest), "childThreadId")
    : null;
  return childThreadId ? ThreadId.make(childThreadId) : null;
}
function workflowLaneLaunchKey(parentThreadId: ThreadId, laneId: string): string {
  return `${parentThreadId}:${laneId}`;
}
function workflowStartedChildLaneIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<string> {
  return new Set(workflowStartedChildLanes(activities).map((entry) => entry.laneId));
}
function workflowActionLabel(action: string): string {
  switch (action) {
    case "pause":
      return "Pause";
    case "replace":
      return "Replace";
    case "freeze":
      return "Freeze result";
    case "continue-manually":
      return "Continue manually";
    default:
      return action;
  }
}
function workflowActionInstruction(action: string, laneRole?: string): string {
  const target = laneRole ? `${laneRole} lane` : "workflow";
  switch (action) {
    case "pause":
      return `Pause the ${target} at the next safe point. Preserve current state, findings, artifacts, and open questions.`;
    case "replace":
      return `Replace the ${target} with a fresh lane using the same brief plus current workflow context. Preserve the old lane history and explain what carries forward.`;
    case "freeze":
      return `Freeze the ${target} result. Do not keep changing artifacts for this target; allow review, verification, and Lead synthesis only.`;
    case "continue-manually":
      return `Collapse the ${target} back into normal Lead-owned continuation. Summarize preserved work, unfinished items, and the next manual step.`;
    default:
      return `Apply workflow control "${action}" to the ${target} and preserve the audit trail.`;
  }
}

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}
function workflowCompletionKindKey(
  kind: "workflow.handoff" | "workflow.lane.completed",
  key: string,
) {
  return `${kind}:${key}`;
}
function workflowCompletedLaneIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<string> {
  const completed = new Set<string>();
  for (const activity of activities) {
    if (activity.kind !== "workflow.lane.completed") continue;
    const laneId = workflowPayloadString(workflowActivityPayload(activity), "laneId");
    if (laneId) completed.add(laneId);
  }
  return completed;
}
import PlanSidebar from "./PlanSidebar";
import { MediaPanel } from "./chat/MediaPanel";
import { TestHarnessRunsPanel } from "./TestHarnessRunsControl";
import { m } from "../i18n/messages";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useGT, useMessages } from "gt-react";
import { ChildThreadApprovals } from "./chat/ChildThreadApprovals";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { queuedRunEditBlockedReason } from "@t3tools/client-runtime/queued-run-edit";
import { ScrollToEndButton, WorkspaceFileDropOverlay } from "./chat/TimelineOverlays";
import { usePasteToFocusComposer } from "./chat/usePasteToFocusComposer";
import { useFocusComposerOnThreadOpen } from "./chat/useFocusComposerOnThreadOpen";
import { configuredHostedAppUrl } from "../hostedPairing";
import {
  announcedRun,
  isDetailBehindShell,
} from "@t3tools/client-runtime/state/thread-activity-announcement";
import {
  deriveAvailableRevertTurnCounts,
  deriveThreadPendingBackgroundTasks,
  presentThreadShellFromProjection,
} from "./ChatView.logic";
import { usePullRequestDraftThread } from "./chat/usePullRequestDraftThread";
import { usePullRequestLinking } from "../hooks/usePullRequestLinking";
import { useComposerSelection } from "./chat/useComposerSelection";
import { useComposerFocus } from "./chat/useComposerFocus";
import { useProjectCloneBanner } from "./chat/useProjectCloneBanner";
import { useAttachmentPreviewHandoff } from "./chat/useAttachmentPreviewHandoff";
import {
  applyOptimisticUserMessagesAction,
  createOptimisticBlobPreviews,
  emptyOptimisticUserMessages,
  reconcileOptimisticUserMessages,
} from "./chat/optimisticUserMessages";
import { useTimelineRewind } from "./chat/useTimelineRewind";
import { useThreadLifecycle } from "./chat/useThreadLifecycle";
import { useRightPanelActions } from "./chat/useRightPanelActions";
import { type TerminalLaunchContext, useChatTerminalActions } from "./chat/useChatTerminalActions";
import { useComposerSend } from "./chat/useComposerSend";
import { useComposerResume } from "./chat/useComposerResume";
import { ThreadFind, ThreadFindCanvas } from "./chat/ThreadFindProvider";
import { closeThreadFind, openThreadFind, useThreadFindOpen } from "./chat/threadFindStore";
import { THREAD_FIND_BAR_RESERVED_HEIGHT } from "./chat/ThreadFindBar";
import { usageLimitRecoveryBannerItem } from "./chat/UsageLimitRecoveryBanner";
import { isThreadEnvironmentLocked, resolveDraftHeroState } from "./ChatView.logic";
import { useQueuedRunEdit } from "./chat/useQueuedRunEdit";
import { recallCheckoutIsRepo, rememberCheckoutIsRepo } from "./ChatView.logic";
import { useLogicalProjectEnvironments } from "../hooks/useLogicalProjectEnvironments";
import { useStableCallback } from "../hooks/useStableCallback";
import { useProjectScriptEditing } from "./chat/useProjectScriptEditing";
import { RightPanelSurfaceContent } from "./chat/RightPanelSurfaceContent";
import { usePendingThreadRequests } from "./chat/usePendingThreadRequests";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

import { feedbackBannerItem } from "./chat/ComposerFeedback";
import { freshSessionBannerItem } from "./chat/ComposerFreshSession";
import { armFreshSession, disarmFreshSession, useFreshSessionArmed } from "./chat/freshSessionArms";
import { useUsageLimitsPanel } from "./chat/useUsageLimitsPanel";
import { useWorktreeSetup } from "./chat/useWorktreeSetup";
import { useChatShortcuts } from "./chat/useChatShortcuts";
import { ChatBannerLane } from "./chat/ChatBannerLane";
import * as Schema from "effect/Schema";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  isProviderNativeSubagentThread,
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  resolveIdleCompaction,
} from "@t3tools/contracts";
import {
  canResumeThread,
  deriveProviderSubagentStatus,
  deriveProviderExtensionStatuses,
  deriveReportedModelSelection,
  deriveResumableRunId,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadStructureRuntime,
  limitRecoveryOwnsSnooze,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  resolveWorkflowOpening,
  workflowOpeningParentThreadId,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  getUserQueuedThreadRuns,
  threadSteersDuringCompaction,
  threadSupportsProviderHandoff,
} from "@t3tools/client-runtime/state/thread-workflows";
import { compactionBlocksSteering } from "@t3tools/client-runtime/state/composer-dispatch";
import { resolvePendingHandoff } from "@t3tools/client-runtime/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  codexFeedbackMessage,
  deriveWorkspaceMutationId,
  isCompleteTurnItemRow,
  shouldShowLoadEarlierControl,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { formatModelSlugName, resolveSelectableModel } from "@t3tools/shared/model";
import { projectScriptCwd, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { orchestrationV2WorktreePending } from "@t3tools/shared/orchestrationV2ThreadError";
import { resolveThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabelsCopy";
import { useAtomValue } from "@effect/atom-react";
import { use, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { BackgroundThreadContext } from "./chat/backgroundThread";
import { WorkspaceMutationIdContext } from "./chat/ChatMarkdownMedia";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  assistantCitationFromLocation,
  useSideChatCitationReveal,
} from "../lib/assistantCitationNavigation";

import { useStore } from "zustand";
import { shallow } from "zustand/vanilla/shallow";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import { composerRequiresModifier } from "../composer-logic";
import {
  derivePhase,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  findRevertCheckpoint,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { buildThreadRouteParams } from "../threadRoutes";
import { useTheme } from "../hooks/useTheme";
import { copyThreadReference } from "../lib/copyThreadReference";
import { subscribeSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { PopoverCreateHandle } from "./ui/popover";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadPanelOpen,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../previewStateStore";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import {
  ThreadPreviewMiniPlayer,
  useThreadPreviewCanvasSource,
} from "./preview/ThreadPreviewMiniPlayer";
import { createChatCanvasStore, resolveChatCanvasModel } from "./chat/canvasStore";
import { usePreviewSession } from "./preview/usePreviewSession";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";

import {
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import { threadPullRequestPanelTarget } from "./pullRequest/pullRequestDetail.logic";
import { LinkPullRequestDialogHost } from "./pullRequest/LinkPullRequestDialog";
import { GuestPendingMessages } from "./chat/GuestShareControls";
import { useDeviceState } from "~/state/device";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import { ComposerContextPermissions } from "./ComposerContextPermissions";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { isEditableFocused } from "../lib/editableFocus";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { toastManager } from "./ui/toast";
import { projectScriptIdFromCommand } from "~/projectScripts";
import { newMessageId } from "~/lib/utils";
import { isInSideChatPane, resolveThreadOpenRoute } from "~/lib/sideChatPane";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
  shouldShowInstanceBadge,
} from "../providerInstances";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useEnvironmentSettings,
} from "../hooks/useSettings";
import { useNowMinute } from "../hooks/useNowMinute";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { isPreviewFocused } from "../lib/previewFocus";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import { draftModelSelectionApplies, threadHasStarted } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import {
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import { type TerminalContextDraft } from "../lib/terminalContext";
import { collectInlineContextIds } from "../lib/composerContextReferences";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQueryRefresh } from "../state/query";
import { useEnvironmentScope } from "~/state/session";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../state/server";
import { hostEnvironmentIdAtom } from "../state/primaryEnvironment";
import { threadEnvironment } from "../state/threads";
import {
  resolveProviderSkillsForCwd,
  resolveProvidersForCwd,
} from "@t3tools/client-runtime/providerSkills";
import { chatGitStatusAtom, NO_CHAT_GIT_STATUS_ATOM, vcsEnvironment } from "../state/vcs";
import {
  useEnvironment,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "../state/environments";
import {
  resolveThreadDetailRef,
  useEnvironmentSupportsServerBrowser,
  useProject,
  useQuietThreadProjection,
  useThreadUpdatedAt,
  useThreadLastVisitedAt,
  useQuietThreadVisibleTurnItems,
  useThreadStatus,
  useThreadHistory,
  useQuietThreadShell,
  useThreadCheckpointSummaries,
} from "../state/entities";
import { useEnvironmentShellHasSnapshot } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import {
  BranchRestoreConfirmHost,
  DeviceSetupDialogHost,
  openBranchRestoreConfirm,
  PullRequestThreadDialogHost,
  RevertConfirmHost,
} from "./chat/ChatOverlayHosts";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { useCitedHistory } from "./chat/citationProcedure";
import type { MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { ThreadTimeline } from "./chat/ThreadTimeline";
import { NativeChildWorkDialog } from "./chat/NativeChildWorkDialog";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import { resolveScrollToEndClearance } from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { useSideChat } from "./chat/useSideChat";
import { useRemoteOpenState } from "~/remoteOpen";
import { shouldShowOpenInPicker } from "./chat/OpenInPicker.logic";
import { useOpenFavoriteEditorShortcut } from "./chat/OpenInPickerShortcut";
import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
  RightPanelMaximizeControl,
  ThreadPanelHeaderControl,
  WorkspaceTitlebarControls,
} from "./chat/PanelLayoutControls";

import { ThreadDetailsPanel } from "./chat/ThreadDetailsPanel";
import { NoActiveThreadState } from "./NoActiveThreadState";
import {
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusDismissalKey,
  shouldShowProviderStatusBanner,
  useProviderStatusBannerDismissed,
} from "./chat/ProviderStatusBanner";
import {
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./chat/QueuedRunsControl";
import { useThreadLinkedPullRequest } from "./pullRequest/useThreadLinkedPullRequest";
import { useProactivePanels } from "../hooks/useProactivePanels";
import { useIncrementalTimelineEntries } from "../hooks/useIncrementalTimelineEntries";
import { useRightPanelSurfaceClose } from "../hooks/useRightPanelSurfaceClose";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { modelFallbackBannerItem } from "./chat/ComposerUsageLimits";
import { ComposerSurface } from "./chat/ComposerSurface";
import { resolveThreadSyncPhase } from "../threadSync";
import { hasAvailableCompactionProvider } from "./chat/compaction.logic";
import {
  deriveLatestContextWindowSnapshot,
  hasDismissedResumeCompaction,
  latestProviderTurnTokenUsage,
  shouldOfferResumeCompaction,
} from "@t3tools/client-runtime/state/context-window";
import {
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
} from "./chat/draftHeroTransition";
import {
  buildLocalDraftThread,
  deriveCommittedServerUserMessageIds,
  deriveTimelineWorking,
  dismissBranchMismatchForSession,
  shouldRenderPreviewMiniPlayer,
  deriveLockedProvider,
  resolveFileAttachmentUrl,
  resolveComposerProviderSelection,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  shouldRefocusComposerOnWindowFocus,
  hasCompactableConversation,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { observeResize } from "~/lib/observeResize";
import { ThreadVisitWatermark } from "./chat/ThreadVisitWatermark";
import { ChatTerminalDrawers } from "./chat/ChatTerminalDrawers";
import { ChatRightPanel } from "./chat/ChatRightPanel";
import { useDraftEnvironmentRouting } from "./chat/useDraftEnvironmentRouting";
import { branchMismatchBannerItem, extensionStatusBannerItem } from "./chat/ThreadActivityBanners";
import { ThreadNow } from "./chat/ThreadNow";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import { useTimelineFollow } from "./chat/useTimelineFollow";
import {
  type EnvironmentUnavailableState,
  useSystemComposerBanners,
} from "./chat/useSystemComposerBanners";
import { useDraftHeroLayoutTransition } from "./chat/useDraftHeroLayoutTransition";
import { useLocalDispatchState } from "./chat/useLocalDispatchState";
import { draftFanoutSelectionsAtom, draftSendState } from "./chat/chatViewSend";
import {
  isCompactCommandMessage,
  type LocalThreadErrorEntry,
  makeThreadErrorSetter,
} from "./ChatView.logic";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];

const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_TURN_ITEMS: ThreadStructure["turnItems"] = [];
const EMPTY_RUNS: ThreadStructure["runs"] = [];
const EMPTY_AUTO_UPDATE_ENVIRONMENTS: ReadonlyArray<EnvironmentPresentation> = [];
const EMPTY_COMPOSER_BANNER_ITEMS: ReadonlyArray<ComposerBannerStackItem> = [];

const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      /** A side chat in its parent's right panel; the parent keeps the keyboard and workspace UI. */
      embedded?: SideChatParentPanel;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      embedded?: never;
      routeKind: "draft";
      draftId: DraftId;
    };

const DismissedFallbackWindowSchema = Schema.NullOr(Schema.String);

const ignoreComposerFocus = () => {};

const decodeUnknownSyncThreadWorkflowRecordCommand = Schema.decodeUnknownSync(
  ThreadWorkflowRecordCommand,
);

export default function ChatView(props: ChatViewProps) {
  const gt = useGT();
  const messages = useMessages();
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
    embedded: parentPanel,
  } = props;
  const embedded = parentPanel !== undefined;
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed route thread key to a ref that async handlers check before applying results
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const interruptThreadTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const loadEarlierThreadHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const baseComposerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const serverThreadShell = useQuietThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null,
  });
  const serverThreadProjection = useQuietThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  // Only the shell-less fallback needs these; with a shell, the shell carries them.
  const fallbackDetailRef = serverThreadShell === null ? routeThreadDetailRef : null;
  const fallbackUpdatedAt = useThreadUpdatedAt(fallbackDetailRef);
  const fallbackLastVisitedAt = useThreadLastVisitedAt(fallbackDetailRef);
  const serverThread =
    serverThreadShell !== null || serverProjection === null || fallbackUpdatedAt === null
      ? serverThreadShell
      : presentThreadShellFromProjection(environmentId, threadId, serverProjection, {
          updatedAt: fallbackUpdatedAt,
          lastVisitedAt: fallbackLastVisitedAt,
        });
  const promptRef = useRef("");
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const queuedRunEdit = useQueuedRunEdit({
    environmentId,
    routeThreadRef,
    threadDraftTarget: baseComposerDraftTarget,
    activeThreadId: serverThread !== null || draftThread !== null ? threadId : null,
    serverProjection,
    promptRef,
    composerRef,
  });
  const composerDraftTarget = queuedRunEdit.draftTarget;
  const reportedModelSelection = serverProjection
    ? deriveReportedModelSelection(serverProjection)
    : null;
  const threadStatus = useThreadStatus(routeThreadDetailRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverProjection !== null,
    shellExists: serverThread !== null,
    status: threadStatus,
  });
  const threadDetailLoading = threadSyncPhase === "loading";
  // Held back briefly, so a quick sync does not flash a status line at the end of the timeline.
  const delayedThreadSyncPhase = useDelayedStatus(routeThreadKey, threadSyncPhase);
  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = latestProviderTurnTokenUsage(
    serverProjection?.providerTurns ?? [],
    serverProjection,
    activeProviderThread,
  );
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(routeThreadDetailRef);
  const serverThreadHistory = useThreadHistory(routeThreadDetailRef);
  const threadHistoryControls = (() => {
    if (routeThreadDetailRef === null || !shouldShowLoadEarlierControl(serverThreadHistory)) {
      return undefined;
    }
    return {
      hasMoreHistory: serverThreadHistory.hasMoreHistory,
      loading: serverThreadHistory.loading,
      error: serverThreadHistory.error,
      onLoadEarlier: (throughEntryId) => {
        void loadEarlierThreadHistory({
          environmentId: routeThreadDetailRef.environmentId,
          input: {
            threadId: routeThreadDetailRef.threadId,
            ...(throughEntryId === undefined ? {} : { throughEntryId }),
          },
        });
      },
    };
  })() as MessagesTimelineHistoryControls | undefined;
  const committedServerMessageIds = deriveCommittedServerUserMessageIds(serverVisibleTurnItems);
  // Queued messages have no turn item until starting, so cancellation must retire their optimistic rows
  // separately.
  const serverAcknowledgedUserMessageIds = (() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  })();
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  // Selects primitives: an object here is new on every router store update, which
  // re-renders ChatView on unrelated navigation state changes.
  const citationHref = useLocation({ select: (location) => location.href });
  const citationKey = useLocation({
    select: (location) => location.state.assistantCitationActivation ?? location.state.__TSR_key,
  });
  const citationLocation = { href: citationHref, key: citationKey };
  const locationCitation = assistantCitationFromLocation(citationLocation.href);
  const citationActivation = citationLocation.key ?? citationLocation.href;
  const citationRequest = (
    locationCitation &&
    locationCitation.environmentId === environmentId &&
    locationCitation.threadId === threadId
      ? { citation: locationCitation, key: citationActivation }
      : null
  ) as AssistantCitationRequest | null;
  useSideChatCitationReveal(embedded ? null : routeThreadRef, locationCitation, citationActivation);
  const citationHistory = useCitedHistory(citationRequest);
  const { resolvedTheme } = useTheme();
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerModelSelectionExplicit = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.modelSelectionExplicit === true,
  );
  const composerSelectedModelSelection = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft?.activeProvider
      ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null)
      : null;
  });
  const composerHasAttachments = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const referencedThreadContexts = useComposerDraftStore(
    useShallow((store) => {
      const draft = store.getComposerDraft(composerDraftTarget);
      if (!draft?.threadContexts.length) return [];
      // Linked prompts can replace text without pruning stored context records.
      const referenced = new Set(collectInlineContextIds(draft.prompt));
      return draft.threadContexts.filter((record) => referenced.has(record.contextId));
    }),
  );
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const citeAssistantText = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => {
    const inserted = composerRef.current?.citeAssistantText(citation, sourceAnchor) ?? false;
    if (!inserted) {
      toastManager.add({
        type: "warning",
        title: gt("The composer is not ready"),
        description: gt(
          "Try citing the selection after the connection or pending input is resolved.",
        ),
      });
    }
    return inserted;
  };
  const citeAssistantTextStable = useStableCallback(citeAssistantText);
  const replyToResponseStable = useStableCallback((response: ResponseContextRecord) => {
    const accepted = composerRef.current?.replyToResponse(response) ?? false;
    if (!accepted) {
      toastManager.add({
        type: "warning",
        title: gt("The composer is not ready"),
        description: gt("Try replying after the connection or pending input is resolved."),
      });
    }
    return accepted;
  });
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [optimisticBlobPreviews] = useState(createOptimisticBlobPreviews);
  const [heldOptimisticUserMessages, setHeldOptimisticUserMessages] = useState(() =>
    emptyOptimisticUserMessages(threadId),
  );
  // Acknowledged messages leave the timeline in the same render the server's copy enters it.
  const optimisticState = reconcileOptimisticUserMessages(
    heldOptimisticUserMessages,
    threadId,
    serverAcknowledgedUserMessageIds,
  );
  if (optimisticState !== heldOptimisticUserMessages) {
    // Idempotent, and a discarded render only delays revocation to the thread's end.
    optimisticBlobPreviews.handOff(optimisticState);
    setHeldOptimisticUserMessages(optimisticState);
  }
  const optimisticUserMessages = optimisticState.messages;
  const setOptimisticUserMessages = (action: SetStateAction<ChatMessage[]>) =>
    setHeldOptimisticUserMessages((state) =>
      applyOptimisticUserMessagesAction(state, threadId, action),
    );
  // Draft ids survive promotion and expire on navigation, keeping the pending resend scoped correctly.
  const [workLocallyResendDraftId, setWorkLocallyResendDraftId] = useState<DraftId | null>(null);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions =
    feedbackSubmissionsByThreadKey[routeThreadKey] ?? EMPTY_FEEDBACK_SUBMISSIONS;
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const isRevertingCheckpoint = useComposerDraftStore((store) =>
    store.rewindingThreadKeys.has(routeThreadKey),
  );

  const workspaceFileDragRouteKey = `${routeThreadKey}:${draftId ?? ""}`;
  const [workspaceFileDragRoute, setWorkspaceFileDragRoute] = useState(workspaceFileDragRouteKey);
  if (workspaceFileDragRoute !== workspaceFileDragRouteKey) {
    setWorkspaceFileDragRoute(workspaceFileDragRouteKey);
    setIsWorkspaceFileDragActive(false);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window dragend listener that clears the workspace file drag state
  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const prefersPlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const isMobileViewport = useMediaQuery("max-sm");
  // Focusing the composer without a tap raises the on-screen keyboard on touch devices.
  const isCoarsePointer = useMediaQuery({ pointer: "coarse" });
  const [workspaceLayoutElement, setWorkspaceLayoutElement] = useState<HTMLDivElement | null>(null);
  const threadPanelPopoverAnchorRef = useRef<HTMLElement | null>(null);
  const [terminalUiLaunchContext, setTerminalUiLaunchContext] =
    useState<TerminalLaunchContext | null>(null);
  // Overrides chosen before a server thread's first turn; they belong to that thread only.
  const [pendingServerThreadEnvModeEntry, setPendingServerThreadEnvModeEntry] = useState<{
    readonly threadId: ThreadId;
    readonly mode: DraftThreadEnvMode;
  } | null>(null);
  const [pendingServerThreadBranchEntry, setPendingServerThreadBranchEntry] = useState<{
    readonly threadId: ThreadId;
    readonly branch: string | null;
  } | null>(null);
  const [
    pendingServerThreadStartFromOriginByThreadId,
    setPendingServerThreadStartFromOriginByThreadId,
  ] = useState<Record<string, boolean>>({});
  const legendListRef = useRef<LegendListRef | null>(null);
  const conversationArea = workspaceAreaProps("conversation", 1, gt("Conversation"));
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const [composerReservedHeight, setComposerReservedHeight] = useState(0);
  const composerReservedHeightRef = useRef(0);
  const composerExpandedHeightRef = useRef(0);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const fanoutSelectionsAtom = draftFanoutSelectionsAtom(routeThreadKey);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);
  const multipleModelSelections = useAtomValue(fanoutSelectionsAtom);
  const setMultipleModelSelections = (
    selections: SetStateAction<ReadonlyArray<ModelSelection> | null>,
  ) => {
    appAtomRegistry.update(fanoutSelectionsAtom, (current) =>
      typeof selections === "function" ? selections(current) : selections,
    );
  };
  const setMultipleModelSelectionsStable = useStableCallback(setMultipleModelSelections);
  const feedbackUploadsInFlightRef = useRef(new Set<string>());

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = serverThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  const promotedDraftError =
    serverThread && draftId ? localDraftErrorsByDraftId[draftId] : undefined;
  if (promotedDraftError !== undefined && draftId) {
    const remainingDraftErrors = { ...localDraftErrorsByDraftId };
    delete remainingDraftErrors[draftId];
    setLocalDraftErrorsByDraftId(remainingDraftErrors);
    const currentEntry = localServerErrorsByThreadKey[routeThreadKey];
    if (
      currentEntry === undefined ||
      (currentEntry.at <= promotedDraftError.at &&
        currentEntry.message !== promotedDraftError.message)
    ) {
      setLocalServerErrorsByThreadKey({
        ...localServerErrorsByThreadKey,
        [routeThreadKey]: promotedDraftError,
      });
    }
  }
  const nowMinute = useNowMinute();
  const draftDefaultModelSelection = draftThread
    ? resolveProjectSettings(
        settings,
        fallbackDraftProject?.id ?? null,
        fallbackDraftProject ?? undefined,
      ).settings.defaultModelSelection
    : null;
  const draftModelResolution = draftThread
    ? resolveNewThreadModelSelection({
        defaultSelection:
          draftDefaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(
            providersByEnvironment.get(draftThread.environmentId) ?? [],
            settings,
            draftThread.projectId,
          ),
        fallbackSelection: settings.fallbackModelSelection,
        providers: providersByEnvironment.get(draftThread.environmentId) ?? [],
        settings,
        projectId: draftThread.projectId,
        now: Date.parse(`${nowMinute}:00Z`),
      })
    : null;
  const draftFallback = draftModelResolution?.fallback ? draftModelResolution : null;
  const localDraftThread = draftThread
    ? buildLocalDraftThread(
        threadId,
        draftThread,
        (draftFallback ? draftFallback.selection : draftDefaultModelSelection) ??
          NO_PROVIDER_MODEL_SELECTION,
        messages,
      )
    : undefined;
  const isServerThread = serverThread !== null;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const serverLatestRun =
    serverProjection === null ? null : deriveLatestThreadRun(serverProjection);
  const serverActivityRun =
    serverProjection === null ? null : deriveThreadActivityRun(serverProjection);
  const serverRuntime =
    serverProjection === null ? null : deriveThreadStructureRuntime(serverProjection);
  const runlessWorkStartedAt =
    serverProjection === null ? null : deriveRunlessWorkStartedAt(serverProjection);
  const providerSubagentStatus =
    serverProjection === null ? null : deriveProviderSubagentStatus(serverProjection);
  const isProviderSubagent =
    serverThread !== null && isProviderNativeSubagentThread(serverThread.source);
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(serverProjection);
  const activeLatestRun = isServerThread ? serverLatestRun : (activeThread?.latestRun ?? null);
  const activeActivityRun = isServerThread ? serverActivityRun : (activeThread?.latestRun ?? null);
  const activeRuntime = isServerThread ? serverRuntime : (activeThread?.runtime ?? null);
  const hasHeldQueuedRuns =
    isServerThread &&
    serverProjection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) ===
      true;
  const resumableRunId =
    !isServerThread || serverProjection === null
      ? null
      : deriveResumableRunId(serverProjection, serverRuntime);
  const canResume =
    serverProjection !== null &&
    canResumeThread(serverProjection, resumableRunId, hasHeldQueuedRuns);
  const parentSubagentThreadId =
    activeThread?.lineage.relationshipToParent === "subagent"
      ? activeThread.lineage.parentThreadId
      : null;
  const parentSubagentEnvironmentId = activeThread?.environmentId ?? null;
  const parentSubagentThreadRef = (() => {
    if (parentSubagentEnvironmentId === null || parentSubagentThreadId === null) {
      return null;
    }
    return scopeThreadRef(parentSubagentEnvironmentId, parentSubagentThreadId);
  })();
  const parentSubagentThread = useQuietThreadShell(parentSubagentThreadRef);
  // Workflow threads open with a script; their replacement plan lives on the parent's coordinator row.
  const workflowOpeningParentId =
    serverProjection === null
      ? null
      : workflowOpeningParentThreadId({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
        });
  const workflowOpeningParentProjection = useQuietThreadProjection(
    workflowOpeningParentId === null || parentSubagentEnvironmentId === null
      ? null
      : scopeThreadRef(parentSubagentEnvironmentId, workflowOpeningParentId),
  );
  const workflowOpening =
    serverProjection === null || workflowOpeningParentId === null
      ? null
      : resolveWorkflowOpening(
          {
            thread: serverProjection.thread,
            messages: serverProjection.messages,
            parentSubagents: workflowOpeningParentProjection?.projection.subagents ?? null,
          },
          messages,
        );
  // A linked environment's agent may have delegated this thread from there.
  const delegatedFrom = activeThread?.delegatedFrom ?? null;
  const delegatedFromEnvironment = useEnvironment(delegatedFrom?.environmentId ?? null);
  const delegatedFromRef =
    delegatedFrom === null
      ? null
      : scopeThreadRef(delegatedFrom.environmentId, delegatedFrom.threadId);
  // The title it had at delegation, until this client sees the parent itself.
  const delegatedFromThread = useQuietThreadShell(delegatedFromRef);
  const sideChatParentRef =
    activeThread?.lineage.sideChat === true && activeThread.lineage.parentThreadId !== null
      ? scopeThreadRef(activeThread.environmentId, activeThread.lineage.parentThreadId)
      : null;
  const sideChatParent = useQuietThreadShell(sideChatParentRef);
  const parentThreadLink = (() => {
    if (sideChatParentRef !== null) {
      const title = sideChatParent?.title ?? gt("Parent thread");
      // Embedded, the parent is the view around it.
      if (embedded) return { title, sideChat: true };
      return {
        title,
        sideChat: true,
        open: (): void => {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(sideChatParentRef),
          });
        },
      };
    }
    if (parentSubagentThreadRef !== null) {
      return {
        title: parentSubagentThread?.title ?? gt("Parent thread"),
        open: (): void => {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              resolveThreadOpenRoute(parentSubagentThreadRef, parentSubagentThread),
            ),
          });
        },
      };
    }
    if (delegatedFrom === null || delegatedFromRef === null) return null;
    const parentRef = delegatedFromRef;
    return {
      title: delegatedFromThread?.title ?? delegatedFrom.title,
      environmentLabel: delegatedFromEnvironment?.label ?? activeThread?.linkOrigin?.label ?? "",
      // Only an environment this client is connected to can open the parent.
      ...(delegatedFromEnvironment === null
        ? {}
        : {
            open: (): void => {
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(parentRef),
              });
            },
          }),
    };
  })();
  // The header's breadcrumb opens a parent in this environment only.
  const headerParentThreadLink =
    parentSubagentThreadRef === null
      ? null
      : {
          threadId: parentSubagentThreadRef.threadId,
          title: parentSubagentThread?.title ?? gt("Parent thread"),
        };
  const threadError = isServerThread
    ? (localServerError ?? serverRuntime?.lastError ?? null)
    : localDraftError;
  const threadErrorBannerKey = getThreadErrorBannerKey(routeThreadKey, threadError);
  const visibleThreadError = shouldShowThreadErrorBanner(
    routeThreadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(threadErrorBannerKey),
  )
    ? threadError
    : null;
  const [, setThreadErrorBannerDismissTick] = useState(0);
  const threadErrorIsServerRuntimeError =
    localServerError === null && visibleThreadError === serverRuntime?.lastError;
  const defaultRuntimeMode = resolveProjectSettings(settings, activeThread?.projectId ?? null)
    .settings.defaultRuntimeMode;
  const runtimeMode =
    composerRuntimeMode ??
    (isServerThread ? activeThread?.runtimeMode : undefined) ??
    defaultRuntimeMode;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = canWriteSourceControl && isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  // Turn items can lag projection hydration; keep the environment locked through that gap.
  const activeMessageCount = isServerThread
    ? Math.max(committedServerMessageIds.size, serverProjection?.messages.length ?? 0)
    : 0;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessionsRaw = useKnownTerminalSessions({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessions = (() => {
    if (activeThreadId === null || activeThreadKnownSessionsRaw === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  })();
  const activeServerOrderedTerminalIds = activeThreadKnownSessions.map(
    (session) => session.target.terminalId,
  );
  const activeTerminalLabelsById = (() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary, messages),
      );
    }
    return labels;
  })();
  const activeThreadRef = useActiveThreadRef(activeThread);
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser(
    activeThreadRef?.environmentId ?? null,
  );
  const browserAvailable = isPreviewSupportedInRuntime() || activeEnvironmentServerBrowser;
  const activeThreadShell = serverThread;
  const limitRecoveryRun =
    serverRuntime?.status === "failed" && serverRuntime.lastErrorClass === "usage_limit"
      ? (activeThreadShell?.latestRun ?? null)
      : null;
  // The recovery banner offers Wake now for a snooze it set.
  const limitRecoveryHoldsSnooze = limitRecoveryOwnsSnooze({
    runId: limitRecoveryRun?.runId,
    resetAt: serverRuntime?.usageLimitResetAt,
    recovery: activeThreadShell?.limitRecovery,
    snoozedUntil: activeThreadShell?.snoozedUntil,
  });
  const timelineThreadError =
    limitRecoveryRun !== null && visibleThreadError === serverRuntime?.lastError
      ? null
      : visibleThreadError;

  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: activeThreadKey, messageId: null });
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  // LegendList never recomputes anchored end-space geometry, leaving phantom scroll range after content fits.
  const anchorRunSettled = (() => {
    if (timelineAnchorMessageId === null) return false;
    const anchorRun = serverProjection?.runs.find(
      (run) => run.userMessageId === timelineAnchorMessageId,
    );
    if (anchorRun === undefined) return false;
    return (
      anchorRun.status !== "preparing" &&
      anchorRun.status !== "queued" &&
      anchorRun.status !== "starting" &&
      anchorRun.status !== "running" &&
      anchorRun.status !== "waiting"
    );
  })();
  if (anchorRunSettled) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff";
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const shouldUsePlanSidebarSheet = prefersPlanSidebarSheet && rightPanelState.maximized !== true;
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const activePreviewState = useThreadPreviewState(activeThreadRef);
  const activePreviewServerEpoch = activePreviewState.serverEpoch;
  const resolvePreviewRuntimeTabId = activeThreadRef
    ? (tabId: string) => previewRuntimeTabId(activeThreadRef, activePreviewServerEpoch, tabId)
    : undefined;
  const activePreviewMiniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, activeThreadRef),
  );
  const panelTerminalIds = new Set(
    rightPanelState.surfaces.flatMap((surface) =>
      surface.kind === "terminal" ? surface.terminalIds : [],
    ),
  );
  const canReuseTerminal = activeThreadKnownSessionsRaw !== null;
  const previewPanelOpen = activeRightPanelKind === "preview" && browserAvailable;
  const rightPanelOpen = rightPanelState.isOpen;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const rightPanelPresenceValue = {
    activeSurface: activeRightPanelSurface,
    surfaces: rightPanelState.surfaces,
  };
  const rightPanelPresence = usePanelPresence(
    rightPanelOpen && activeThreadRef !== null,
    rightPanelPresenceValue,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const rightPanelPresent = rightPanelPresence.present;
  const rightPanelControlsInPanel =
    shouldUsePlanSidebarSheet && rightPanelPresent && rightPanelOpen;
  const rightPanelControlsAtRoot = rightPanelPresent && !shouldUsePlanSidebarSheet;
  const renderedRightPanelSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  const previewMiniPlayerVisible = shouldRenderPreviewMiniPlayer(
    activePreviewMiniPlayer?.source ?? null,
    renderedRightPanelSurface,
  );
  const canMaximizeRightPanel = rightPanelOpen;
  // An embedded side chat has no panel; a stale maximized flag would hide its own column.
  const rightPanelMaximized =
    !embedded && canMaximizeRightPanel && rightPanelState.maximized === true;
  const inlineRightPanelOwnsTitleBar = rightPanelOpen && !shouldUsePlanSidebarSheet;
  const [threadPanelPopoverHandle] = useState(PopoverCreateHandle);
  const [chatCanvasStore] = useState(createChatCanvasStore);

  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activeThreadEnvironmentId = activeThread?.environmentId;
  const activeThreadProjectId = activeThread?.projectId;
  const activeProjectRef =
    activeThreadEnvironmentId !== undefined && activeThreadProjectId !== undefined
      ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectSettings = resolveProjectSettings(
    settings,
    activeProject?.id ?? null,
    activeProject ?? undefined,
  );
  const activeProjectScripts = activeProject ? resolveProjectScripts(settings, activeProject) : [];
  const { projectCloneBannerItem, projectCloneSendBlockReason } =
    useProjectCloneBanner(activeProjectRef);
  const activeProjectDefaultModelSelection =
    !isServerThread && draftFallback
      ? draftFallback.selection
      : activeProjectSettings.settings.defaultModelSelection;
  const handleNewThreadInActiveProject = () => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  };
  const handleNewThreadInActiveProjectStable = useStableCallback(handleNewThreadInActiveProject);
  const projectGroupingSettings = selectProjectGroupingSettings(settings);
  const activeDraftLogicalProjectKey =
    !isServerThread && activeProject
      ? deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings)
      : undefined;
  const handleOpenDraftProjectSettings = () => {
    if (!activeDraftLogicalProjectKey) return;
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: activeDraftLogicalProjectKey },
    });
  };
  const handleOpenDraftProjectSettingsStable = useStableCallback(handleOpenDraftProjectSettings);
  const activeEnvironmentBootstrapComplete = useEnvironmentShellHasSnapshot(
    activeThread?.environmentId ?? null,
  );
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = (relativePath: string, pending: boolean) => {
    if (!activeProjectKey) return;
    setPendingFileSurfaceIdsByProject((currentByProject) => {
      const current = currentByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
      const surfaceId = `file:${relativePath}`;
      if (current.has(surfaceId) === pending) return currentByProject;
      const next = new Set(current);
      if (pending) next.add(surfaceId);
      else next.delete(surfaceId);
      const nextByProject = new Map(currentByProject);
      if (next.size === 0) nextByProject.delete(activeProjectKey);
      else nextByProject.set(activeProjectKey, next);
      return nextByProject;
    });
  };
  const handleFilePendingChangeStable = useStableCallback(handleFilePendingChange);
  const configuredPreviewUrls = getConfiguredPreviewUrls(activeProjectScripts);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops file surfaces from the right panel store once bootstrap shows the thread has no workspace
  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironment.connection.phase !== "connected";
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = (() => {
    if (!activeEnvironmentUnavailable || !activeEnvironmentUnavailableLabel || !activeEnvironment) {
      return null;
    }

    return {
      environmentId: activeEnvironment.environmentId,
      label: activeEnvironmentUnavailableLabel,
      connection: activeEnvironment.connection,
    };
  })() as EnvironmentUnavailableState | null;
  const activeProjectIsScratch =
    activeProject !== null &&
    isScratchProject(
      activeProject,
      environmentById.get(activeProject.environmentId)?.serverConfig?.scratchWorkspaceRoot ?? null,
    );
  const logicalProjectEnvironments = useLogicalProjectEnvironments(
    activeProject,
    activeProjectIsScratch && draftId !== null,
  );
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
  const canAutoBalanceEnvironments = hasMultipleEnvironments && !activeProjectIsScratch;
  const activeEnvironmentOption =
    logicalProjectEnvironments.find(
      (environment) => environment.environmentId === activeThread?.environmentId,
    ) ?? null;
  const showComposerEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });

  const pullRequestLinking = usePullRequestLinking(environmentId);
  // Best effort: the thread already exists, so a failed link is only logged.
  const linkCheckoutPullRequest = useStableCallback((threadRef: ScopedThreadRef, url: string) => {
    pullRequestLinking.changeLink(threadRef, url, true).catch((error: unknown) => {
      console.warn("Failed to link the checked-out pull request to its thread.", error);
    });
  });
  const { handlePreparedPullRequestThreadStable, openPullRequestDialogStable } =
    usePullRequestDraftThread({
      routeKind,
      draftId,
      settings,
      projectGroupingSettings,
      activeProject,
      activeThreadKey,
      isServerThread,
      canCheckoutPullRequestIntoThread,
    });
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerEnvironmentId = (activeThread ? activeEnvironment : primaryEnvironment)
    ?.environmentId;
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const providerStatuses = resolveProvidersForCwd(
    (providerEnvironmentId === undefined
      ? undefined
      : providersByEnvironment.get(providerEnvironmentId)) ?? EMPTY_PROVIDERS,
    gitCwd,
  );
  const composerModelSelectionApplies = draftModelSelectionApplies(
    { modelSelectionExplicit: composerModelSelectionExplicit },
    threadHasStarted(activeThread),
  );
  const selectedProviderByThreadId = composerModelSelectionApplies ? composerActiveProvider : null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
    providers: providerStatuses,
  });
  const modelPickerLockedProvider = supportsProviderSwitchingViaHandoff ? null : lockedProvider;
  const pullRequestsCapabilityKnown = serverConfig !== null;
  const supportsPullRequests = serverConfig !== null;
  const attachmentEnvironmentConfig = environmentById.get(environmentId)?.serverConfig ?? null;
  const attachmentUploadsCapabilityKnown = attachmentEnvironmentConfig !== null;
  const supportsQuestionAttachments = attachmentEnvironmentConfig !== null;
  const supportsAttachmentUploads = attachmentEnvironmentConfig !== null;
  const advertisedFileAttachmentBytes =
    attachmentEnvironmentConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const maxFileAttachmentBytes =
    advertisedFileAttachmentBytes === null
      ? null
      : clampFileAttachmentUploadBytes(advertisedFileAttachmentBytes);
  const envLocked =
    Boolean(activeThread) &&
    isThreadEnvironmentLocked({
      messageCount: activeMessageCount,
      hasRuntime: activeRuntime !== null,
      activeProviderThreadId: serverThread?.activeProviderThreadId ?? null,
    });
  // onEnvironmentChange only retargets an unsent draft. envLocked alone does not
  // rule out a started thread: one whose machine is offline never loads its
  // messages, so it would otherwise be offered a machine picker that does nothing.
  const canChangeEnvironment =
    hasMultipleEnvironments && !envLocked && draftId !== null && !draftThread?.promotedTo;

  const loadBalancingSettings = useClientSettings((settings) => ({
    loadBalancingEnabled: settings.loadBalancingEnabled,
    loadBalancingWeights: settings.loadBalancingWeights,
  }));
  const automaticEnvironment = Boolean(
    clientSettingsHydrated &&
    draftId &&
    !envLocked &&
    canAutoBalanceEnvironments &&
    loadBalancingSettings.loadBalancingEnabled &&
    draftThread?.environmentSelection !== "manual" &&
    (!composerHasAttachments || Boolean(draftThread?.loadBalancedEnvironmentId)) &&
    (!draftThread?.branch || draftThread.environmentSelection === "auto") &&
    !draftThread?.worktreePath,
  );
  const autoUpdateEnvironments = automaticEnvironment
    ? logicalProjectEnvironments.flatMap(({ environmentId }) => {
        const environment = environmentById.get(environmentId);
        return environment ? [environment] : [];
      })
    : EMPTY_AUTO_UPDATE_ENVIRONMENTS;
  const systemComposerBannerItems = useSystemComposerBanners({
    activeEnvironment,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableState,
    activeThreadEnvironmentId: activeThread?.environmentId ?? null,
    serverConfig,
    hasMultipleRegisteredEnvironments: environments.length > 1,
    automaticEnvironment,
    autoUpdateEnvironments,
  });
  const providerInstanceEntries = providerInstanceEntriesFor(
    providerStatuses,
    settings,
    activeProject?.id ?? null,
  );
  const activeThreadModelInstanceId = activeThread?.modelSelection.instanceId;
  const { selectedProviderEntry, requestedDriverKind } = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      selectedProviderByThreadId,
      activeRuntime?.providerInstanceId,
      activeThreadModelInstanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ],
    lockedProvider,
    lockedInstanceId: activeRuntime?.providerInstanceId ?? activeThreadModelInstanceId,
  });
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const conversationProviderStatus =
    providerStatuses.find((status) => status.instanceId === activeRuntime?.providerInstanceId) ??
    activeProviderStatus;
  const supportsConversationRollback =
    canOperateThread &&
    conversationProviderStatus !== null &&
    conversationProviderStatus.supportsConversationRollback !== false;
  const phase = derivePhase(activeRuntime);
  const serverThreadId = serverThread?.id;
  const serverThreadEnvironmentId = serverThread?.environmentId;
  const setThreadError = makeThreadErrorSetter({
    routeThreadRef,
    routeThreadKey,
    draftId,
    serverThreadRef:
      serverThreadId !== undefined && serverThreadEnvironmentId !== undefined
        ? { threadId: serverThreadId, environmentId: serverThreadEnvironmentId }
        : null,
    setLocalServerErrorsByThreadKey,
    setLocalDraftErrorsByDraftId,
  });
  const {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingIsResponding,
    respondingRequestIds,
    onRespondToApproval: onRespondToApprovalStable,
    onDismissUserInput: onDismissUserInputStable,
    onSelectActivePendingUserInputOption: onSelectActivePendingUserInputOptionStable,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onAdvanceActivePendingUserInputStable,
    onPreviousActivePendingUserInputQuestion: onPreviousActivePendingUserInputQuestionStable,
  } = usePendingThreadRequests({
    environmentId,
    activeThreadId,
    serverProjection,
    supportsQuestionAttachments,
    composerDraftTarget,
    setComposerDraftPrompt,
    promptRef,
    composerRef,
    setThreadError,
  });
  const [heldApprovalRequestIds, setHeldApprovalRequestIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onHeldRequestIdsChange = useStableCallback((requestIds: ReadonlySet<string>) => {
    setHeldApprovalRequestIds((current) => (shallow(current, requestIds) ? current : requestIds));
  });
  // Answering an approval or question on any client resumes quota spending, so include it in the key.
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestRun?.runId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  const {
    banner: usageLimitsBanner,
    offered: usageLimitsOffered,
    open: openUsageLimits,
    clearFor: clearUsageLimitsFor,
  } = useUsageLimitsPanel({
    environmentId,
    threadKey: routeThreadKey,
    panelKey: usageLimitsKey,
    providerInstanceId: activeProviderInstanceId,
    providerDriver: activeProviderStatus?.driver ?? null,
    providers: providerStatuses,
    sources: serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
  });
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree: isLocallyPreparingWorktree,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    environmentId,
    activeThread,
    activeLatestRun,
    latestUserMessageId:
      serverProjection?.messages.findLast((message) => message.role === "user")?.id ?? null,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const latestServerUserItem = serverVisibleTurnItems.findLast(
    (row) => row.item.type === "user_message",
  )?.item;
  const compactRequestIsActive =
    (isSendBusy &&
      optimisticCompactionMessage !== undefined &&
      isCompactCommandMessage(optimisticCompactionMessage)) ||
    (latestServerUserItem?.type === "user_message" &&
      latestServerUserItem.text.trim().toLowerCase() === "/compact" &&
      latestServerUserItem.attachments.length === 0 &&
      latestServerUserItem.runId === activeActivityRun?.runId &&
      !isLatestRunSettled(activeActivityRun, activeRuntime));
  const compactionSettled = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId === activeActivityRun?.runId &&
      (item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted" ||
        item.status === "cancelled"),
  );
  const compactionRunning = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId !== null &&
      item.runId === activeRuntime?.activeRunId &&
      item.status === "running",
  );
  const compactCommandIsActive = compactRequestIsActive && !compactionSettled;
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    (compactionRunning || compactCommandIsActive);
  const compactionBlocksSteer = compactionBlocksSteering({
    compactCommandIsActive,
    compactionRunning,
    steersDuringCompaction: threadSteersDuringCompaction(serverProjection),
    run: serverProjection?.runs.find((run) => run.id === activeRuntime?.activeRunId),
    messages: serverProjection?.messages,
  });
  const isWorking = deriveTimelineWorking({
    phase,
    isSendBusy,
    isCompacting,
    runlessWorkStartedAt,
  });
  const activeContextWindow = deriveLatestContextWindowSnapshot(
    serverVisibleTurnItems ?? [],
    activeThreadLiveTokenUsage,
    activeProviderThread,
  );
  const pendingBackgroundTasks = deriveThreadPendingBackgroundTasks(serverProjection);
  const activeWorkStartedAt =
    deriveActiveWorkStartedAt(activeActivityRun, activeRuntime, localDispatchStartedAt) ??
    runlessWorkStartedAt;
  const activeRunPreparing = activeActivityRun?.status === "preparing";
  const sendQueuesBehindSetup =
    isServerThread && (activeRunPreparing || activeActivityRun?.status === "starting");
  const [setupQueueSendThreadKey, setSetupQueueSendThreadKey] = useState<string | null>(null);
  const downloadFileAttachment = async (attachment: ChatFileAttachment) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      toastManager.add({ type: "error", title: gt("The environment is not connected.") });
      return;
    }

    try {
      const url = await resolveFileAttachmentUrl({
        attachment,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Could not download {name}", { name: attachment.name }),
        description: thrownErrorMessage(error, m) ?? gt("The attachment is unavailable."),
      });
    }
  };
  const downloadFileAttachmentStable = useStableCallback(downloadFileAttachment);
  const openFileAttachment = (attachment: ChatFileAttachment) => {
    if (activeThreadRef) {
      useRightPanelStore.getState().openAttachment(activeThreadRef, attachment);
      return;
    }
  };
  const openFileAttachmentStable = useStableCallback(openFileAttachment);
  const { timelineAttachmentUrlById } = useAttachmentPreviewHandoff({
    environmentId,
    threadId,
    serverVisibleTurnItems,
    handoff: optimisticState.handoff,
    blobPreviews: optimisticBlobPreviews,
    setOptimisticUserMessages: setHeldOptimisticUserMessages,
  });
  const anchoredTimelineMessages = feedbackSubmissions.flatMap((submission) =>
    submission.status === "interrupted"
      ? []
      : [
          { ...codexFeedbackMessage(submission, "user", messages), runId: null },
          { ...codexFeedbackMessage(submission, "assistant", messages), runId: null },
        ],
  );
  const timelineEntriesInput = {
    optimisticMessages: optimisticUserMessages,
    anchoredMessages: anchoredTimelineMessages,
    attachmentUrlById: timelineAttachmentUrlById,
    ...(serverProjection === null
      ? {}
      : {
          attempts: serverProjection.attempts,
          nodes: serverProjection.nodes,
          plans: serverProjection.plans,
        }),
  };
  // The structure has no assistant or reasoning text, so those rows stay out of
  // ChatView's own entries (anchoring, rewind, prompt history); ThreadTimeline
  // renders every row from the live turn items.
  const serverTimelineRows = serverVisibleTurnItems.filter(isCompleteTurnItemRow);
  const hasStreamedTimelineRows =
    isServerThread && serverTimelineRows.length !== serverVisibleTurnItems.length;
  const serverTimelineEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...timelineEntriesInput,
    visibleTurnItems: serverTimelineRows,
  });
  const draftTimelineEntries = optimisticUserMessages.map(
    (message) =>
      ({
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      }) as const,
  );
  const timelineEntries = isServerThread ? serverTimelineEntries : draftTimelineEntries;
  const timelineMessages = timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const timelineEmpty = timelineEntries.length === 0 && !hasStreamedTimelineRows;
  const displayedTimelineKey = activeThreadKey ?? routeThreadKey;
  const displayedThreadRef = parseScopedThreadKey(displayedTimelineKey);
  const {
    worktreeSetup,
    isPreparingWorktree,
    blocksSend: worktreeSetupBlocksSend,
    retryableRunIds: retryableWorkspacePreparationRunIds,
    begin: beginWorktreeSetup,
    cancel: cancelWorktreeSetup,
    retryPreparation: onRetryWorkspacePreparationStable,
    openSetupTerminal: onOpenWorktreeSetupTerminal,
  } = useWorktreeSetup({
    routeThreadRef,
    ownerKey: draftId ?? routeThreadKey,
    activeThread,
    threadRef: activeThreadRef,
    serverProjection,
    activityRun: activeActivityRun,
    localPreparing: isLocallyPreparingWorktree,
    sendQueuesBehindSetup,
    // Include optimistic sends to retire the row before the server echo.
    followUpSent: timelineMessages.filter((message) => message.role === "user").length > 1,
  });
  const onCancelWorktreeSetupStable = useStableCallback(() => void cancelWorktreeSetup());
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: !timelineEmpty,
    isWorking,
    draftHeroDockRequested,
    backgroundSubmissionPending,
    hasWorktreeSetupCard: worktreeSetup !== null,
  });
  const {
    transitionGroupRef: draftHeroTransitionGroupRef,
    composerAnchorRef: draftHeroComposerAnchorRef,
    captureComposerRect: captureDraftHeroComposerRect,
  } = useDraftHeroLayoutTransition(
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const turnDiffSummaries = useThreadCheckpointSummaries(routeThreadDetailRef);
  const availableRevertTurnCounts = deriveAvailableRevertTurnCounts(serverProjection);
  // A paged history window cannot identify the first loaded run as the thread start.
  const threadStartCheckpointAvailable =
    !serverThreadHistory.hasMoreHistory &&
    findRevertCheckpoint(serverProjection?.checkpoints ?? [], 0) !== undefined;

  const workspaceMutationId = deriveWorkspaceMutationId(
    serverVisibleTurnItems,
    turnDiffSummaries.at(-1)?.completedAt ?? null,
  );

  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusAtom =
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        });
  const gitStatusQuery = {
    data: useAtomValue(gitStatusAtom ? chatGitStatusAtom(gitStatusAtom) : NO_CHAT_GIT_STATUS_ATOM),
    refresh: useEnvironmentQueryRefresh(gitStatusAtom).refresh,
  };
  useWorkspaceMutationRefresh({
    enabled: gitStatusCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatusQuery.refresh,
    resourceKey: `git-status:${activeThreadKey ?? ""}:${gitStatusCwd ?? ""}`,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const backgroundThread = use(BackgroundThreadContext);
  const scriptKeybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const openInEnvironmentId = activeThread?.environmentId ?? environmentId;
  const availableEditors =
    useAtomValue(serverEnvironment.configValueAtom(openInEnvironmentId))?.availableEditors ?? [];
  const hostEnvironmentId = useAtomValue(hostEnvironmentIdAtom);
  const remoteOpenState = useRemoteOpenState(openInEnvironmentId);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: activeProject?.title,
    activeThreadEnvironmentId: openInEnvironmentId,
    primaryEnvironmentId: primaryEnvironment?.environmentId ?? null,
    hostEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  useOpenFavoriteEditorShortcut({
    enabled: showOpenInPicker && !backgroundThread,
    environmentId: openInEnvironmentId,
    keybindings,
    availableEditors,
    openInCwd: gitCwd,
  });
  const manualCompactionProviderAvailable = hasAvailableCompactionProvider({
    providers: providerInstanceEntries,
    driverKind: selectedProvider,
    instanceId: activeProviderInstanceId,
    lockedInstanceId: lockedProvider
      ? (activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId ?? null)
      : null,
  });
  const [resumeCompactionPermanentlyDismissed, setResumeCompactionPermanentlyDismissed] =
    useLocalStorage(
      `t3code:resume-compaction-dismissed:${environmentId}:${activeProviderInstanceId ?? "claudeAgent"}`,
      false,
      Schema.Boolean,
    );
  const nativeResumeCompactionDismissed = hasDismissedResumeCompaction(
    (serverProjection?.runtimeRequests ?? [])
      .filter((request) => request.kind === "user_input" && request.status === "resolved")
      .map((request) => ({
        kind: "user-input.resolved",
        payload: { answers: request.answers },
      })),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the server-reported resume compaction dismissal to localStorage
  useEffect(() => {
    if (nativeResumeCompactionDismissed && !resumeCompactionPermanentlyDismissed) {
      setResumeCompactionPermanentlyDismissed(true);
    }
  }, [
    nativeResumeCompactionDismissed,
    resumeCompactionPermanentlyDismissed,
    setResumeCompactionPermanentlyDismissed,
  ]);
  const [dismissedFallbackWindow, setDismissedFallbackWindow] = useLocalStorage(
    `t3code:fallback-notice-dismissed:${environmentId}`,
    null,
    DismissedFallbackWindowSchema,
  );
  const providerStatusDismissalKey = getProviderStatusDismissalKey(
    providerEnvironmentId,
    activeProviderStatus,
  );
  const providerStatusDismissed = useProviderStatusBannerDismissed(providerStatusDismissalKey);
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    providerStatusDismissed,
  )
    ? activeProviderStatus
    : null;
  const hasTimelineTopBanner = Boolean(timelineThreadError) || visibleProviderStatus !== null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalUiLaunchContext?.threadId === activeThreadId ? terminalUiLaunchContext : null;
  const liveIsGitRepo = gitStatusQuery.data?.isRepo;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records live git repo status in the session cache read while the status query is unavailable
  useEffect(() => {
    if (gitStatusCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(environmentId, gitStatusCwd, liveIsGitRepo);
    }
  }, [environmentId, gitStatusCwd, liveIsGitRepo]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  // Provider-native subagents cannot take messages; approvals and questions go to the top-level parent.
  const showProviderSubagentBar = isProviderSubagent;
  const composerMounted = !showProviderSubagentBar;
  const providerSubagentModels = selectedProviderEntry?.models ?? EMPTY_PROVIDER_MODELS;
  // Providers can report dated model ids or aliases.
  const providerSubagentModelSlug = selectedProviderEntry
    ? resolveSelectableModel(
        selectedProviderEntry.driverKind,
        activeThread?.modelSelection.model,
        providerSubagentModels,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentModels.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const providerSubagentModelLabel = providerSubagentCatalogModel
    ? getTriggerDisplayModelName(providerSubagentCatalogModel, selectedProviderEntry?.driverKind)
    : formatModelSlugName(activeThread?.modelSelection.model ?? "");
  const providerSubagentEffortLabel =
    activeThread === undefined
      ? null
      : formatModelSelectionEffort(
          activeThread.modelSelection,
          providerSubagentModels,
          reportedModelSelection,
        );
  const showComposerContextStrip =
    !embedded &&
    shouldShowComposerContextStrip({
      isDraftHeroState,
      persistInActiveThreads: settings.persistComposerContextStrip,
      hasActiveProject: activeProject !== null && !showProviderSubagentBar,
      isGitRepo,
      showEnvironmentIndicator: showComposerEnvironmentIndicator,
    });
  const terminalShortcutLabelOptions = {
    context: {
      terminalFocus: true,
      terminalOpen: Boolean(terminalUiState.terminalOpen),
    },
  };
  const splitTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    terminalShortcutLabelOptions,
  );
  const splitTerminalVerticalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.splitVertical",
    terminalShortcutLabelOptions,
  );
  const newTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.new",
    terminalShortcutLabelOptions,
  );
  const closeTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    terminalShortcutLabelOptions,
  );

  const {
    needsLoadBalancing,
    loadBalancing,
    refreshBeforeSend,
    onAutoEnvironmentStable,
    autoEnvironmentLabel,
    isEnvironmentChanging,
    readPendingEnvironmentChange,
    onEnvironmentChangeStable,
  } = useDraftEnvironmentRouting({
    draftId,
    draftThread,
    envLocked,
    automaticEnvironment,
    logicalProjectEnvironments,
    environmentById,
    providersByEnvironment,
    loadBalancingSettings,
    referencedThreadContexts,
    activeProviderInstanceId,
    selectedProvider,
    composerHasAttachments,
    activeProjectKey,
    activeProjectIsScratch,
    projectGroupingSettings,
    sendInFlightRef,
  });

  const { focusComposer: focusComposerStable, scheduleComposerFocus: scheduleComposerFocusStable } =
    useComposerFocus(composerRef);
  const canInterruptRunningThread =
    canOperateThread && deriveCanInterruptRunningThread(activeThread !== undefined, activeRuntime);
  const onInterrupt = async () => {
    if (
      !activeThread ||
      !readEnvironmentScope(activeThread.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        thrownErrorMessage(error, m) ?? gt("Failed to interrupt the current turn."),
      );
    }
  };
  const onInterruptStable = useStableCallback(onInterrupt);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window listener for the desktop snapshot event that focuses the composer
  useEffect(
    () => (embedded ? undefined : subscribeSnapShotComposerFocus(focusComposerStable)),
    [embedded, focusComposerStable],
  );
  const insertArtifactTemplate = (template: CodexArtifactTemplate) => {
    const composer = composerRef.current;
    if (!composer) return;

    const currentDraft = composer.getSendContext().prompt;
    const prompt = codexArtifactTemplatePromptToAppend(currentDraft, template);
    if (prompt !== null && !composer.insertTextAtEnd(prompt, { ensureLeadingBoundary: true })) {
      toastManager.add({
        type: "error",
        title: gt("Unable to add to chat"),
        description: gt("The composer is busy; try again once it is ready."),
      });
      return;
    }
    scheduleComposerFocusStable();
  };
  const insertArtifactTemplateStable = useStableCallback(insertArtifactTemplate);
  const sendAppMessage = async (text: string) => {
    if (!isServerThread || activeThreadId === null) {
      throw new Error(gt("Messages from apps need a started thread."));
    }
    const result = await startThreadTurn({
      environmentId,
      input: {
        threadId: activeThreadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        dispatchMode: "queue",
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      throw error instanceof Error ? error : new Error(gt("Could not send the app's message."));
    }
  };
  const sendAppMessageStable = useStableCallback(sendAppMessage);
  const queuedRunsControlRef = useRef<QueuedRunsControlHandle>(null);

  const {
    activatePanelTerminalStable,
    addTerminalContextToDraftStable,
    addTerminalSurfaceStable,
    closePanelTerminalStable,
    lastInvokedScriptByProjectId,
    runProjectScriptStable,
    runShellCommandStable,
    splitPanelTerminalStable,
    splitPanelTerminalVerticalStable,
    toggleTerminalVisibilityStable,
    shortcuts: terminalShortcuts,
  } = useChatTerminalActions({
    environmentId,
    composerRef,
    terminalUiState,
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    runningTerminalIds,
    activeServerOrderedTerminalIds,
    activeTerminalLabelsById,
    panelTerminalIds,
    canReuseTerminal,
    gitCwd,
    setTerminalUiLaunchContext,
    setThreadError,
  });
  const {
    saveProjectScript: saveProjectScriptStable,
    updateProjectScript: updateProjectScriptStable,
    deleteProjectScript: deleteProjectScriptStable,
  } = useProjectScriptEditing({
    environmentId,
    project: activeProject,
    scripts: activeProjectScripts,
    settings,
  });
  const canOperatePreview = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const shownPreviewMiniPlayer =
    activeThreadRef &&
    activePreviewMiniPlayer &&
    previewMiniPlayerVisible &&
    (activePreviewMiniPlayer.source.kind === "device" || canOperatePreview)
      ? activePreviewMiniPlayer
      : null;
  const canvasPreview = useThreadPreviewCanvasSource(activeThreadRef, shownPreviewMiniPlayer);
  const threadPanelInlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, activeThreadRef, "inline"),
  );
  // Selects only the mode, so canvas resizes rerender the chat view only when the
  // card switches presentation.
  const threadPanelPresentation = useStore(
    chatCanvasStore,
    (state) =>
      resolveChatCanvasModel({
        measurements: state.measurements,
        detailsCardMeasurement: state.detailsCardMeasurement,
        threadRef: activeThreadRef,
        preview: canvasPreview,
        detailsCardInlineOpen: threadPanelInlineOpen,
      }).detailsCardMode,
  );
  const threadPanelOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(
      state.threadPanelVisibilityByThreadKey,
      activeThreadRef,
      threadPanelPresentation,
    ),
  );
  const supportsThreadPullRequests = serverConfig !== null;
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable =
    isServerThread && supportsThreadPullRequests && visiblePullRequestCount > 0;
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(
    activeThreadRef?.environmentId ?? null,
  );
  // The thread's own change request, placed against the project it belongs to. Without a
  // project there is nothing to resolve it against, so the caller falls back to the browser.
  const activeProjectRepository = sourceControlClients.repositorySelector(
    activeProject?.repositoryIdentity,
  );
  const {
    linked: linkedThreadPullRequest,
    linkedKey: linkedThreadPullRequestKey,
    hasDetail: hasLinkedPullRequestDetail,
  } = useThreadLinkedPullRequest({
    serverThreadRef: isServerThread ? activeThreadRef : null,
    environmentId: activeThreadRef?.environmentId ?? null,
    persisted: isServerThread
      ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
      : (activeThread?.linkedPullRequest ?? null),
    projectId: activeProject?.id ?? null,
    projectRepository: activeProjectRepository,
    threadBranch: activeThread?.branch ?? null,
    gitStatus: gitStatusQuery.data ?? null,
  });
  const proactivePullRequestsKey = pullRequestsSurfaceAvailable
    ? JSON.stringify(
        visiblePullRequests.map((link) => [link.host, link.repository, link.number]).sort(),
      )
    : linkedThreadPullRequestKey;
  const activeRunningTurnId = activeRuntime?.activeRunId ?? null;
  useProactivePanels({
    threadRef: isServerThread && !embedded ? activeThreadRef : null,
    enabled: settings.proactivePanelsEnabled && !shouldUsePlanSidebarSheet && !embedded,
    settingsHydrated: clientSettingsHydrated,
    threadDetailLoading,
    runningTurnId: activeRunningTurnId,
    latestRun: activeLatestRun,
    latestRunSettled,
    turnDiffSummaries,
    isGitRepo: gitStatusQuery.data?.isRepo,
    linkedPullRequest: linkedThreadPullRequest,
    hasLinkedPullRequestDetail,
    pullRequestsKey: proactivePullRequestsKey,
    pullRequestsCapabilityKnown,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    visiblePullRequestCount,
    onDiffPanelOpen,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- consumes a pending maximize request from the right panel store once the panel can maximize
  useEffect(() => {
    if (!canMaximizeRightPanel) return;
    if (useRightPanelStore.getState().consumeMaximizeRequest(routeThreadRef)) {
      useRightPanelStore.getState().setMaximized(routeThreadRef, true);
    }
  }, [canMaximizeRightPanel, routeThreadRef]);
  const {
    closeSurface: closeRightPanelSurface,
    closeOtherSurfaces: closeOtherRightPanelSurfacesStable,
    closeSurfacesToRight: closeRightPanelSurfacesToRightStable,
    closeAllSurfaces: closeAllRightPanelSurfacesStable,
  } = useRightPanelSurfaceClose({
    threadRef: activeThreadRef,
    terminalLabelsById: activeTerminalLabelsById,
  });
  const closeRightPanelSurfaceStable = closeRightPanelSurface;
  const persistThreadSettingsForNextTurn = async (input: {
    threadId: ThreadId;
    createdAt: string;
    branch?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }): Promise<AtomCommandResult<void, unknown>> => {
    if (!serverThread) {
      return AsyncResult.success(undefined);
    }

    let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
    const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
      currentModelSelection: serverThread.modelSelection,
      currentBranch: serverThread.branch,
      ...(input.branch ? { nextBranch: input.branch } : {}),
    });
    if (metadataUpdate) {
      result = mapAtomCommandResult(
        await updateThreadMetadata({
          environmentId,
          input: {
            threadId: input.threadId,
            ...metadataUpdate,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.runtimeMode !== serverThread.runtimeMode) {
      result = mapAtomCommandResult(
        await setThreadRuntimeMode({
          environmentId,
          input: {
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.interactionMode !== serverThread.interactionMode) {
      result = mapAtomCommandResult(
        await setThreadInteractionMode({
          environmentId,
          input: {
            threadId: input.threadId,
            interactionMode: input.interactionMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
    }
    return result;
  };

  const {
    showScrollToBottom,
    timelineLiveFollowEnabled,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onTimelineFooterGrowStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
    attachTimelineViewport,
    attachComposerOverlay: attachFollowComposerOverlay,
  } = useTimelineFollow({
    legendListRef,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
  });

  useFocusComposerOnThreadOpen(
    activeThreadRef,
    workspaceLayoutElement,
    !embedded,
    terminalUiState.terminalOpen,
    isCoarsePointer ? ignoreComposerFocus : focusComposerStable,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window focus listener that refocuses the composer after the window regains focus on a fine pointer
  useEffect(() => {
    if (
      embedded ||
      !activeThread?.id ||
      terminalUiState.terminalOpen ||
      isMobileViewport ||
      isCoarsePointer
    ) {
      return;
    }
    let frame: number | null = null;
    const onWindowFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // Wait an extra frame after window focus so the composer treats focus as an expansion request.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (document.querySelector("[data-mcp-app-fullscreen]") !== null) return;
          if (
            !isInSideChatPane(document.activeElement) &&
            shouldRefocusComposerOnWindowFocus(document.activeElement, document.getSelection())
          ) {
            focusComposerStable();
          }
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [
    activeThread?.id,
    embedded,
    focusComposerStable,
    isCoarsePointer,
    isMobileViewport,
    terminalUiState.terminalOpen,
  ]);

  // Promotion drops draftId while a send may still be dispatching, so key by thread.
  const [localDispatchThreadId, setLocalDispatchThreadId] = useState(threadId);
  if (localDispatchThreadId !== threadId) {
    setLocalDispatchThreadId(threadId);
    resetLocalDispatch();
  }

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
    preparingWorktree: isPreparingWorktree,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeMessageCount === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  if (
    !canOverrideServerThreadEnvMode &&
    (pendingServerThreadEnvModeEntry !== null || pendingServerThreadBranchEntry !== null)
  ) {
    setPendingServerThreadEnvModeEntry(null);
    setPendingServerThreadBranchEntry(null);
  }
  const pendingServerThreadEnvMode =
    pendingServerThreadEnvModeEntry !== null &&
    pendingServerThreadEnvModeEntry.threadId === activeThread?.id
      ? pendingServerThreadEnvModeEntry.mode
      : null;
  const pendingServerThreadBranchEntryForThread =
    pendingServerThreadBranchEntry?.threadId === activeThread?.id
      ? pendingServerThreadBranchEntry
      : null;
  const setPendingServerThreadBranch = (branch: string | null) => {
    if (activeThread) setPendingServerThreadBranchEntry({ threadId: activeThread.id, branch });
  };
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? draftThread?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranchEntryForThread !== null
      ? pendingServerThreadBranchEntryForThread.branch
      : (activeThread?.branch ?? null);
  const startFromOrigin = isLocalDraftThread
    ? (draftThread?.startFromOrigin ?? false)
    : canOverrideServerThreadEnvMode
      ? (pendingServerThreadStartFromOriginByThreadId[activeThread?.id ?? ""] ??
        activeProjectSettings.settings.newWorktreesStartFromOrigin)
      : false;
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const localCheckoutBranchMismatch = isServerThread
    ? resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: envMode,
        activeWorktreePath,
        activeThreadBranch,
        currentGitBranch: gitStatusQuery.data?.refName ?? null,
      })
    : null;
  const publishComposerOverlayHeight = (height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    if (composerTimelineInsetRef.current !== nextHeight) {
      composerTimelineInsetRef.current = nextHeight;
      setComposerTimelineInset(nextHeight);
    }
    // Reserve the expanded composer height for the terminal drawer and empty placeholder.
    // Keep it while the mobile strip collapses, but allow growth from approvals or tasks.
    // A hero overlay fills the pane, so reserve only its stack.
    const stack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-stack="true"]',
    );
    const expandedComposerHeight =
      isDraftHeroState && stack ? Math.ceil(stack.getBoundingClientRect().height) : nextHeight;
    const mobileCollapsed = Boolean(
      stack?.querySelector('[data-chat-composer-mobile-collapsed="true"]'),
    );
    if (!mobileCollapsed) composerExpandedHeightRef.current = expandedComposerHeight;
    const reservedHeight = Math.max(composerExpandedHeightRef.current, expandedComposerHeight);
    if (composerReservedHeightRef.current !== reservedHeight) {
      composerReservedHeightRef.current = reservedHeight;
      setComposerReservedHeight(reservedHeight);
    }
    const mainSurface = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-main-surface="true"]',
    );
    const button =
      composerOverlayElement?.parentElement?.querySelector<HTMLElement>("[data-scroll-to-end]");
    const clearance =
      composerOverlayElement && mainSurface && button
        ? resolveScrollToEndClearance({
            overlayHeight: nextHeight,
            mainSurfaceTop: mainSurface.getBoundingClientRect().top,
            button: button.getBoundingClientRect(),
            attachments: Array.from(
              composerOverlayElement.querySelectorAll<HTMLElement>(
                '[data-composer-banner-surface="attached"]',
              ),
              (element) => element.getBoundingClientRect(),
            ),
          })
        : nextHeight;
    setScrollToEndClearance(clearance);
  };
  const publishComposerOverlayHeightStable = useStableCallback(publishComposerOverlayHeight);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the composer overlay element before paint for a new thread or composer mount
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A thread switch or a composer mount/unmount must re-measure the overlay for the new timeline.
    activeThreadKey,
    composerMounted,
    composerOverlayElement,
    publishComposerOverlayHeightStable,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the composer overlay element's size before paint and publishes its height
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
    };

    updateHeight();
    // The hero overlay fills the pane, so the composer's own growth only shows on its stack.
    const stack = isDraftHeroState
      ? composerOverlayElement.querySelector<HTMLElement>('[data-chat-composer-stack="true"]')
      : null;
    return observeResize(
      stack ? [composerOverlayElement, stack] : composerOverlayElement,
      updateHeight,
    );
  }, [
    composerOverlayElement,
    isDraftHeroState,
    publishComposerOverlayHeightStable,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The scroll-to-bottom button changes the overlay's height without resizing the observed node first.
    showScrollToBottom,
  ]);
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(activeThreadRef);
  const activeThreadReferenceCopyTarget =
    activeThreadRef === null || !isServerThread
      ? null
      : resolveThreadReferenceCopyTarget(
          {
            threadRef: activeThreadRef,
            title: activeThread?.title ?? "",
            openPanelPullRequestUrl,
            pullRequests: activeThread?.pullRequests,
            linkedPullRequestUrl: linkedThreadPullRequest?.url ?? null,
            hostedAppUrl: configuredHostedAppUrl(),
          },
          messages,
        );
  const copyActiveThreadReference = () => {
    if (activeThreadReferenceCopyTarget === null) return;
    void copyThreadReference(activeThreadReferenceCopyTarget);
  };
  const pullRequestPanelTarget = activeThread
    ? threadPullRequestPanelTarget({
        projectId: activeThread.projectId,
        pullRequests: visiblePullRequests,
        linkedPullRequest: linkedThreadPullRequest,
        branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
      })
    : null;
  const {
    activateRightPanelSurfaceStable,
    addDeviceSurfaceStable,
    addDiffSurfaceStable,
    addFilesSurfaceStable,
    addPullRequestSurfaceStable,
    addPullRequestsSurfaceStable,
    closePreviewPanelStable,
    copyRightPanelFilePathStable,
    createBrowserSurface,
    createBrowserSurfaceStable,
    moveRightPanelSurfaceStable,
    onOpenToolDiffStable,
    onOpenTurnDiffStable,
    openChangesFromThreadPanelStable,
    openFileSurfaceStable,
    toggleRightPanelMaximizedStable,
    toggleRightPanelStable,
    toggleThreadPanelStable,
    shortcuts: rightPanelShortcuts,
  } = useRightPanelActions({
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    activePreviewState,
    deviceState,
    deviceStateLoaded,
    pullRequestPanelTarget,
    threadPanelPresentation,
    isServerThread,
    embedded,
    isGitRepo,
    browserAvailable,
    canOperatePreview,
    diffOpen,
    previewPanelOpen,
    rightPanelOpen,
    canMaximizeRightPanel,
    rightPanelMaximized,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    gitCwd,
    activeProjectCwd,
    onDiffPanelOpen,
    closeRightPanelSurface,
  });
  const pullRequestSurfaceAvailable = supportsPullRequests && pullRequestPanelTarget !== null;
  const {
    acknowledgeActiveThreadWoke,
    activeBranchMismatchKey,
    attentionNow,
    workNow,
    childInputNow,
    goalNow,
    handleSwitchCheckoutToThread,
    handleSwitchCheckoutToThreadStable,
    isRestoringThreadBranch,
    onOpenRelatedThreadStable,
    sendStandaloneCommand,
    setBranchMismatchDismissTick,
    showBranchMismatchBanner,
    threadStatusLine,
    shortcuts: threadLifecycleShortcuts,
  } = useThreadLifecycle({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    canOperateThread,
    clientSettingsHydrated,
    activeThread,
    activeThreadId,
    activeThreadRef,
    threadDetailRef: routeThreadDetailRef,
    activeThreadKey,
    activeThreadShell,
    activeLatestRun,
    limitRecoveryHoldsSnooze,
    activeProjectCwd,
    serverConfig,
    runtimeMode,
    isWorking,
    // A waiting run is checkpoint drain; Stop there reaches its background work.
    runIsLive: (isWorking && activeRuntime?.status !== "waiting") || phase === "connecting",
    pendingBackgroundTasks,
    turnItems: serverProjection?.turnItems ?? EMPTY_TURN_ITEMS,
    activePendingApproval,
    activePendingUserInput,
    localCheckoutBranchMismatch,
    gitStatusQuery,
    nowMinute,
    composerRef,
    composerDraftTarget,
    sendInFlightRef,
    setOptimisticUserMessages,
    setThreadError,
    clearUsageLimitsFor,
    beginLocalDispatch,
    resetLocalDispatch,
    scrollToEnd,
    persistThreadSettingsForNextTurn,
  });
  const activeThreadHasCompactableConversation = hasCompactableConversation({
    visibleTurnItems: serverVisibleTurnItems,
    hasMoreHistory: serverThreadHistory.hasMoreHistory,
    latestUserMessageAt: serverThread?.latestUserMessageAt ?? null,
  });
  const pendingHandoffSelection =
    (composerModelSelectionApplies ? composerSelectedModelSelection : null) ??
    activeThread?.modelSelection;
  const pendingHandoffSelectionUsable = providerInstanceEntries.some(
    (entry) =>
      entry.instanceId === pendingHandoffSelection?.instanceId &&
      entry.enabled &&
      entry.isAvailable,
  );
  const pendingHandoff = resolvePendingHandoff(
    serverProjection,
    pendingHandoffSelectionUsable ? pendingHandoffSelection : null,
    providerStatuses,
  );
  const compactThreadUnavailable =
    !canOperateThread ||
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    isRevertingCheckpoint ||
    threadDetailLoading ||
    isPreparingWorktree ||
    activeEnvironmentUnavailable ||
    feedbackUploading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0;
  const compactDisabled = compactThreadUnavailable;
  // The context window is the current conversation's, so a handoff destination never inherits it.
  const resumeCompactionTokens =
    activeContextWindow &&
    pendingHandoff === null &&
    resolveIdleCompaction(
      settings,
      activeProviderInstanceId ?? ProviderInstanceId.make("claudeAgent"),
    ) !== "off" &&
    !resumeCompactionPermanentlyDismissed &&
    !nativeResumeCompactionDismissed &&
    !compactDisabled &&
    !hasHeldQueuedRuns &&
    multipleModelSelections === null &&
    shouldOfferResumeCompaction({
      provider: selectedProvider,
      usedTokens: activeContextWindow.usedTokens,
      updatedAt: activeContextWindow.updatedAt,
      promptCacheTtlMs: activeThreadLiveTokenUsage?.promptCacheTtlMs,
      now: `${nowMinute}:00.000Z`,
    })
      ? activeContextWindow.usedTokens
      : null;
  const [fullHistoryThreadKeys, setFullHistoryThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keepFullHistory = fullHistoryThreadKeys.has(routeThreadKey);
  const setKeepFullHistory = (threadKey: string, keep: boolean) => {
    setFullHistoryThreadKeys((current) => {
      if (current.has(threadKey) === keep) return current;
      const next = new Set(current);
      if (keep) next.add(threadKey);
      else next.delete(threadKey);
      return next;
    });
  };
  const freshSessionAvailable =
    activeMessageCount > 0 && serverConfig?.environment.capabilities.freshContext === true;
  // While a question or approval owns the composer, its text answers that, not the agent.
  const freshSessionCommandAvailable =
    freshSessionAvailable && activePendingApproval === null && pendingUserInputs.length === 0;
  const freshSessionArmed = useFreshSessionArmed(routeThreadKey);
  const toggleKeepFullHistory = () => setKeepFullHistory(routeThreadKey, !keepFullHistory);
  const toggleKeepFullHistoryStable = useStableCallback(toggleKeepFullHistory);
  const armFreshSessionStable = useStableCallback(() => armFreshSession(routeThreadKey));
  const handleRestoreThreadBranch = () => {
    if (!canWriteSourceControl) return;
    if (gitStatusQuery.data?.hasWorkingTreeChanges) {
      if (activeThreadKey !== null) openBranchRestoreConfirm(activeThreadKey);
      return;
    }
    void handleSwitchCheckoutToThread();
  };
  const handleRestoreThreadBranchStable = useStableCallback(handleRestoreThreadBranch);
  const feedbackBannerItems = feedbackSubmissions.flatMap((submission) => {
    const item = feedbackBannerItem(
      submission,
      () => {
        setFeedbackSubmissionsByThreadKey((current) => ({
          ...current,
          [routeThreadKey]: (current[routeThreadKey] ?? []).filter(
            (entry) => entry.id !== submission.id,
          ),
        }));
      },
      messages,
    );
    return item ? [item] : [];
  });
  const limitRecoveryBanner =
    limitRecoveryRun !== null && activeThreadShell !== null
      ? usageLimitRecoveryBannerItem(
          {
            runId: limitRecoveryRun.runId,
            errorCode: serverRuntime?.lastErrorCode ?? null,
            resetAt: serverRuntime?.usageLimitResetAt ?? null,
            stoppedAt: limitRecoveryRun.completedAt ?? activeThreadShell.updatedAt,
            settled: activeThreadShell.settledOverride === "settled",
            requestPending: pendingApprovals.length > 0 || pendingUserInputs.length > 0,
            recovery: activeThreadShell.limitRecovery ?? null,
            snoozedUntil: activeThreadShell.snoozedUntil,
            timestampFormat,
            onChange: async (limitRecovery) => {
              const result = await updateThreadMetadata({
                environmentId,
                input: { threadId: activeThreadShell.id, limitRecovery },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            },
          },
          messages,
        )
      : null;
  const composerBannerItems = (() => {
    const fallbackSelection = draftFallback?.selection;
    const defaultSelection =
      draftDefaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(
        providerStatuses,
        settings,
        draftThread?.projectId ?? null,
      );
    const fallback =
      !isServerThread &&
      multipleModelSelections === null &&
      !composerModelSelectionExplicit &&
      draftFallback?.fallback &&
      (!composerSelectedModelSelection ||
        (composerSelectedModelSelection.instanceId === fallbackSelection?.instanceId &&
          composerSelectedModelSelection.model === fallbackSelection?.model))
        ? draftFallback.fallback
        : null;
    const fallbackWindow = fallback
      ? `${fallback.provider.instanceId}:${fallback.resetsAt ?? ""}`
      : null;
    const fallbackItems: ComposerBannerStackItem[] =
      fallback &&
      fallbackSelection &&
      defaultSelection &&
      fallbackWindow !== dismissedFallbackWindow
        ? [
            modelFallbackBannerItem(
              {
                fallbackModelName:
                  providerStatuses
                    .find((provider) => provider.instanceId === fallbackSelection.instanceId)
                    ?.models.find((model) => model.slug === fallbackSelection.model)?.name ??
                  fallbackSelection.model,
                defaultProviderName: fallback.provider.displayName ?? fallback.provider.driver,
                defaultModelName:
                  fallback.provider.models.find((model) => model.slug === defaultSelection.model)
                    ?.name ?? defaultSelection.model,
                resetsAt: fallback.resetsAt,
                timestampFormat,
                onUseDefault: () =>
                  onProviderModelSelectStable(defaultSelection.instanceId, defaultSelection.model),
                onDismiss: () => setDismissedFallbackWindow(fallbackWindow),
              },
              messages,
            ),
          ]
        : [];
    const limitRecoveryItems = limitRecoveryBanner === null ? [] : [limitRecoveryBanner];
    const extensionStatusBanner = extensionStatusBannerItem(
      deriveProviderExtensionStatuses(serverProjection),
    );
    const extensionStatusItems = extensionStatusBanner === null ? [] : [extensionStatusBanner];
    const usageLimitsItems = usageLimitsBanner === null ? [] : [usageLimitsBanner];
    const projectCloneItems = projectCloneBannerItem === null ? [] : [projectCloneBannerItem];
    // An approval's feedback goes to that approval; the armed session waits for the next message.
    const freshSessionItems =
      freshSessionAvailable && freshSessionArmed && activePendingApproval === null
        ? [freshSessionBannerItem(() => disarmFreshSession(routeThreadKey), messages)]
        : [];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [
        ...feedbackBannerItems,
        ...fallbackItems,
        ...limitRecoveryItems,
        ...extensionStatusItems,
        ...usageLimitsItems,
        ...projectCloneItems,
        ...freshSessionItems,
        ...systemComposerBannerItems,
      ];
    }
    return [
      ...feedbackBannerItems,
      ...fallbackItems,
      ...limitRecoveryItems,
      ...extensionStatusItems,
      ...usageLimitsItems,
      ...projectCloneItems,
      ...freshSessionItems,
      ...systemComposerBannerItems,
      branchMismatchBannerItem(
        {
          mismatchKey: activeBranchMismatchKey,
          mismatch: localCheckoutBranchMismatch,
          restoreDisabled: !canWriteSourceControl || isRestoringThreadBranch,
          restoring: isRestoringThreadBranch,
          onRestore: handleRestoreThreadBranchStable,
          onDismiss: () => {
            dismissBranchMismatchForSession(activeBranchMismatchKey);
            setBranchMismatchDismissTick((tick) => tick + 1);
          },
        },
        messages,
      ),
    ];
  })() as ComposerBannerStackItem[];

  if (
    terminalUiLaunchContext !== null &&
    (terminalUiLaunchContext.threadId !== activeThreadId ||
      !terminalUiState.terminalOpen ||
      (activeProjectCwd !== null &&
        projectScriptCwd({
          project: { cwd: activeProjectCwd },
          worktreePath: activeThreadWorktreePath,
        }) === terminalUiLaunchContext.cwd &&
        (activeThreadWorktreePath ?? null) === terminalUiLaunchContext.worktreePath))
  ) {
    setTerminalUiLaunchContext(null);
  }

  const getShortcutContext = (eventTarget: EventTarget | null = document.activeElement) => ({
    terminalFocus: getTerminalFocusOwner() !== null,
    terminalOpen: Boolean(terminalUiState.terminalOpen),
    previewFocus: isPreviewFocused(),
    previewOpen: previewPanelOpen,
    rightPanelOpen,
    editableFocus: isEditableFocused(eventTarget),
    modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
    composerFocus:
      document.activeElement?.getAttribute("data-testid") === "composer-editor" &&
      isInSideChatPane(document.activeElement) === embedded,
    draftThreadRoute: routeKind === "draft",
    turnRunning: phase === "running" || phase === "connecting",
    composerRequiresModifier: composerRequiresModifier(settings.sendShortcut, promptRef.current),
    isWeb: !isElectron,
    isDesktop: isElectron,
  });
  const getShortcutContextStable = useStableCallback(getShortcutContext);
  const timelineSkills = activeProviderStatus
    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
    : EMPTY_PROVIDER_SKILLS;
  const threadFindEnabled = isServerThread && serverConfig?.threadFind === true;
  const isThreadFindActive = useThreadFindOpen(activeThreadRef, threadFindEnabled);
  const openThreadFindStable = useStableCallback((threadRef: ScopedThreadRef) => {
    if (threadFindEnabled && scopedThreadKey(threadRef) === activeThreadKey) {
      openThreadFind(activeThreadKey);
    }
  });

  useChatShortcuts({
    enabled: activeThreadId !== null && !backgroundThread,
    embedded,
    composerElement: composerOverlayElement,
    keybindings,
    scriptKeybindings,
    getShortcutContext,
    threadFindActive: isThreadFindActive,
    composerRef,
    branchToolbarRef,
    closeThreadFind: () => {
      closeThreadFind();
      focusComposerStable();
    },
    commands: {
      ...terminalShortcuts,
      ...rightPanelShortcuts,
      ...threadLifecycleShortcuts,
      "thread.copyReference": ({ event }) => {
        if (!event.repeat) copyActiveThreadReference();
      },
      "chat.find": () => {
        if (!isServerThread || serverConfig?.threadFind !== true || activeThreadKey === null)
          return false;
        openThreadFind(activeThreadKey);
      },
      "composer.cycleHost": ({ event }) => {
        if (!canChangeEnvironment) return false;
        if (event.repeat) return;
        const currentId = readPendingEnvironmentChange()?.environmentId ?? environmentId;
        const index = logicalProjectEnvironments.findIndex(
          (env) => env.environmentId === currentId,
        );
        const next = logicalProjectEnvironments[(index + 1) % logicalProjectEnvironments.length];
        if (next) onEnvironmentChangeStable(next.environmentId);
      },
      "thread.steerQueuedMessage": ({ event }) =>
        routeKind !== "draft" && queuedRunsControlRef.current?.steerNext(event.repeat) === true,
      "thread.editQueuedMessage": ({ event }) =>
        routeKind !== "draft" &&
        composerRef.current?.isCaretAtStart() === true &&
        queuedRunsControlRef.current?.editLatest(event.repeat) === true,
      "thread.stop": ({ event }) => {
        if (!canInterruptRunningThread) return false;
        if (!event.repeat) void onInterruptStable();
      },
    },
    fallback: (command) => {
      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject || !canOperateTerminal) return undefined;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      return script ? () => void runProjectScriptStable(script) : undefined;
    },
  });

  // A focused desktop browser page forwards these chords as menu actions.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to desktop bridge menu actions that toggle the right panel
  useEffect(() => {
    if (embedded) return;
    return window.desktopBridge?.onMenuAction((action) => {
      if (action === "rightPanel.toggle") toggleRightPanelStable();
      else if (action === "rightPanel.toggleMaximized") toggleRightPanelMaximizedStable();
    });
  }, [embedded, toggleRightPanelStable, toggleRightPanelMaximizedStable]);

  usePasteToFocusComposer(embedded ? null : activeThreadId, composerRef);
  // A delegated task is a remote thread's subagent.
  const isSubagentThread =
    activeThread?.lineage.relationshipToParent === "subagent" || delegatedFrom !== null;
  // Side chats do not nest or start from subagents, and older servers would fork a listed thread.
  const sideChatsOffered =
    !embedded &&
    canOperateThread &&
    activeThread?.lineage.sideChat !== true &&
    !isSubagentThread &&
    serverConfig?.environment.capabilities.sideChats === true;
  const sideChat = useSideChat({
    threadRef: sideChatsOffered && isServerThread ? activeThreadRef : null,
    readSettings: () => ({
      runtimeMode,
      modelSelection: composerRef.current?.getSendContext().selectedModelSelection,
    }),
    onError: (message) => {
      if (activeThread) setThreadError(activeThread.id, message);
    },
  });
  // A maximized panel covers the terminal drawer the command runs in.
  const runSideChatShellCommandStable = useStableCallback((command: string) => {
    if (activeThreadRef) useRightPanelStore.getState().setMaximized(activeThreadRef, false);
    runShellCommandStable(command);
  });
  // Main-thread surfaces show this reason; `/side` sent anyway gets it as a toast.
  const sideChatDisabledReason =
    activeThread?.lineage.sideChat === true
      ? gt("Side chats cannot start side chats.")
      : isSubagentThread
        ? gt("Subagent threads cannot start side chats.")
        : serverConfig === null
          ? gt("Side chats are not ready yet. Try again in a moment.")
          : serverConfig.environment.capabilities.sideChats !== true
            ? gt("Update this environment's T3 Code server to use side chats.")
            : sideChatsOffered && !isServerThread
              ? gt("Side chats start after the first message.")
              : sideChat.available &&
                  orchestrationV2WorktreePending(
                    activeThread?.worktreePath ?? null,
                    serverProjection?.runs ?? [],
                  )
                ? gt("Available once the thread's worktree is set up.")
                : null;
  const openSideChatStable = useStableCallback(() => void sideChat.open());
  const sendSideChatStable = useStableCallback((prompt: string) => sideChat.open(prompt));
  const { onConfirmRevertStable, onForkFromRunStable, onRevertTimelineTurnStable } =
    useTimelineRewind({
      environmentId,
      routeThreadRef,
      routeThreadKey,
      currentRouteThreadKeyRef,
      serverProjection,
      activeThread,
      timelineMessages,
      phase,
      isSendBusy,
      isRevertingCheckpoint,
      supportsConversationRollback,
      activeEnvironmentUnavailable,
      activeEnvironmentUnavailableLabel,
      promptRef,
      composerRef,
      composerDraftTarget,
      setThreadError,
    });
  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", gt("Failed to compact context."));
  };

  const {
    getModelDisabledReason,
    handleRuntimeModeChangeStable,
    onEnvModeChangeStable,
    onProviderModelSelectStable,
    onStartFromOriginChange,
    openProviderSetupStable,
  } = useComposerSelection({
    environmentId,
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    activeProjectSettings,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    multipleModelSelections,
    runtimeMode,
    isLocalDraftThread,
    canOverrideServerThreadEnvMode,
    setPendingServerThreadEnvModeEntry,
    setPendingServerThreadStartFromOriginByThreadId,
    scheduleComposerFocus: scheduleComposerFocusStable,
  });
  const { onResume, isResuming } = useComposerResume({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    activeThread,
    resumableRunId,
    hasHeldQueuedRuns,
    canResume,
    isSendBusy,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    runtimeMode,
    localCheckoutBranchMismatch,
    composerRef,
    persistThreadSettingsForNextTurn,
    clearUsageLimitsFor,
    scrollToEnd,
    setThreadError,
  });
  const [selectedMediaArtifactKey, setSelectedMediaArtifactKey] = useState<string | null>(null);
  const threadMediaArtifacts = (() => collectThreadMediaArtifacts(timelineMessages))();

  const displayableThreadMediaArtifacts = useDisplayableMediaArtifacts({
    environmentId,
    threadRef: activeThreadRef,
    artifacts: threadMediaArtifacts,
  });

  const selectedThreadMediaArtifact = (() =>
    displayableThreadMediaArtifacts.find(
      (artifact) => artifact.dedupeKey === selectedMediaArtifactKey,
    ) ?? null)();

  const [scheduledMessageVersion, setScheduledMessageVersion] = useState(0);
  const { onSend } = useComposerSend({
    mediaContext: {
      selectedArtifact: selectedThreadMediaArtifact,
      recentArtifacts: displayableThreadMediaArtifacts,
    },
    onScheduled: () => setScheduledMessageVersion((version) => version + 1),
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    draftId,
    draftThread,
    activeThread,
    activeThreadKey,
    activeThreadBranch,
    activeProject,
    activeProjectIsScratch,
    activeProjectDefaultModelSelection,
    activeMessageCount,
    isServerThread,
    isLocalDraftThread,
    isGitRepo,
    phase,
    runtimeMode,
    sendEnvMode,
    startFromOrigin,
    localCheckoutBranchMismatch,
    logicalProjectEnvironments,
    providerInstanceEntries,
    composerRef,
    composerDraftTarget,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    feedbackUploadsInFlightRef,
    queuedRunEdit,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    isSendBusy,
    sendQueuesBehindSetup,
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
    keepFullHistory,
    freshSessionAvailable: freshSessionCommandAvailable,
    resumeCompactionTokens,
    usageLimitsKey,
    usageLimitsOffered,
    openUsageLimits,
    clearUsageLimitsFor,
    needsLoadBalancing,
    loadBalancing,
    refreshBeforeSend,
    readPendingEnvironmentChange,
    pendingApprovals,
    respondingRequestIds,
    activePendingUserInput,
    onAdvanceActivePendingUserInput,
    onRespondToApproval: onRespondToApprovalStable,
    beginLocalDispatch,
    resetLocalDispatch,
    beginWorktreeSetup,
    captureDraftHeroComposerRect,
    setDockedDraftHeroThreadKey,
    setSetupQueueSendThreadKey,
    setOptimisticUserMessages,
    optimisticBlobPreviews: {
      track: (message) => optimisticBlobPreviews.track(threadId, message),
      release: (message) => optimisticBlobPreviews.release(threadId, message),
    },
    setFeedbackSubmissionsByThreadKey,
    setThreadError,
    setKeepFullHistory,
    anchorNewTurn,
    acknowledgeActiveThreadWoke,
    onSideChat: sideChat.available ? sendSideChatStable : undefined,
    sideChatDisabledReason,
    handleNewThreadInActiveProject,
    persistThreadSettingsForNextTurn,
    linkCheckoutPullRequest,
  });

  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });

  const createThread = useAtomCommand(threadEnvironment.create, {
    reportFailure: false,
  });

  const recordThreadWorkflow = useAtomCommand(threadEnvironment.recordWorkflow, {
    reportFailure: false,
  });

  const threadActivities = (() => workflowActivities(serverProjection))();

  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;

  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );

  const planSidebarDismissedForTurnRef = useRef<string | null>(null);

  const workflowLaneLaunchInFlightRef = useRef<Set<string>>(new Set());

  const workflowLaneLaunchRecordedRef = useRef<Set<string>>(new Set());

  const workflowCompletionInFlightRef = useRef<Set<string>>(new Set());

  const workflowCompletionRecordedRef = useRef<Set<string>>(new Set());

  const planSidebarOpen = activeRightPanelSurface?.kind === "plan";

  const activePlan = (() => deriveActivePlanState(serverProjection, activeActivityRun?.runId))();

  const supportsThreadRecurringSchedules =
    attachmentEnvironmentConfig?.environment.capabilities.threadRecurringSchedules === true;

  const sidebarProposedPlan = (() => findLatestProposedPlan(serverProjection, null))();

  const workflowChildCompletionsAtom = (() =>
    Atom.make((get): WorkflowChildCompletionObservation[] => {
      if (!activeThread) return [];
      return workflowChildCompletionObservations({
        parentThread: activeThread,
        activities: threadActivities,
        childThreadForId: (childThreadId) =>
          get(
            environmentThreadDetails.threadAtom(
              scopeThreadRef(activeThread.environmentId, childThreadId),
            ),
          ),
      });
    }).pipe(Atom.withLabel(`workflow-child-completions:${routeThreadKey}`)))();

  const workflowChildCompletions = useAtomValue(workflowChildCompletionsAtom);

  const workflowLaneRunDetailsAtom = (() =>
    Atom.make((get): WorkflowLaneRunDetail[] => {
      if (!activeThread) return [];
      return workflowLaneRunDetails({
        parentThread: activeThread,
        activities: threadActivities,
        childThreadForId: (childThreadId) =>
          get(
            environmentThreadDetails.threadAtom(
              scopeThreadRef(activeThread.environmentId, childThreadId),
            ),
          ),
      });
    }).pipe(Atom.withLabel(`workflow-lane-run-details:${routeThreadKey}`)))();

  const workflowLaneRunDetailsForSidebar = useAtomValue(workflowLaneRunDetailsAtom);

  const workflowSidebarActive = interactionMode === "workflow";

  const planSidebarLabel = workflowSidebarActive
    ? "Workflow"
    : sidebarProposedPlan || interactionMode === "plan"
      ? "Plan"
      : "Tasks";

  const saveProjectTestEnvironments = async (testEnvironments: ProjectTestEnvironment[]) => {
    if (!activeProject) return;
    await updateProject({
      environmentId,
      input: {
        projectId: activeProject.id,
        testEnvironments,
      },
    });
  };

  const handleInteractionModeChange = (mode: ProviderInteractionMode) => {
    if (mode === interactionMode) return;
    setComposerDraftInteractionMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
    }
    scheduleComposerFocusStable();
  };

  const togglePlanSidebar = () => {
    if (!activeThreadRef) return;
    if (planSidebarOpen) {
      planSidebarDismissedForTurnRef.current =
        activePlan?.runId ?? sidebarProposedPlan?.runId ?? "__dismissed__";
    } else {
      planSidebarDismissedForTurnRef.current = null;
    }
    useRightPanelStore.getState().toggle(activeThreadRef, "plan");
  };

  const openMediaPanel = () => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "media");
  };

  const openTestsPanel = () => {
    if (!activeThreadRef || !activeProject?.workspaceRoot) return;
    useRightPanelStore.getState().open(activeThreadRef, "tests");
  };

  const appendWorkflowActivity = async (input: {
    threadId: ThreadId;
    kind: WorkflowRecordKind;
    summary: string;
    payload: Record<string, unknown>;
    turnId?: TurnId | null;
    createdAt?: string;
  }) => {
    // oxlint-disable-next-line react/purity -- Record the command execution time inside this async handler, never during render.
    const createdAt = input.createdAt ?? new Date().toISOString();
    return await recordThreadWorkflow({
      environmentId,
      input: decodeUnknownSyncThreadWorkflowRecordCommand({
        type: "thread.workflow.record",
        commandId: CommandId.make(randomUUID()),
        threadId: input.threadId,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: input.turnId ?? null,
        createdAt,
      }),
    });
  };

  const launchWorkflowChildLane = async (input: {
    lane: WorkflowPlannedSubAgent;
    workflowGoal: string;
    guidance?: string;
    existingChildThreadId?: ThreadId | null;
  }): Promise<ThreadId | null> => {
    if (!activeThread || !activeProject) return null;

    const childThreadId = input.existingChildThreadId ?? newThreadId();
    const childTurnMessageId = newMessageId();
    // oxlint-disable-next-line react/purity -- Timestamp the child launch inside this async handler, never during render.
    const childTurnRequestedAt = new Date().toISOString();
    const title = workflowLaneThreadTitle({
      parentTitle: activeThread.title,
      workflowGoal: input.workflowGoal,
      laneRole: input.lane.role,
    });
    const childPrompt = buildWorkflowChildPrompt({
      workflowGoal: input.workflowGoal,
      parentThreadId: activeThread.id,
      parentThreadTitle: activeThread.title,
      lane: input.lane,
      ...(input.guidance ? { guidance: input.guidance } : {}),
    });
    const childModelSelection = workflowLaneModelSelection(activeThread.modelSelection, input.lane);

    if (!input.existingChildThreadId) {
      const createResult = await createThread({
        environmentId,
        input: {
          threadId: childThreadId,
          projectId: activeProject.id,
          title,
          modelSelection: childModelSelection,
          runtimeMode,
          interactionMode: "default",
          branch: activeThread.branch,
          worktreePath: activeThread.worktreePath,
          workflowParentThreadId: activeThread.id,
          workflowLaneId: input.lane.id,
          workflowLaneRole: input.lane.role,
          createdAt: childTurnRequestedAt,
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          setThreadError(
            activeThread.id,
            error instanceof Error ? error.message : `Failed to create ${input.lane.role} lane.`,
          );
        }
        return null;
      }
    }

    const startResult = await startThreadTurn({
      environmentId,
      input: {
        threadId: childThreadId,
        message: {
          messageId: childTurnMessageId,
          role: "user",
          text: childPrompt,
          attachments: [],
        },
        modelSelection: childModelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode: "default",
        createdAt: childTurnRequestedAt,
      },
    });
    if (startResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(startResult)) {
        const error = squashAtomCommandFailure(startResult);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : `Failed to start ${input.lane.role} lane.`,
        );
      }
      return null;
    }

    const appendStartedResult = await appendWorkflowActivity({
      threadId: activeThread.id,
      kind: "workflow.lane.started",
      summary: `${input.lane.role} lane started`,
      payload: {
        laneId: input.lane.id,
        laneRole: input.lane.role,
        childThreadId,
        childTurnMessageId,
        childTurnRequestedAt,
        title: input.guidance ? `${input.lane.role} re-triggered` : `${input.lane.role} launched`,
        detail:
          input.guidance ??
          input.lane.goal ??
          input.lane.prompt ??
          "This planned lane was launched as a child workflow thread.",
      },
    }).catch((error) => {
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : `Failed to record ${input.lane.role} lane start.`,
      );
      return null;
    });
    if (!appendStartedResult) return null;
    if (appendStartedResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(appendStartedResult)) {
        const error = squashAtomCommandFailure(appendStartedResult);
        setThreadError(
          activeThread.id,
          error instanceof Error
            ? error.message
            : `Failed to record ${input.lane.role} lane start.`,
        );
      }
      return null;
    }

    return childThreadId;
  };

  const onSubmitWorkflowGuidance = (lane: WorkflowLaneTarget, guidance: string) => {
    if (!activeThread) return;

    const { goal, plannedSubAgents } = latestWorkflowPlanDetails(
      threadActivities,
      activePlan?.explanation ?? "Workflow",
    );
    const plannedLane: WorkflowPlannedSubAgent = plannedSubAgents.find(
      (agent) => agent.id === lane.id,
    ) ?? {
      id: lane.id,
      role: lane.role,
      prompt: guidance,
      startsAfter: [],
    };
    const existingChildThreadId = latestWorkflowChildThreadId(threadActivities, lane);

    void (async () => {
      await appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.lane.guidance",
        summary: `Guidance re-triggered ${lane.role}`,
        payload: {
          laneId: lane.id,
          laneRole: lane.role,
          guidance,
          retrigger: true,
        },
      }).catch(() => undefined);

      const laneLaunchKey = workflowLaneLaunchKey(activeThread.id, lane.id);
      if (workflowLaneLaunchInFlightRef.current.has(laneLaunchKey)) return;
      workflowLaneLaunchInFlightRef.current.add(laneLaunchKey);
      await (async () => {
        await launchWorkflowChildLane({
          lane: plannedLane,
          workflowGoal: goal,
          guidance,
          existingChildThreadId,
        });
      })().finally(() => {
        workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
      });
    })();
  };

  const onStartWorkflow = () => {
    if (!activeThread) return;
    const {
      activity: workflowPlanActivity,
      payload: workflowPlanPayload,
      goal,
      plannedSubAgents,
    } = latestWorkflowPlanDetails(threadActivities, activePlan?.explanation ?? "Workflow");
    const launchableSubAgents = plannedSubAgents.filter(
      (agent) => (agent.startsAfter?.length ?? 0) === 0,
    );
    const startedLaneIds = workflowStartedChildLaneIds(threadActivities);

    void (async () => {
      await appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.started",
        summary: "Workflow started",
        payload: {
          ...workflowPlanPayload,
          goal,
          launchStatus: "started",
          startedFromActivityId: workflowPlanActivity?.id ?? null,
        },
      }).catch(() => undefined);

      for (const lane of launchableSubAgents) {
        const laneLaunchKey = workflowLaneLaunchKey(activeThread.id, lane.id);
        if (
          startedLaneIds.has(lane.id) ||
          workflowLaneLaunchRecordedRef.current.has(laneLaunchKey) ||
          workflowLaneLaunchInFlightRef.current.has(laneLaunchKey)
        ) {
          continue;
        }
        workflowLaneLaunchInFlightRef.current.add(laneLaunchKey);
        await (async () => {
          const childThreadId = await launchWorkflowChildLane({
            lane,
            workflowGoal: goal,
          });
          if (childThreadId) {
            workflowLaneLaunchRecordedRef.current.add(laneLaunchKey);
          }
        })().finally(() => {
          workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
        });
      }
    })();
  };

  const onStopWorkflowLane = (lane: WorkflowLaneTarget) => {
    if (activeThread) {
      void appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.lane.stopped",
        summary: `${lane.role} lane stopped`,
        payload: {
          laneId: lane.id,
          laneRole: lane.role,
          preserved: true,
        },
      }).catch(() => undefined);
    }
    void onSubmitPlanFollowUp({
      interactionMode: "workflow",
      text: [
        `Stop the ${lane.role} workflow lane.`,
        "Preserve its partial findings, artifacts, open questions, and unfinished status. The Lead should explain what remains usable and what was not completed.",
      ].join("\n"),
    });
  };

  const onStopWorkflow = () => {
    if (activeThread) {
      void appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.stopped",
        summary: "Workflow stopped",
        payload: {
          preserved: true,
        },
      }).catch(() => undefined);
    }
    void onInterrupt();
  };

  const onWorkflowLaneControl = (
    lane: WorkflowLaneTarget,
    action: "pause" | "replace" | "freeze" | "continue-manually",
  ) => {
    const label = workflowActionLabel(action);
    if (activeThread) {
      void appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.lane.control",
        summary: `${label} requested for ${lane.role}`,
        payload: {
          laneId: lane.id,
          laneRole: lane.role,
          action,
          preserved: true,
        },
      }).catch(() => undefined);
    }
    void onSubmitPlanFollowUp({
      interactionMode: "workflow",
      text: [
        workflowActionInstruction(action, lane.role),
        "Keep the instruction Lead-visible, preserve the lane history, and update the workflow panel with the result.",
      ].join("\n"),
    });
  };

  const onWorkflowControl = (action: "pause" | "freeze" | "continue-manually") => {
    const label = workflowActionLabel(action);
    if (activeThread) {
      void appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.control",
        summary: `${label} requested for workflow`,
        payload: {
          action,
          preserved: true,
        },
      }).catch(() => undefined);
    }
    void onSubmitPlanFollowUp({
      interactionMode: "workflow",
      text: [
        workflowActionInstruction(action),
        "The Lead should summarize preserved work, unfinished work, verifier status, and any user action needed.",
      ].join("\n"),
    });
  };

  const onCustomizeWorkflow = (input: {
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
    subAgents: ReadonlyArray<{
      id: string;
      role: string;
      goal?: string;
      prompt: string;
      model?: string;
      reasoningEffort?: string;
      fastMode?: boolean;
      startsAfter: ReadonlyArray<string>;
    }>;
  }) => {
    if (activeThread) {
      void appendWorkflowActivity({
        threadId: activeThread.id,
        kind: "workflow.customized",
        summary: "Workflow customized",
        payload: {
          acceptanceCriteria: input.acceptanceCriteria,
          lanes: input.lanes,
          requireVerifierApproval: input.requireVerifierApproval,
          addRedTeamCritique: input.addRedTeamCritique,
          requireTestsBeforeFinal: input.requireTestsBeforeFinal,
          showMemoryAuditNotes: input.showMemoryAuditNotes,
          exploreParallelApproaches: input.exploreParallelApproaches,
          stopAfterPlanningForApproval: input.stopAfterPlanningForApproval,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          fastMode: input.fastMode,
          subAgents: input.subAgents,
        },
      }).catch(() => undefined);
    }
    const lines = [
      "Workflow customization updated.",
      input.acceptanceCriteria.length > 0
        ? `Acceptance criteria:\n${input.acceptanceCriteria.map((entry) => `- ${entry}`).join("\n")}`
        : "",
      input.lanes.length > 0 ? `Requested lanes: ${input.lanes.join(", ")}` : "",
      [
        "Verification:",
        `- Require verifier approval: ${input.requireVerifierApproval ? "yes" : "no"}`,
        `- Add red-team critique: ${input.addRedTeamCritique ? "yes" : "no"}`,
        `- Require tests or evidence before final: ${input.requireTestsBeforeFinal ? "yes" : "no"}`,
      ].join("\n"),
      `Memory:\n- Show memory write audit notes: ${input.showMemoryAuditNotes ? "yes" : "no"}`,
      [
        "Execution:",
        `- Explore multiple approaches in parallel: ${input.exploreParallelApproaches ? "yes" : "no"}`,
        `- Stop after planning for approval: ${input.stopAfterPlanningForApproval ? "yes" : "no"}`,
      ].join("\n"),
      [
        "Sub-agent model settings:",
        input.model ? `- Model: ${input.model}` : "",
        input.reasoningEffort ? `- Reasoning effort: ${input.reasoningEffort}` : "",
        `- Fast mode: ${input.fastMode ? "yes" : "no"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      input.subAgents.length > 0
        ? [
            "Approved sub-agents:",
            ...input.subAgents.map((agent) =>
              [
                `- ${agent.role}`,
                agent.goal ? `  Goal: ${agent.goal}` : "",
                `  Prompt: ${agent.prompt}`,
                `  Model: ${agent.model ?? input.model ?? "Use lead default"}`,
                `  Reasoning effort: ${agent.reasoningEffort ?? input.reasoningEffort ?? "Use lead default"}`,
                `  Fast mode: ${(agent.fastMode ?? input.fastMode) ? "yes" : "no"}`,
                `  Starts after: ${agent.startsAfter.length > 0 ? agent.startsAfter.join(", ") : "Lead approval / immediate launch"}`,
              ]
                .filter(Boolean)
                .join("\n"),
            ),
          ].join("\n")
        : "",
      "Keep these constraints Lead-visible and apply them to the remaining workflow.",
    ].filter(Boolean);
    void onSubmitPlanFollowUp({
      interactionMode: "workflow",
      text: lines.join("\n\n"),
    });
  };
  async function onSubmitPlanFollowUp({
    text,
    context,
    interactionMode: nextInteractionMode,
  }: {
    text: string;
    context?: ReturnType<typeof buildMessageContext>;
    interactionMode: ProviderInteractionMode;
  }) {
    if (
      !activeThread ||
      !isServerThread ||
      isSendBusy ||
      phase === "connecting" ||
      sendInFlightRef.current
    ) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable) {
      return false;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const threadIdForSend = activeThread.id;
    const messageIdForSend = newMessageId();
    // oxlint-disable-next-line react/purity -- Record the command execution time inside this async handler, never during render.
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: trimmed,
    });

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadIdForSend, null);

    anchorNewTurn(routeThreadKey, messageIdForSend);

    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(context ? { context } : {}),
        runId: null,
        createdAt: messageCreatedAt,
        updatedAt: messageCreatedAt,
        streaming: false,
      },
    ]);

    const settingsResult = await persistThreadSettingsForNextTurn({
      threadId: threadIdForSend,
      createdAt: messageCreatedAt,
      ...(localCheckoutBranchMismatch ? { branch: localCheckoutBranchMismatch.currentBranch } : {}),
      runtimeMode,
      interactionMode: nextInteractionMode,
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      settingsResult._tag === "Failure" ? settingsResult : null;

    if (failure === null) {
      // Keep the mode toggle and plan-follow-up banner in sync immediately
      // while the same-thread implementation turn is starting.
      setComposerDraftInteractionMode(
        scopeThreadRef(activeThread.environmentId, threadIdForSend),
        nextInteractionMode,
      );

      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            ...(context ? { context } : {}),
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          createdAt: messageCreatedAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      sendInFlightRef.current = false;
      resetLocalDispatch();
      return true;
    }

    setOptimisticUserMessages((existing) =>
      existing.filter((message) => message.id !== messageIdForSend),
    );
    if (!isAtomCommandInterrupted(failure)) {
      const error = squashAtomCommandFailure(failure);
      setThreadError(
        threadIdForSend,
        error instanceof Error ? error.message : "Failed to send plan follow-up.",
      );
    }
    sendInFlightRef.current = false;
    resetLocalDispatch();
    return false;
  }
  const appendWorkflowActivityFromEffect = useEffectEvent(appendWorkflowActivity);
  const launchWorkflowChildLaneFromEffect = useEffectEvent(launchWorkflowChildLane);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Persist handoff observations from independently running child threads.
  useEffect(() => {
    if (!activeThread || workflowChildCompletions.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const observation of workflowChildCompletions) {
        if (cancelled || observation.parentThreadId !== activeThread.id) continue;

        if (observation.needsHandoff) {
          const key = workflowCompletionKindKey("workflow.handoff", observation.completionKey);
          if (
            !workflowCompletionRecordedRef.current.has(key) &&
            !workflowCompletionInFlightRef.current.has(key)
          ) {
            workflowCompletionInFlightRef.current.add(key);
            await (async () => {
              const result = await appendWorkflowActivityFromEffect({
                threadId: activeThread.id,
                kind: "workflow.handoff",
                summary: `${observation.laneRole} handed results to Lead`,
                payload: {
                  laneId: observation.laneId,
                  laneRole: observation.laneRole,
                  childThreadId: observation.childThreadId,
                  childTurnId: observation.childTurnId,
                  sourceStartedActivityId: observation.startedActivityId,
                  cardType: "handoff",
                  title: `${observation.laneRole} handoff`,
                  detail: observation.detail,
                },
              }).catch(() => null);
              if (result && result._tag !== "Failure") {
                workflowCompletionRecordedRef.current.add(key);
              }
            })().finally(() => {
              workflowCompletionInFlightRef.current.delete(key);
            });
          }
        }

        if (observation.needsCompleted) {
          const key = workflowCompletionKindKey(
            "workflow.lane.completed",
            observation.completionKey,
          );
          if (
            !workflowCompletionRecordedRef.current.has(key) &&
            !workflowCompletionInFlightRef.current.has(key)
          ) {
            workflowCompletionInFlightRef.current.add(key);
            await (async () => {
              const result = await appendWorkflowActivityFromEffect({
                threadId: activeThread.id,
                kind: "workflow.lane.completed",
                summary: `${observation.laneRole} lane completed`,
                payload: {
                  laneId: observation.laneId,
                  laneRole: observation.laneRole,
                  childThreadId: observation.childThreadId,
                  childTurnId: observation.childTurnId,
                  sourceStartedActivityId: observation.startedActivityId,
                  cardType: "completion",
                  title: `${observation.laneRole} completed`,
                  detail: observation.summary,
                },
              }).catch(() => null);
              if (result && result._tag !== "Failure") {
                workflowCompletionRecordedRef.current.add(key);
              }
            })().finally(() => {
              workflowCompletionInFlightRef.current.delete(key);
            });
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeThread, workflowChildCompletions]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Start dependent workflow lanes when server activity confirms their prerequisites completed.
  useEffect(() => {
    if (!activeThread) return;
    if (!threadActivities.some((activity) => activity.kind === "workflow.started")) return;

    const { goal, plannedSubAgents } = latestWorkflowPlanDetails(
      threadActivities,
      activePlan?.explanation ?? "Workflow",
    );
    if (plannedSubAgents.length === 0) return;

    const completedLaneIds = workflowCompletedLaneIds(threadActivities);
    const startedLaneIds = workflowStartedChildLaneIds(threadActivities);
    const eligibleLanes = plannedSubAgents.filter((lane) => {
      const dependencies = lane.startsAfter ?? [];
      const laneLaunchKey = workflowLaneLaunchKey(activeThread.id, lane.id);
      return (
        dependencies.length > 0 &&
        dependencies.every((laneId) => completedLaneIds.has(laneId)) &&
        !startedLaneIds.has(lane.id) &&
        !workflowLaneLaunchRecordedRef.current.has(laneLaunchKey) &&
        !workflowLaneLaunchInFlightRef.current.has(laneLaunchKey)
      );
    });
    if (eligibleLanes.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const lane of eligibleLanes) {
        if (cancelled) return;
        const laneLaunchKey = workflowLaneLaunchKey(activeThread.id, lane.id);
        if (
          workflowLaneLaunchRecordedRef.current.has(laneLaunchKey) ||
          workflowLaneLaunchInFlightRef.current.has(laneLaunchKey) ||
          workflowStartedChildLaneIds(threadActivities).has(lane.id)
        ) {
          continue;
        }
        workflowLaneLaunchInFlightRef.current.add(laneLaunchKey);
        await (async () => {
          const childThreadId = await launchWorkflowChildLaneFromEffect({
            lane,
            workflowGoal: goal,
          });
          if (childThreadId) {
            workflowLaneLaunchRecordedRef.current.add(laneLaunchKey);
          }
        })().finally(() => {
          workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activePlan?.explanation,
    activeThread,
    threadActivities,
    workflowLaneLaunchInFlightRef,
    workflowLaneLaunchRecordedRef,
  ]);

  const onWorktreeSetupWorkLocally = () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running" || !draftId) {
      return;
    }
    void cancelWorktreeSetup().then((cancelled) => {
      if (cancelled) setWorkLocallyResendDraftId(draftId);
    });
  };
  const onWorktreeSetupWorkLocallyStable = useStableCallback(onWorktreeSetupWorkLocally);
  const onComposerSendStable = useStableCallback(
    (
      event?: Parameters<typeof onSend>[0],
      dispatch?: Parameters<typeof onSend>[1],
      intent?: Parameters<typeof onSend>[2],
      schedule?: ScheduledMessageSubmission,
    ) => onSend(event, dispatch, intent, undefined, schedule),
  );
  const sendPreviewAnnotation = (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => {
    void onSend(undefined, "auto", "foreground", { annotation, image });
  };
  const sendPreviewAnnotationStable = useStableCallback(sendPreviewAnnotation);
  const onComposerResumeStable = useStableCallback(onResume);
  const onComposerCompactContextStable = useStableCallback(onCompactContext);
  // Read from the projection the footer renders, so the scroll below sees the new message.
  const pendingGuestMessageIds =
    serverProjection?.thread.guestShare?.messages.flatMap((message) =>
      message.status === "pending" ? [message.id] : [],
    ) ?? [];
  const pendingGuestMessageCount = pendingGuestMessageIds.length;
  const pendingGuestMessageKey = pendingGuestMessageIds.join(",");
  const previousPendingGuestMessagesRef = useRef({
    threadKey: routeThreadKey,
    key: pendingGuestMessageKey,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the timeline list to the end when a new pending guest message joins its footer
  useEffect(() => {
    const previous = previousPendingGuestMessagesRef.current;
    previousPendingGuestMessagesRef.current = {
      threadKey: routeThreadKey,
      key: pendingGuestMessageKey,
    };
    // Opening another thread is not a new message; its own scroll position wins.
    if (previous.threadKey !== routeThreadKey) return;
    // Pending guest messages sit in the list footer, which the list does not follow on its own.
    // The follow flag reflects the owner's position before the footer grew; a live measure may not.
    // Any new id counts, even when another one was resolved in the same update.
    const previousIds = new Set(previous.key.split(","));
    const hasNewMessage = pendingGuestMessageKey
      .split(",")
      .some((id) => id !== "" && !previousIds.has(id));
    if (hasNewMessage && timelineLiveFollowEnabled) scrollToEnd(true);
  }, [routeThreadKey, pendingGuestMessageKey, timelineLiveFollowEnabled, scrollToEnd]);
  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    openExpandedImagePreview(routeThreadKey, preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);
  const queuedRunsControl =
    isServerThread && activeThread ? (
      <>
        <QueuedRunsControl
          ref={queuedRunsControlRef}
          steerShortcutLabel={shortcutLabelForCommand(keybindings, "thread.steerQueuedMessage", {
            context: { terminalFocus: false },
          })}
          editShortcutLabel={shortcutLabelForCommand(keybindings, "thread.editQueuedMessage", {
            context: { composerFocus: true },
          })}
          environmentId={activeThread.environmentId}
          threadId={activeThread.id}
          optimisticMessages={optimisticUserMessages}
          editingRunId={queuedRunEdit.editingRunId}
          editBlockedReason={queuedRunEditBlockedReason(
            { openQuestionCount: pendingUserInputs.length },
            messages,
          )}
          onEditQueuedRun={queuedRunEdit.beginEdit}
          onCancelEdit={queuedRunEdit.cancelEdit}
          timestampFormat={timestampFormat}
          onOpenThread={onOpenRelatedThreadStable}
          onImageExpand={onExpandTimelineImageStable}
        />
      </>
    ) : null;
  const resendAfterWorkLocally = () => {
    setWorkLocallyResendDraftId(null);
    void onComposerSendStable();
  };
  const resendAfterWorkLocallyStable = useStableCallback(resendAfterWorkLocally);
  const workLocallyResendReady =
    workLocallyResendDraftId !== null &&
    workLocallyResendDraftId === draftId &&
    isLocalDraftThread &&
    !isSendBusy &&
    !isRevertingCheckpoint &&
    !threadDetailLoading &&
    clientSettingsHydrated &&
    !needsLoadBalancing &&
    !activeEnvironmentUnavailable &&
    !activePendingUserInput &&
    !feedbackUploading;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- switches the draft to local mode, then resends the waiting message once sending is idle
  useEffect(() => {
    if (
      !workLocallyResendReady ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      return;
    }
    if (sendEnvMode !== "local") {
      setDraftThreadContext(composerDraftTarget, { envMode: "local", startFromOrigin: false });
      return;
    }
    resendAfterWorkLocallyStable();
  }, [
    composerDraftTarget,
    feedbackUploadsInFlightRef,
    resendAfterWorkLocallyStable,
    sendInFlightRef,
    routeThreadKey,
    sendEnvMode,
    setDraftThreadContext,
    workLocallyResendReady,
  ]);

  const shownThreadSyncPhase = activeEnvironmentUnavailable ? null : delayedThreadSyncPhase;
  const hasThreadNow =
    attentionNow !== null || workNow !== null || goalNow !== null || shownThreadSyncPhase !== null;
  const queuedRunCount = serverProjection ? getUserQueuedThreadRuns(serverProjection).length : 0;
  // The queue control is mounted for every server thread but joins the footer only while it shows
  // something, by its own rule: an optimistic message stops counting once the server has it.
  const hasQueuedTurns =
    queuedRunCount > 0 ||
    optimisticUserMessages.some(
      (message) =>
        message.inputIntent === "queued_turn" &&
        !serverProjection?.messages.some((committed) => committed.id === message.id),
    );
  const scrollToEndSummary =
    [
      childInputNow?.waitingLabel ?? null,
      queuedRunCount === 0
        ? null
        : gt("{count, plural, one {{count} queued} other {{count} queued}}", {
            count: queuedRunCount,
          }),
    ]
      .filter((part) => part !== null)
      .join(" · ") || null;
  // The end of the timeline holds the thread's present and next turns: what it is doing now,
  // its lifecycle status, guest messages awaiting you, then your queued messages.
  const timelineFooter =
    pendingHandoff === null &&
    !hasThreadNow &&
    threadStatusLine === null &&
    pendingGuestMessageCount === 0 &&
    !hasQueuedTurns ? null : (
      <>
        {pendingHandoff === null ? null : (
          <div className="chat-content-lane">
            <HandoffRow
              environmentId={environmentId}
              endpoints={pendingHandoff}
              providers={providerStatuses}
              pending
            />
          </div>
        )}
        <ThreadNow
          key={routeThreadKey}
          attention={attentionNow}
          work={workNow}
          syncPhase={shownThreadSyncPhase}
          goal={goalNow}
        />
        {threadStatusLine}
        {pendingGuestMessageCount > 0 && isServerThread && activeThread ? (
          <GuestPendingMessages
            threadRef={scopeThreadRef(activeThread.environmentId, activeThread.id)}
            onImageExpand={onExpandTimelineImageStable}
            onFileOpen={openFileAttachmentStable}
          />
        ) : null}
        {hasQueuedTurns ? queuedRunsControl : null}
      </>
    );

  const pendingSidebarFileDrops = useSidebarPendingFileDropStore((state) => state.pending);
  const consumePendingFileDrop = useSidebarPendingFileDropStore(
    (state) => state.consumePendingFileDrop,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands pending sidebar file drops to the composer's imperative API once it mounts
  useEffect(() => {
    if (pendingSidebarFileDrops.length === 0) return;
    if (
      typeof composerDraftTarget === "string" ||
      !pendingSidebarFileDrops.some((drop) =>
        isSameSidebarThreadRef(composerDraftTarget, drop.threadRef),
      )
    ) {
      return;
    }
    if (!activeThread) return;
    if (!composerRef.current) {
      const raf = window.requestAnimationFrame(() => {
        if (!composerRef.current || typeof composerDraftTarget === "string") return;
        const files = consumePendingFileDrop(composerDraftTarget);
        if (files !== null) composerRef.current?.addDroppedFiles(files);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const files = consumePendingFileDrop(composerDraftTarget);
    if (files !== null) composerRef.current.addDroppedFiles(files);
  }, [
    activeThread,
    composerDraftTarget,
    composerRef,
    consumePendingFileDrop,
    pendingSidebarFileDrops,
  ]);

  const addDroppedFilesToComposer = useStableCallback(
    (files: Parameters<ChatComposerHandle["addDroppedFiles"]>[0]) =>
      composerRef.current?.addDroppedFiles(files),
  );
  const addDroppedFoldersToComposer = useStableCallback(
    (folders: Parameters<ChatComposerHandle["addDroppedFolders"]>[0]) =>
      composerRef.current?.addDroppedFolders(folders),
  );
  // Above the early return, where React Compiler can cache it for the side chat pane.
  const sideChatParentPanel = {
    openToolDiff: onOpenToolDiffStable,
    runShellCommand: runSideChatShellCommandStable,
  };

  if (!activeThread) {
    return embedded ? null : <NoActiveThreadState />;
  }

  const rightPanelContent = activeThreadRef ? (
    activeRightPanelSurface?.kind === "plan" ? (
      <PlanSidebar
        activePlan={activePlan}
        activeProposedPlan={sidebarProposedPlan}
        activities={threadActivities}
        workflowLaneRunDetails={workflowLaneRunDetailsForSidebar}
        label={planSidebarLabel}
        workflowActive={workflowSidebarActive}
        currentModelSelection={activeThread?.modelSelection}
        environmentId={environmentId}
        threadRef={activeThreadRef}
        markdownCwd={gitCwd ?? undefined}
        workspaceRoot={activeWorkspaceRoot}
        timestampFormat={timestampFormat}
        mode="embedded"
        onSubmitWorkflowGuidance={onSubmitWorkflowGuidance}
        onStopWorkflowLane={onStopWorkflowLane}
        onStopWorkflow={onStopWorkflow}
        onWorkflowLaneControl={onWorkflowLaneControl}
        onWorkflowControl={onWorkflowControl}
        onOpenTestsPanel={openTestsPanel}
        onCustomizeWorkflow={onCustomizeWorkflow}
        onStartWorkflow={onStartWorkflow}
      />
    ) : activeRightPanelSurface?.kind === "media" ? (
      <MediaPanel
        artifacts={displayableThreadMediaArtifacts}
        environmentId={activeThread.environmentId}
        threadRef={activeThreadRef}
        composerTarget={composerDraftTarget}
        activeArtifactKey={selectedMediaArtifactKey}
        onActiveArtifactKeyChange={setSelectedMediaArtifactKey}
      />
    ) : activeRightPanelSurface?.kind === "tests" ? (
      <TestHarnessRunsPanel
        projectId={activeProject?.id}
        projectCwd={activeProject?.workspaceRoot}
      />
    ) : (
      <RightPanelSurfaceContent
        surface={renderedRightPanelSurface}
        activeSurfaceId={activeRightPanelSurface?.id ?? null}
        threadRef={activeThreadRef}
        environmentId={activeThread.environmentId}
        visible={rightPanelOpen}
        composerDraftTarget={composerDraftTarget}
        keybindings={keybindings}
        configuredPreviewUrls={configuredPreviewUrls}
        workspaceMutationId={workspaceMutationId}
        getShortcutContext={getShortcutContextStable}
        onSendAnnotation={sendPreviewAnnotationStable}
        onCloseSurface={closeRightPanelSurface}
        sideChatParentPanel={sideChatParentPanel}
        terminal={{
          launchContext: activeTerminalLaunchContext ?? null,
          keybindings,
          onAddTerminalContext: addTerminalContextToDraftStable,
          onSplitTerminal: splitPanelTerminalStable,
          onSplitTerminalVertical: splitPanelTerminalVerticalStable,
          onNewTerminal: addTerminalSurfaceStable,
          onActiveTerminalChange: activatePanelTerminalStable,
          onCloseTerminal: closePanelTerminalStable,
          splitShortcutLabel: splitTerminalShortcutLabel ?? undefined,
          splitVerticalShortcutLabel: splitTerminalVerticalShortcutLabel ?? undefined,
          newShortcutLabel: newTerminalShortcutLabel ?? undefined,
          closeShortcutLabel: closeTerminalShortcutLabel ?? undefined,
        }}
        pullRequest={{
          capabilityKnown: pullRequestsCapabilityKnown,
          supported: supportsPullRequests,
          projectId: activeThread.projectId,
          pullRequests: visiblePullRequests,
          linkedPullRequest: linkedThreadPullRequest,
          branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
          onBack:
            pullRequestsSurfaceAvailable && visiblePullRequestCount > 1
              ? addPullRequestsSurfaceStable
              : undefined,
        }}
        issuesSupported={serverConfig?.environment.capabilities.issues === true}
        files={{
          projectId: activeProject?.id,
          projectName: activeProject?.title ?? null,
          workspaceRoot: activeWorkspaceRoot,
          availableEditors,
          pendingSurfaceIds: pendingFileSurfaceIds,
          onOpenFile: openFileSurfaceStable,
          onPendingChange: handleFilePendingChangeStable,
        }}
      />
    )
  ) : null;
  const panelToggleControlProps = {
    terminalAvailable: activeProject !== null,
    terminalOpen: terminalUiState.terminalOpen,
    terminalShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.toggle"),
    threadPanelOpen,
    threadPanelPresentation,
    threadPanelPopoverHandle,
    threadPanelShortcutLabel: shortcutLabelForCommand(keybindings, "threadPanel.toggle"),
    rightPanelAvailable: activeProject !== null,
    rightPanelOpen,
    rightPanelShortcutLabel: shortcutLabelForCommand(keybindings, "rightPanel.toggle"),
    onToggleTerminal: toggleTerminalVisibilityStable,
    onToggleThreadPanel: toggleThreadPanelStable,
    onToggleRightPanel: toggleRightPanelStable,
  } satisfies PanelLayoutControlsProps;
  const panelToggleControls = (
    <PanelLayoutControls
      {...panelToggleControlProps}
      showThreadPanelControl={!inlineRightPanelOwnsTitleBar}
    />
  );
  const threadPanelHeaderControl = <ThreadPanelHeaderControl {...panelToggleControlProps} />;
  const panelLayoutControls = (
    <WorkspaceTitlebarControls
      showMaximizeControl={!shouldUsePlanSidebarSheet}
      rightPanelOpen={rightPanelOpen}
      animationsActive={panelAnimationsActive}
      maximized={rightPanelMaximized}
      onToggleMaximized={toggleRightPanelMaximizedStable}
    >
      {panelToggleControls}
    </WorkspaceTitlebarControls>
  );
  const workspaceFileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: addDroppedFilesToComposer,
    addFolders: addDroppedFoldersToComposer,
  });

  const content = (
    <div
      ref={setWorkspaceLayoutElement}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      {embedded ? null : (
        <DeviceSetupDialogHost
          threadKey={activeThreadKey}
          threadRef={activeThreadRef}
          state={deviceState}
        />
      )}
      {rightPanelControlsAtRoot && !embedded ? panelLayoutControls : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-x-hidden",
          rightPanelMaximized ? "w-0 flex-none" : "flex-1",
        )}
        data-chat-column-maximized-away={rightPanelMaximized ? "true" : "false"}
        data-chat-column
        inert={rightPanelMaximized}
        onMouseUp={preventMiddleClickPasteOutsideEditable}
      >
        {embedded ? null : (
          <header
            ref={threadPanelPopoverAnchorRef}
            data-chat-header
            className={cn(
              "relative bg-background [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
              isElectron
                ? cn(
                    "drag-region flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center px-3 sm:px-5",
                    reserveTitleBarControlInset &&
                      !inlineRightPanelOwnsTitleBar &&
                      "wco:pr-(--workspace-native-controls-inset)",
                  )
                : "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            {isElectron && rightPanelControlsAtRoot ? (
              <span
                aria-hidden
                className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
              />
            ) : null}
            {!rightPanelControlsAtRoot && !rightPanelControlsInPanel ? panelLayoutControls : null}
            {inlineRightPanelOwnsTitleBar ? threadPanelHeaderControl : null}
            <ChatHeader
              activeThreadStartedBy={activeThread.startedBy ?? null}
              activeProjectId={activeProject?.id}
              openInCwd={activeWorkspaceRoot ?? null}
              activeProjectScripts={activeProjectScripts}
              preferredScriptId={
                activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
              }
              keybindings={keybindings}
              availableEditors={availableEditors}
              gitCwd={gitCwd}
              activeProjectTestEnvironments={activeProject?.testEnvironments ?? []}
              onRunProjectScript={runProjectScriptStable}
              onAddProjectScript={saveProjectScriptStable}
              onUpdateProjectScript={updateProjectScriptStable}
              onDeleteProjectScript={deleteProjectScriptStable}
              onUpdateProjectTestEnvironments={saveProjectTestEnvironments}
              onOpenTestsPanel={openTestsPanel}
              activeThreadEnvironmentId={activeThread.environmentId}
              activeThreadId={activeThread.id}
              isServerThread={isServerThread}
              activeThreadTitle={activeThread.title}
              activeThreadLinkOrigin={activeThreadShell?.linkOrigin?.label ?? null}
              activeProject={activeProject ?? null}
              parentThreadLink={headerParentThreadLink}
              onOpenThread={onOpenRelatedThreadStable}
              rightPanelOpen={inlineRightPanelOwnsTitleBar}
              onNewThreadInProject={handleNewThreadInActiveProjectStable}
              {...(activeDraftLogicalProjectKey
                ? { onOpenProjectSettings: handleOpenDraftProjectSettingsStable }
                : {})}
              {...(threadFindEnabled ? { onFindInThread: openThreadFindStable } : {})}
            />
          </header>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <ThreadFindCanvas
            findOptions={{
              skills: timelineSkills,
              progressive: serverConfig?.threadFindProgressive === true,
              thread: activeThreadRef,
              enabled: threadFindEnabled,
            }}
            store={chatCanvasStore}
            threadRef={activeThreadRef}
            preview={canvasPreview}
            detailsCardTopInset={isThreadFindActive ? THREAD_FIND_BAR_RESERVED_HEIGHT : 0}
            composerOverlayElement={isDraftHeroState ? null : composerOverlayElement}
            data-chat-workspace-drop-target="true"
            onDragEnter={workspaceFileDropHandlers.onDragEnter}
            onDragOver={workspaceFileDropHandlers.onDragOver}
            onDragLeave={workspaceFileDropHandlers.onDragLeave}
            onDrop={workspaceFileDropHandlers.onDrop}
          >
            <ThreadFind onClose={focusComposerStable} />
            {isWorkspaceFileDragActive ? <WorkspaceFileDropOverlay /> : null}
            <ChatBannerLane
              environmentId={activeThread.environmentId}
              providerStatus={visibleProviderStatus}
              providerStatusDismissalKey={providerStatusDismissalKey}
              onOpenProviderSetup={openProviderSetupStable}
              threadId={activeThread.id}
              threadError={timelineThreadError}
              threadErrorClass={
                threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorClass ?? null) : null
              }
              threadErrorCode={
                threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorCode ?? null) : null
              }
              threadErrorBannerKey={threadErrorBannerKey}
              setThreadError={setThreadError}
              setThreadErrorBannerDismissTick={setThreadErrorBannerDismissTick}
            />
            <div
              {...conversationArea}
              className="relative flex min-h-0 flex-1 flex-col bg-background"
            >
              <WorkspaceMutationIdContext value={workspaceMutationId}>
                <ThreadTimeline
                  onOpenTestsPanel={openTestsPanel}
                  pendingApprovals={pendingApprovals}
                  heldApprovalRequestIds={heldApprovalRequestIds}
                  respondingRequestIds={respondingRequestIds}
                  onRespondToApproval={onRespondToApprovalStable}
                  canOperateThread={canOperateThread}
                  threadDetailRef={routeThreadDetailRef}
                  entriesInput={timelineEntriesInput}
                  draftEntries={isServerThread ? null : draftTimelineEntries}
                  activeThreadKey={activeThreadKey}
                  syncing={threadSyncPhase !== null}
                  detailLoading={threadDetailLoading}
                  citationRequest={citationRequest}
                  citationHistory={citationHistory}
                  onCiteAssistantText={citeAssistantTextStable}
                  onReplyToResponse={replyToResponseStable}
                  {...(activeProject
                    ? { onRunShellCommand: parentPanel?.runShellCommand ?? runShellCommandStable }
                    : {})}
                  isWorking={isWorking}
                  runlessWorkActive={runlessWorkStartedAt !== null}
                  isCompacting={isCompacting}
                  awaitingUser={
                    activePendingApproval !== null
                      ? "approval"
                      : activePendingUserInput !== null ||
                          // A secret request has no runtime request; the shell carries it.
                          activeThreadShell?.hasPendingUserInput === true
                        ? "input"
                        : null
                  }
                  awaitingRequestId={
                    activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? null
                  }
                  activeTurnStartedAt={activeWorkStartedAt}
                  providerStartingLabel={
                    activeActivityRun?.providerStartingLabelMsg
                      ? messages(activeActivityRun.providerStartingLabelMsg)
                      : null
                  }
                  worktreeSetup={worktreeSetup}
                  onCancelWorktreeSetup={onCancelWorktreeSetupStable}
                  retryableWorkspacePreparationRunIds={retryableWorkspacePreparationRunIds}
                  onRetryWorkspacePreparation={onRetryWorkspacePreparationStable}
                  {...(draftId
                    ? { onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocallyStable }
                    : {})}
                  {...(onOpenWorktreeSetupTerminal ? { onOpenWorktreeSetupTerminal } : {})}
                  isPreparingWorktree={isPreparingWorktree}
                  footer={timelineFooter}
                  listRef={legendListRef}
                  runs={serverProjection?.runs ?? []}
                  latestRun={activeActivityRun}
                  announcedRun={announcedRun(activeActivityRun, serverProjection?.runs ?? [])}
                  detailBehindShell={isDetailBehindShell(
                    activeLatestRun,
                    activeThreadShell?.latestRun ?? null,
                  )}
                  runningRunId={activeRunningTurnId}
                  turnDiffSummaries={turnDiffSummaries}
                  activeThreadEnvironmentId={
                    displayedThreadRef?.environmentId ?? activeThread.environmentId
                  }
                  routeThreadKey={displayedTimelineKey}
                  displayThreadKey={displayedTimelineKey}
                  announceTurnStatus={!isProviderSubagent}
                  onOpenToolDiff={parentPanel?.openToolDiff ?? onOpenToolDiffStable}
                  // Side chat runs keep no checkpoints to diff, and a fork would promote the side chat.
                  {...(embedded
                    ? {}
                    : { onOpenTurnDiff: onOpenTurnDiffStable, onForkFromRun: onForkFromRunStable })}
                  onOpenThread={onOpenRelatedThreadStable}
                  parentThreadLink={parentThreadLink}
                  workflowOpening={workflowOpening}
                  supportsConversationRollback={supportsConversationRollback}
                  threadStartCheckpointAvailable={threadStartCheckpointAvailable}
                  availableRevertTurnCounts={availableRevertTurnCounts}
                  onRevertToTurnCount={onRevertTimelineTurnStable}
                  onUseArtifactTemplate={insertArtifactTemplateStable}
                  onSendAppMessage={sendAppMessageStable}
                  isRevertingCheckpoint={isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImageStable}
                  onFileOpen={openFileAttachmentStable}
                  onFileDownload={downloadFileAttachmentStable}
                  markdownCwd={gitCwd ?? undefined}
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={activeWorkspaceRoot}
                  skills={timelineSkills}
                  anchorMessageId={timelineAnchorMessageId}
                  onAnchorReady={onTimelineAnchorReadyStable}
                  onAnchorSizeChanged={onTimelineAnchorSizeChangedStable}
                  contentInsetEndAdjustment={composerTimelineInset}
                  liveFollowEnabled={timelineLiveFollowEnabled}
                  onIsAtEndChange={onIsAtEndChangeStable}
                  onViewportAttach={attachTimelineViewport}
                  onFooterGrow={onTimelineFooterGrowStable}
                  hideEmptyPlaceholder={isDraftHeroState || threadDetailLoading}
                  emptyPlaceholderInset={composerReservedHeight}
                  topFadeEnabled={!hasTimelineTopBanner}
                  {...(threadHistoryControls === undefined
                    ? {}
                    : { historyControls: threadHistoryControls })}
                />
              </WorkspaceMutationIdContext>

              {showScrollToBottom && !isThreadFindActive && (
                <ScrollToEndButton
                  bottom={scrollToEndClearance + 4}
                  summary={scrollToEndSummary}
                  onScrollToEnd={() => scrollToEnd(true)}
                />
              )}
            </div>

            <div
              {...workspaceAreaProps(
                "composer",
                2,
                showProviderSubagentBar ? "Subagent" : undefined,
              )}
              ref={(overlay: HTMLDivElement | null) => {
                setComposerOverlayElement(overlay);
                attachFollowComposerOverlay(overlay);
              }}
              inert={isRevertingCheckpoint}
              data-chat-composer-overlay="true"
              className={
                isDraftHeroState
                  ? "pointer-events-none absolute inset-0 z-20 flex items-center [@media(max-height:34rem)]:items-end"
                  : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
              }
            >
              <div ref={draftHeroTransitionGroupRef} className="chat-composer-lane w-full">
                <div
                  data-chat-composer-stack="true"
                  className="group/composer-stack pointer-events-auto relative z-10 mx-auto w-full max-w-(--chat-content-max-width)"
                >
                  {isDraftHeroState ? (
                    <div className="absolute inset-x-0 bottom-full">
                      <div
                        className="pb-4 group-has-data-[composer-shoulder-tab]/composer-stack:pb-0"
                        style={
                          forceExpandedMobileComposer
                            ? { viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME }
                            : undefined
                        }
                      >
                        <DraftHeroHeadline
                          draftId={draftId}
                          activeProjectRef={activeProjectRef}
                          activeProjectTitle={activeProject?.title ?? null}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div
                    ref={draftHeroComposerAnchorRef}
                    className="relative z-10"
                    style={
                      forceExpandedMobileComposer
                        ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                        : undefined
                    }
                  >
                    {isServerThread && activeProject ? (
                      <ThreadRecurringSchedulesPanel
                        refreshKey={scheduledMessageVersion}
                        environmentId={environmentId}
                        projectId={activeProject.id}
                        threadId={activeThread.id}
                      />
                    ) : null}
                    <ChildThreadApprovals threadRef={activeThreadRef} />
                    <div className="relative">
                      <ComposerSurface.Shell contextRow={showComposerContextStrip}>
                        <ComposerSurface.Host
                          inert={queuedRunEdit.isSaving}
                          aria-busy={queuedRunEdit.isSaving}
                        >
                          <div className="relative z-10">
                            {showProviderSubagentBar ? (
                              <ProviderSubagentBar
                                provider={selectedProviderEntry ?? null}
                                showInstanceBadge={
                                  selectedProviderEntry !== undefined &&
                                  shouldShowInstanceBadge(
                                    selectedProviderEntry,
                                    providerInstanceEntries,
                                  )
                                }
                                modelLabel={providerSubagentModelLabel}
                                effortLabel={providerSubagentEffortLabel}
                                status={providerSubagentStatus}
                                onOpenParent={parentThreadLink?.open ?? null}
                                actions={
                                  selectedProviderEntry?.driverKind === "antigravity" ? (
                                    <NativeChildWorkDialog
                                      environmentId={environmentId}
                                      threadId={threadId}
                                    />
                                  ) : null
                                }
                              />
                            ) : null}
                            {!composerMounted ? null : (
                              <ChatComposer
                                interactionMode={interactionMode}
                                handleInteractionModeChange={handleInteractionModeChange}
                                planSidebarOpen={planSidebarOpen}
                                planSidebarLabel={planSidebarLabel}
                                togglePlanSidebar={togglePlanSidebar}
                                supportsThreadRecurringSchedules={supportsThreadRecurringSchedules}
                                canOperateThread={canOperateThread}
                                reportedModelSelection={reportedModelSelection}
                                multipleModelSelections={multipleModelSelections}
                                supportsMultipleModels={
                                  serverConfig?.environment.capabilities
                                    .requiredWorktreeBootstrap === true
                                }
                                onMultipleModelSelectionsChange={setMultipleModelSelectionsStable}
                                composerRef={composerRef}
                                composerDraftTarget={composerDraftTarget}
                                environmentId={environmentId}
                                attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                                supportsAttachmentUploads={supportsAttachmentUploads}
                                supportsQuestionAttachments={supportsQuestionAttachments}
                                maxFileAttachmentBytes={maxFileAttachmentBytes}
                                routeKind={routeKind}
                                routeThreadRef={routeThreadRef}
                                draftId={draftId}
                                activeThreadId={activeThreadId}
                                activeThread={activeThread}
                                activeThreadRuns={serverProjection?.runs ?? EMPTY_RUNS}
                                promptHistoryEntries={timelineEntries}
                                forceExpandedOnMobile={
                                  forceExpandedMobileComposer && isDraftHeroState
                                }
                                projectSelectionRequired={
                                  isLocalDraftThread && activeProject === null
                                }
                                phase={phase}
                                canSteer={!compactionBlocksSteer}
                                canInterrupt={canInterruptRunningThread}
                                isSendBusy={
                                  (isSendBusy && !sendQueuesBehindSetup) ||
                                  (setupQueueSendThreadKey !== null &&
                                    setupQueueSendThreadKey === activeThreadKey) ||
                                  queuedRunEdit.isSaving ||
                                  isResuming
                                }
                                canResume={canResume}
                                isRevertingCheckpoint={isRevertingCheckpoint}
                                sendDisabledReason={
                                  !canOperateThread
                                    ? gt("This connection cannot change threads.")
                                    : isEnvironmentChanging
                                      ? gt("Preparing machine")
                                      : isRevertingCheckpoint
                                        ? gt("Rewinding conversation")
                                        : feedbackUploading
                                          ? gt("Sending feedback")
                                          : threadDetailLoading
                                            ? gt("Messages loading")
                                            : worktreeSetupBlocksSend
                                              ? gt("Preparing worktree")
                                              : projectCloneSendBlockReason
                                }
                                isPreparingWorktree={isPreparingWorktree && !sendQueuesBehindSetup}
                                bannerItems={
                                  isDraftHeroState || composerBannerItems.length === 0
                                    ? EMPTY_COMPOSER_BANNER_ITEMS
                                    : composerBannerItems
                                }
                                resumeCompactionTokens={resumeCompactionTokens}
                                keepFullHistory={keepFullHistory}
                                onToggleKeepFullHistory={toggleKeepFullHistoryStable}
                                sideChatAvailable={sideChat.available}
                                sideChatDisabledReason={sideChatDisabledReason}
                                onFreshSession={
                                  freshSessionCommandAvailable ? armFreshSessionStable : undefined
                                }
                                onUsageLimitsCommand={
                                  usageLimitsOffered &&
                                  usageLimitsKey !== null &&
                                  !composerHasNonPromptContent
                                    ? openUsageLimits
                                    : undefined
                                }
                                environmentUnavailable={activeEnvironmentUnavailableState}
                                activePendingApproval={activePendingApproval}
                                pendingApprovals={pendingApprovals}
                                onHeldRequestIdsChange={onHeldRequestIdsChange}
                                pendingUserInputs={pendingUserInputs}
                                activePendingIsResponding={activePendingIsResponding}
                                respondingRequestIds={respondingRequestIds}
                                runtimeMode={runtimeMode}
                                defaultRuntimeMode={defaultRuntimeMode}
                                lockedProvider={modelPickerLockedProvider}
                                providerStatuses={providerStatuses as ServerProvider[]}
                                providerCatalogKnown={serverConfig !== null}
                                activeProjectDefaultModelSelection={
                                  activeProjectDefaultModelSelection
                                }
                                activeThreadModelSelection={activeThread?.modelSelection}
                                activeProjectId={activeProject?.id ?? null}
                                projectName={activeProject?.title}
                                compactThreadUnavailable={compactThreadUnavailable}
                                compactDisabled={compactDisabled}
                                resolvedTheme={resolvedTheme}
                                settings={settings}
                                keybindings={keybindings}
                                getShortcutContext={getShortcutContextStable}
                                terminalOpen={Boolean(terminalUiState.terminalOpen)}
                                gitCwd={gitCwd}
                                pullRequestProjectId={
                                  supportsPullRequests ? (activeProject?.id ?? null) : null
                                }
                                pullRequestRepository={
                                  supportsPullRequests ? activeProjectRepository : null
                                }
                                threadPullRequests={
                                  (activeThreadShell ?? activeThread)?.pullRequests
                                }
                                onComposerOverlayHeightChange={publishComposerOverlayHeightStable}
                                permissionsShownInStrip={
                                  showComposerContextStrip && !isServerThread
                                }
                                promptRef={promptRef}
                                composerImagesRef={composerImagesRef}
                                composerFilesRef={composerFilesRef}
                                composerTerminalContextsRef={composerTerminalContextsRef}
                                onPageScrollKeyDown={onComposerPageScrollKeyDownStable}
                                onPageScrollKeyUp={onComposerPageScrollKeyUpStable}
                                onPageScrollRelease={onComposerPageScrollReleaseStable}
                                onCompactContext={onComposerCompactContextStable}
                                onSend={onComposerSendStable}
                                onResume={onComposerResumeStable}
                                onInterrupt={onInterruptStable}
                                onSelectActivePendingUserInputOption={
                                  onSelectActivePendingUserInputOptionStable
                                }
                                onAdvanceActivePendingUserInput={
                                  onAdvanceActivePendingUserInputStable
                                }
                                onDismissActivePendingUserInput={onDismissUserInputStable}
                                onPreviousActivePendingUserInputQuestion={
                                  onPreviousActivePendingUserInputQuestionStable
                                }
                                onChangeActivePendingUserInputCustomAnswer={
                                  onChangeActivePendingUserInputCustomAnswer
                                }
                                onProviderModelSelect={onProviderModelSelectStable}
                                onOpenProviderSetup={openProviderSetupStable}
                                getModelDisabledReason={getModelDisabledReason}
                                handleRuntimeModeChange={handleRuntimeModeChangeStable}
                                focusComposer={focusComposerStable}
                                scheduleComposerFocus={scheduleComposerFocusStable}
                                setThreadError={setThreadError}
                                onExpandImage={onExpandTimelineImageStable}
                                onFileOpen={openFileAttachmentStable}
                                editingQueuedAttachments={queuedRunEdit.editingAttachments}
                                onRemoveEditingQueuedAttachment={
                                  queuedRunEdit.removeEditingAttachment
                                }
                              />
                            )}
                          </div>
                        </ComposerSurface.Host>
                        <div className="min-h-0">
                          <div
                            data-terminal-open={terminalUiState.terminalOpen ? "true" : undefined}
                            className="relative z-0"
                          >
                            {showComposerContextStrip && (
                              <div className="pointer-events-auto">
                                <BranchToolbar
                                  forceNewWorktree={multipleModelSelections !== null}
                                  ref={branchToolbarRef}
                                  environmentId={activeThread.environmentId}
                                  threadId={activeThread.id}
                                  projectId={activeThread.projectId}
                                  worktreePath={activeThread.worktreePath}
                                  isServerThread={isServerThread}
                                  showGitControls={isGitRepo}
                                  {...(routeKind === "draft" && draftId ? { draftId } : {})}
                                  onEnvModeChange={onEnvModeChangeStable}
                                  startFromOrigin={startFromOrigin}
                                  onStartFromOriginChange={onStartFromOriginChange}
                                  envMode={envMode}
                                  {...(canOverrideServerThreadEnvMode
                                    ? {
                                        activeThreadBranchOverride: activeThreadBranch,
                                        onActiveThreadBranchOverrideChange:
                                          setPendingServerThreadBranch,
                                      }
                                    : {})}
                                  envLocked={envLocked}
                                  onComposerFocusRequest={scheduleComposerFocusStable}
                                  {...(canCheckoutPullRequestIntoThread
                                    ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                                    : {})}
                                  {...(canChangeEnvironment
                                    ? { onEnvironmentChange: onEnvironmentChangeStable }
                                    : {})}
                                  autoEnvironmentLabel={autoEnvironmentLabel}
                                  onAutoEnvironment={
                                    draftId &&
                                    !envLocked &&
                                    canAutoBalanceEnvironments &&
                                    loadBalancingSettings.loadBalancingEnabled
                                      ? onAutoEnvironmentStable
                                      : undefined
                                  }
                                  availableEnvironments={logicalProjectEnvironments}
                                  {...(isServerThread
                                    ? {}
                                    : {
                                        trailing: (
                                          <ComposerContextPermissions
                                            environmentId={environmentId}
                                            runtimeMode={runtimeMode}
                                            supportedRuntimeModes={
                                              activeProviderStatus?.supportedRuntimeModes
                                            }
                                            onRuntimeModeChange={handleRuntimeModeChangeStable}
                                          />
                                        ),
                                      })}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </ComposerSurface.Shell>
                      {isDraftHeroState && composerBannerItems.length > 0 ? (
                        // Out of flow, like the headline, so a notice never moves the centered composer.
                        // Short windows pin the composer to the bottom, where an out-of-flow notice
                        // would fall off-screen, so there it takes space and lifts the composer.
                        <div className="absolute inset-x-0 top-full flex flex-col gap-1 pt-4 [@media(max-height:34rem)]:static">
                          <ComposerBannerStack items={composerBannerItems} detached />
                        </div>
                      ) : null}
                    </div>
                    <div
                      aria-hidden
                      className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {canOperatePreview && activeThreadRef && activeEnvironmentServerBrowser && !embedded ? (
              <PreviewSessionSync threadRef={activeThreadRef} />
            ) : null}
            {activeThreadRef && shownPreviewMiniPlayer && !embedded ? (
              <ThreadPreviewMiniPlayer
                key={`${activeThreadKey}:${previewMiniPlayerSourceKey(shownPreviewMiniPlayer.source)}`}
                threadRef={activeThreadRef}
                miniPlayer={shownPreviewMiniPlayer}
              />
            ) : null}

            {embedded ? null : (
              <>
                <BranchRestoreConfirmHost
                  threadKey={activeThreadKey}
                  threadBranch={localCheckoutBranchMismatch?.threadBranch ?? ""}
                  canWriteSourceControl={canWriteSourceControl}
                  onConfirm={handleSwitchCheckoutToThreadStable}
                />

                <ThreadDetailsPanel
                  anchor={threadPanelPopoverAnchorRef}
                  handle={threadPanelPopoverHandle}
                  forceNewWorktree={multipleModelSelections !== null}
                  environmentId={activeThread.environmentId}
                  threadId={activeThread.id}
                  projectId={activeThread.projectId}
                  worktreePath={activeThread.worktreePath}
                  isServerThread={isServerThread}
                  {...(draftId ? { draftId } : {})}
                  composerDraftTarget={composerDraftTarget}
                  activeProjectName={activeProject?.title}
                  activeProjectScripts={activeProject ? activeProjectScripts : undefined}
                  preferredScriptId={
                    activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
                  }
                  keybindings={keybindings}
                  availableEditors={availableEditors}
                  showOpenInPicker={showOpenInPicker}
                  openInShortcutEnabled={
                    !(
                      rightPanelOpen &&
                      renderedRightPanelSurface?.kind === "file" &&
                      renderedRightPanelSurface.attachment === undefined
                    )
                  }
                  gitCwd={gitCwd}
                  workspaceMutationId={workspaceMutationId}
                  isGitRepo={isGitRepo}
                  envLocked={envLocked}
                  availableEnvironments={logicalProjectEnvironments}
                  autoEnvironmentLabel={autoEnvironmentLabel}
                  onAutoEnvironment={
                    draftId &&
                    !envLocked &&
                    canAutoBalanceEnvironments &&
                    loadBalancingSettings.loadBalancingEnabled
                      ? onAutoEnvironmentStable
                      : undefined
                  }
                  {...(canChangeEnvironment
                    ? { onEnvironmentChange: onEnvironmentChangeStable }
                    : {})}
                  onEnvModeChange={onEnvModeChangeStable}
                  envMode={envMode}
                  {...(canOverrideServerThreadEnvMode
                    ? {
                        activeThreadBranchOverride: activeThreadBranch,
                        onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
                      }
                    : {})}
                  startFromOrigin={startFromOrigin}
                  onStartFromOriginChange={onStartFromOriginChange}
                  {...(canCheckoutPullRequestIntoThread
                    ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                    : {})}
                  onComposerFocusRequest={scheduleComposerFocusStable}
                  {...(isServerThread && isGitRepo
                    ? { onOpenChanges: openChangesFromThreadPanelStable }
                    : {})}
                  onRunProjectScript={runProjectScriptStable}
                  onAddProjectScript={saveProjectScriptStable}
                  onUpdateProjectScript={updateProjectScriptStable}
                  onDeleteProjectScript={deleteProjectScriptStable}
                  usage={{
                    providerInstanceId: activeProviderInstanceId,
                    providers: providerStatuses,
                    sources: serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
                    contextWindow: activeContextWindow,
                  }}
                />

                <PullRequestThreadDialogHost
                  threadKey={activeThreadKey}
                  environmentId={activeThread.environmentId}
                  threadId={activeThread.id}
                  cwd={activeProject?.workspaceRoot ?? null}
                  onPrepared={handlePreparedPullRequestThreadStable}
                />
              </>
            )}
          </ThreadFindCanvas>
        </div>

        {embedded ? null : (
          <ChatTerminalDrawers
            activeThreadKey={activeThreadKey}
            activeTerminalOpen={Boolean(terminalUiState.terminalOpen)}
            composerHeight={composerReservedHeight}
            launchContext={activeTerminalLaunchContext ?? null}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraftStable}
          />
        )}
      </div>

      {rightPanelPresent && activeThreadRef && !embedded ? (
        <ChatRightPanel
          sheet={shouldUsePlanSidebarSheet}
          workspaceLayoutElement={workspaceLayoutElement}
          widthStorageKey={`t3code:preview-panel-width:${activeThreadKey}`}
          sheetAnimationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
          onCloseSheet={closePreviewPanelStable}
          open={rightPanelOpen}
          keybindings={keybindings}
          getShortcutContext={getShortcutContextStable}
          maximized={rightPanelMaximized}
          layoutControls={
            rightPanelOpen ? (
              <div className="mr-px flex items-center gap-1">
                <RightPanelMaximizeControl
                  maximized={rightPanelMaximized}
                  onToggle={toggleRightPanelMaximizedStable}
                />
                {panelToggleControls}
              </div>
            ) : null
          }
          surfaces={renderedRightPanelSurfaces}
          environmentId={activeThreadRef.environmentId}
          activeSurfaceId={renderedRightPanelSurface?.id ?? null}
          pendingSurfaceIds={pendingFileSurfaceIds}
          previewSessions={activePreviewState.sessions}
          desktopByTabId={activePreviewState.desktopByTabId}
          previewRuntimeTabId={resolvePreviewRuntimeTabId}
          terminalLabelsById={activeTerminalLabelsById}
          onActivate={activateRightPanelSurfaceStable}
          onCloseSurface={closeRightPanelSurfaceStable}
          onRenameDevice={(surfaceId, title) => {
            if (activeThreadRef)
              useRightPanelStore.getState().renameDevice(activeThreadRef, surfaceId, title);
          }}
          onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
          onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
          onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
          onMoveSurface={moveRightPanelSurfaceStable}
          onCopyFilePath={copyRightPanelFilePathStable}
          onAddBrowser={() => createBrowserSurface()}
          onAddBrowserInProfile={createBrowserSurfaceStable}
          onAddTerminal={addTerminalSurfaceStable}
          onAddDiff={addDiffSurfaceStable}
          onAddFiles={addFilesSurfaceStable}
          onAddMedia={openMediaPanel}
          onAddTests={openTestsPanel}
          testsAvailable={Boolean(activeProject?.workspaceRoot)}
          onAddPullRequest={addPullRequestSurfaceStable}
          onAddPullRequests={addPullRequestsSurfaceStable}
          onAddDevice={addDeviceSurfaceStable}
          onAddSideChat={sideChatsOffered ? openSideChatStable : undefined}
          browserAvailable={canOperatePreview && browserAvailable}
          terminalAvailable={activeProject !== null && canOperateTerminal}
          diffAvailable={isServerThread && isGitRepo}
          filesAvailable={activeProject !== null}
          pullRequestAvailable={pullRequestSurfaceAvailable}
          pullRequestsAvailable={pullRequestsSurfaceAvailable}
          deviceAvailable={activeThreadRef !== null}
          sideChatAvailable={sideChat.available}
          sideChatDisabledReason={sideChatDisabledReason}
        >
          {rightPanelContent}
        </ChatRightPanel>
      ) : null}

      <RevertConfirmHost
        threadKey={routeThreadKey}
        checkpoints={serverProjection?.checkpoints}
        worktreePath={activeThread?.worktreePath ?? null}
        onConfirm={onConfirmRevertStable}
      />
      {embedded ? null : <LinkPullRequestDialogHost />}
      <ThreadVisitWatermark threadRef={routeThreadRef} />
      <ExpandedImageDialogHost threadKey={routeThreadKey} />
    </div>
  );
  return (
    <FileMetadataThreadProvider
      threadRef={activeThreadRef}
      cwd={activeWorkspaceRoot}
      checkpoints={serverProjection?.checkpoints}
    >
      {content}
    </FileMetadataThreadProvider>
  );
}

// Chromium on Linux pastes PRIMARY into the focused editable unless the middle mouseup is cancelled.
function preventMiddleClickPasteOutsideEditable(event: ReactMouseEvent) {
  if (event.button !== 1 || isEditableFocused(event.target)) return;
  event.preventDefault();
}

function PreviewSessionSync(props: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(props.threadRef);
  return null;
}
