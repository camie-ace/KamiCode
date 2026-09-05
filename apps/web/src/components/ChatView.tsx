import {
  type AssistantCitation,
  type ApprovalRequestId,
  type ChatFileAttachment,
  DEFAULT_MODEL,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectId,
  type ProjectScript,
  type ProjectTestEnvironment,
  type ProviderApprovalDecision,
  type PreviewAnnotationPayload,
  ProviderInstanceId,
  type ServerProvider,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  ThreadId,
  TurnId,
  type KeybindingCommand,
  OrchestrationThreadActivity,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProviderInteractionMode,
  ProviderDriverKind,
  resolveEnvironmentMachineKind,
  RuntimeMode,
  TerminalOpenInput,
  type UploadChatAttachment,
  type WorkflowRecordKind,
} from "@t3tools/contracts";
import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { wasBootstrapThreadDeleted } from "@t3tools/client-runtime/errors";
import { type CodexArtifactTemplate } from "@t3tools/client-runtime/codex-artifact-templates";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  codexFeedbackMessage,
  parseCodexFeedbackCommand,
  submitCodexFeedback,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { truncate } from "@t3tools/shared/String";
import { resolveThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";
import {
  getTerminalLabel,
  nextTerminalId,
  resolveTerminalSessionLabel,
} from "@t3tools/shared/terminalLabels";
import { Debouncer } from "@tanstack/react-pacer";
import { useAtomValue } from "@effect/atom-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useDiffPanelStore } from "../diffPanelStore";
import {
  collapseExpandedComposerCursor,
  type ComposerSubmissionIntent,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  createMessageAttachmentPreviewProjector,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntriesWithState,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  selectHandoffImageResources,
  type TimelineEntriesProjection,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  getAnchoredTurnMetrics,
  type TimelineScrollMode,
} from "./chat/timelineScrollAnchoring";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { useUiStateStore } from "../uiStateStore";
import {
  latestWorkspaceMutationId,
  useWorkspaceMutationRefresh,
} from "../hooks/useWorkspaceMutationRefresh";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatAttachment,
  type ChatMessage,
  isBrowserPreviewAttachment,
  isImageAttachment,
  type SessionPhase,
  type Thread,
  type TurnDiffSummary,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "../previewStateStore";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import { BrowserSettingsReadError } from "../browser/openFileInPreview";
import { addBrowserSurface } from "./preview/addBrowserSurface";
import { usePreviewSession } from "./preview/usePreviewSession";
import { closePreviewSession } from "./preview/closePreviewSession";
import { ThreadPreviewMiniPlayer } from "./preview/ThreadPreviewMiniPlayer";
import { subscribePreviewAction } from "./preview/previewActionBus";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import {
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import { isThreadOwnPullRequest } from "./pullRequest/pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./pullRequest/PullRequestDetailPanel";
import { PullRequestDetailGhost } from "./pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import { RightPanelTabs, type PullRequestTabStatus } from "./RightPanelTabs";
import { AgentsPanel } from "./AgentsPanel";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { BranchToolbar } from "./BranchToolbar";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import PlanSidebar, { type WorkflowLaneRunDetail } from "./PlanSidebar";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import {
  AlarmClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GitBranchIcon,
  ListOrderedIcon,
  Minimize2Icon,
  PencilIcon,
  PaperclipIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { cn, randomHex } from "~/lib/utils";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/projectScripts";
import { newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { useBrowserHistoryStore } from "~/browserHistoryStore";
import { registerFaviconProjectForThread } from "~/browserFaviconStore";
import { getProviderModelCapabilities } from "../providerModels";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  sortProviderInstanceEntries,
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
import { useThreadActions } from "../hooks/useThreadActions";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { confirmTerminalClose, isTerminalCloseConfirmPending } from "../lib/terminalCloseConfirm";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../lib/terminalCloseShortcut";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import {
  derivePhysicalProjectKey,
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "../sidebarProjectGrouping";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import {
  type ComposerAttachment,
  beginBackgroundDraftSubmissionByRef,
  clearBackgroundDraftSubmissionByRef,
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import {
  appendElementContextsToPrompt,
  type ElementContextDraft,
  formatElementContextLabel,
} from "../lib/elementContext";
import { appendPreviewAnnotationPrompt } from "../lib/previewAnnotation";
import { appendReviewCommentsToPrompt, type ReviewCommentContext } from "../reviewCommentContext";
import { environmentCatalog } from "../connection/catalog";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import {
  environmentServerConfigsAtom,
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  primaryServerSettingsAtom,
  serverEnvironment,
} from "../state/server";
import { terminalEnvironment } from "../state/terminal";
import {
  environmentThreadDetails,
  threadEnvironment,
  useEnvironmentThread,
} from "../state/threads";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironments, usePrimaryEnvironment } from "../state/environments";
import {
  useProject,
  useProjects,
  useThread,
  useThreadProposedPlans,
  useThreadRefs,
  useThreadShell,
} from "../state/entities";
import { environmentShell } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { createPageScrollController, type PageScrollKey } from "./chat/pageScrollController";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { MediaPanel } from "./chat/MediaPanel";
import { resolveTimelineIsAtEnd } from "./chat/MessagesTimeline.logic";
import { resolveComposerTimelineInset } from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { PanelLayoutControls, RightPanelMaximizeControl } from "./chat/PanelLayoutControls";
import { expandedImageKey, type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveThreadState } from "./NoActiveThreadState";
import { TestHarnessRunsPanel } from "./TestHarnessRunsControl";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import {
  type EnvironmentOption,
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusBannerKey,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import {
  dismissThreadErrorBannerForSession,
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import {
  resolveDisplayedThreadPr,
  threadChangeRequestSnapshotsAtom,
  useLinkedThreadPullRequest,
} from "./ThreadStatusIndicators";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ComposerSurface } from "./chat/ComposerSurface";
import {
  hasAvailableCompactionProvider,
  hasDismissedResumeCompaction,
  shouldOfferResumeCompaction,
} from "./chat/ContextWindowMeter.logic";
import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "../lib/contextWindow";
import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_DURATION_MS,
  DRAFT_HERO_TRANSITION_EASING,
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
  runMobileComposerTransition,
} from "./chat/draftHeroTransition";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  agentControlledBrowserCloseConfirmation,
  appendMediaFollowUpReferencesToPrompt,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  buildLoadingThreadFromShell,
  buildRevertTurnCountByUserMessageId,
  buildThreadTurnInterruptInput,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  dismissBranchMismatchForSession,
  hasEnvironmentReconnectWarningGraceElapsed,
  latestTurnStartFailureId,
  scheduleEnvironmentReconnectWarning,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  shouldDockDraftHeroForSubmission,
  shouldReleaseTimelineAnchorForToolActivity,
  shouldShowBranchMismatchBanner,
  shouldShowPlanFollowUpPrompt,
  shouldOpenProactivePullRequest,
  shouldOpenProactiveTurnDiff,
  shouldRenderPreviewMiniPlayer,
  getStartedThreadModelChangeBlockReason,
  isPendingQueuedTurn,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  deriveLockedProvider,
  readFileAsDataUrl,
  resolveFileAttachmentUrl,
  reconcileMountedTerminalThreadIds,
  resolveMediaFollowUpReferences,
  resolveBackgroundDraftWorkspaceOptions,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  resolveDraftHeroState,
  resolveProactiveTurnDiffAction,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  shouldWriteThreadErrorToCurrentServerThread,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  toolGroupConsumesUpwardNavigation,
  waitForStartedServerThread,
} from "./ChatView.logic";
import type { ThreadSyncPhase } from "../threadSync";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { RightPanelSheet } from "./RightPanelSheet";
import { previewEnvironment } from "../state/preview";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { fileAttachmentCapabilityBlockReason } from "./chat/composerAttachmentFiles";
import { assetEnvironment } from "../state/assets";
import { readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ServerUpdateAction } from "./ServerUpdateAction";
import {
  ComposerServerUpdateIcon,
  ComposerServerUpdateStatus,
} from "./chat/ComposerServerUpdateStatus";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "../versionSkew";
import { useAssetUrls } from "../assets/assetUrls";
import { collectThreadMediaArtifacts } from "~/mediaArtifacts";
import { useDisplayableMediaArtifacts } from "~/mediaArtifactAssets";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./chat/composerPromptHistory";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const WORKFLOW_USE_LEAD_DEFAULT = "Use lead default";

type SendableComposerAttachment = Exclude<ComposerAttachment, { readonly status: "unsupported" }>;

function isSendableComposerAttachment(
  attachment: ComposerAttachment,
): attachment is SendableComposerAttachment {
  return attachment.status !== "unsupported";
}

function uploadTypeForComposerAttachment(
  attachment: SendableComposerAttachment,
): UploadChatAttachment["type"] {
  if (attachment.type === "image" && attachment.mimeType.toLowerCase() === "image/gif") {
    return "gif";
  }
  return attachment.type;
}

async function toUploadChatAttachment(
  attachment: SendableComposerAttachment,
): Promise<UploadChatAttachment> {
  const dataUrl = await readFileAsDataUrl(attachment.file);
  const type = uploadTypeForComposerAttachment(attachment);
  const base = {
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    dataUrl,
  };
  switch (type) {
    case "image":
      return { ...base, type };
    case "gif":
      return { ...base, type };
    case "video":
      return { ...base, type };
    case "file":
      return { ...base, type };
  }
}

function toOptimisticChatAttachment(attachment: SendableComposerAttachment): ChatAttachment {
  const type = uploadTypeForComposerAttachment(attachment);
  const base = {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
  switch (type) {
    case "image":
      return { ...base, type };
    case "gif":
      return { ...base, type };
    case "video":
      return { ...base, type };
    case "file":
      return { ...base, type };
  }
}

function cloneComposerAttachmentForRetry(
  attachment: SendableComposerAttachment,
): SendableComposerAttachment {
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    !attachment.previewUrl ||
    !attachment.previewUrl.startsWith("blob:")
  ) {
    return attachment;
  }
  try {
    return {
      ...attachment,
      previewUrl: URL.createObjectURL(attachment.file),
    };
  } catch {
    return attachment;
  }
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

interface WorkflowLaneTarget {
  readonly id: string;
  readonly role: string;
}

interface WorkflowPlannedSubAgent extends WorkflowLaneTarget {
  readonly goal?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fastMode?: boolean;
  readonly startsAfter?: ReadonlyArray<string>;
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

function workflowActivityPayload(
  activity: OrchestrationThreadActivity,
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : null;
}

function workflowPayloadString(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function workflowLaneMatchesPayload(
  payload: Record<string, unknown> | null,
  lane: WorkflowLaneTarget,
): boolean {
  return workflowPayloadString(payload, "laneId") === lane.id;
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

function workflowLaneRequestedModel(lane: WorkflowPlannedSubAgent): string | null {
  const model = lane.model?.trim();
  if (!model) return null;
  return model.toLowerCase() === WORKFLOW_USE_LEAD_DEFAULT.toLowerCase() ? null : model;
}

type WorkflowModelOptionSelection = NonNullable<ModelSelection["options"]>[number];

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

interface WorkflowStartedChildLane {
  readonly activityId: string;
  readonly createdAt: string;
  readonly laneId: string;
  readonly laneRole: string;
  readonly childThreadId: ThreadId;
  readonly childTurnMessageId: string | null;
  readonly childTurnRequestedAt: string | null;
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

function workflowCompletionKey(input: {
  parentThreadId: ThreadId;
  startedActivityId: string;
  childThreadId: ThreadId;
  childTurnId: TurnId;
}): string {
  return `${input.parentThreadId}:${input.startedActivityId}:${input.childThreadId}:${input.childTurnId}`;
}

function workflowLaneLaunchKey(parentThreadId: ThreadId, laneId: string): string {
  return `${parentThreadId}:${laneId}`;
}

function workflowCompletionKindKey(
  kind: "workflow.handoff" | "workflow.lane.completed",
  key: string,
) {
  return `${kind}:${key}`;
}

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

function workflowStartedChildLaneIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<string> {
  return new Set(workflowStartedChildLanes(activities).map((entry) => entry.laneId));
}

function workflowStartedRunMatchesLatestTurn(
  started: WorkflowStartedChildLane,
  latestTurn: Thread["latestTurn"],
): boolean {
  if (!latestTurn) return false;
  if (!started.childTurnRequestedAt) return true;
  return latestTurn.requestedAt.localeCompare(started.childTurnRequestedAt) >= 0;
}

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

function workflowChildCompletionObservations(input: {
  parentThread: Thread;
  childThreadForId: (childThreadId: ThreadId) => Thread | null;
}): WorkflowChildCompletionObservation[] {
  const presence = existingWorkflowCompletionPresence(
    input.parentThread.id,
    input.parentThread.activities,
  );
  return workflowStartedChildLanes(input.parentThread.activities).flatMap((started) => {
    const childThread = input.childThreadForId(started.childThreadId);
    const latestTurn = childThread?.latestTurn ?? null;
    if (!childThread || !latestTurn || !workflowStartedRunMatchesLatestTurn(started, latestTurn)) {
      return [];
    }
    if (!isLatestTurnSettled(latestTurn, childThread.session)) {
      return [];
    }
    const completionKey = workflowCompletionKey({
      parentThreadId: input.parentThread.id,
      startedActivityId: started.activityId,
      childThreadId: started.childThreadId,
      childTurnId: latestTurn.turnId,
    });
    const needsHandoff = !presence.handoffKeys.has(completionKey);
    const needsCompleted = !presence.completedKeys.has(completionKey);
    if (!needsHandoff && !needsCompleted) {
      return [];
    }
    const { summary, detail } = workflowChildResultText(
      latestAssistantTextForTurn(childThread, latestTurn.turnId, latestTurn.assistantMessageId),
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
        childTurnId: latestTurn.turnId,
        childAssistantMessageId: latestTurn.assistantMessageId,
        summary,
        detail,
      },
    ];
  });
}

function workflowLaneRunDetails(input: {
  parentThread: Thread;
  childThreadForId: (childThreadId: ThreadId) => Thread | null;
}): WorkflowLaneRunDetail[] {
  return workflowStartedChildLanes(input.parentThread.activities).flatMap((started) => {
    const childThread = input.childThreadForId(started.childThreadId);
    if (!childThread) return [];
    const latestTurn = childThread.latestTurn ?? null;
    const settled = latestTurn ? isLatestTurnSettled(latestTurn, childThread.session) : false;
    const failed = latestTurn?.state === "error";
    const latestAssistantText = latestTurn
      ? latestAssistantTextForTurn(childThread, latestTurn.turnId, latestTurn.assistantMessageId)
      : null;
    const messages = childThread.messages
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
    const activities = childThread.activities
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
        title: childThread.title,
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

function latestAssistantTextForTurn(
  thread: Thread,
  turnId: TurnId,
  assistantMessageId: string | null,
) {
  const exact = assistantMessageId
    ? thread.messages.find((message) => message.id === assistantMessageId)
    : null;
  const message =
    exact ??
    thread.messages
      .filter((entry) => entry.role === "assistant" && entry.turnId === turnId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    null;
  const text = message?.text.trim() ?? "";
  return text.length > 0 ? text : null;
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

function useDraftHeroLayoutTransition(isDraftHeroState: boolean) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };
  const captureComposerRect = () => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  };

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = composerAnchorRef.current?.getBoundingClientRect() ?? null;
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;

    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      !prefersReducedMotion &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: DRAFT_HERO_TRANSITION_DURATION_MS,
            easing: DRAFT_HERO_TRANSITION_EASING,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current !== animation) {
              return;
            }
            animationRef.current = null;
          });
      }
    }

    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [isDraftHeroState]);

  return [attachTransitionGroupRef, attachComposerAnchorRef, captureComposerRect] as const;
}
const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({
    default: module.PreviewPanel,
  })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));
const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();
const TYPE_TO_FOCUS_EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");
const TYPE_TO_FOCUS_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  "[data-hosted-browser-view]",
].join(",");
const TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR = [
  '[data-slot="alert-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="command-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sheet-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sidebar"][data-mobile="true"]:is([data-open],[data-ending-style])',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: EnvironmentConnectionPresentation;
};

type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

type QueuedMessageItem = {
  id: MessageId;
  queueId: string | null;
  text: string;
  status: "queued" | "dispatching";
  createdAt: string;
};

const pendingQueuedMessageDeleteKeys = new Set<string>();

function queuedMessageDeleteKey(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
): string {
  return `${environmentId}:${threadId}:${messageId}`;
}

const QUEUED_MESSAGE_PREVIEW_LIMIT = 180;

function queuedMessagePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= QUEUED_MESSAGE_PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, QUEUED_MESSAGE_PREVIEW_LIMIT - 3)}...`;
}

const QueuedMessagesPanel = memo(function QueuedMessagesPanel(props: {
  items: ReadonlyArray<QueuedMessageItem>;
  onDelete: (item: QueuedMessageItem) => void;
  onEdit: (item: QueuedMessageItem, text: string) => Promise<boolean>;
}) {
  const { items, onDelete, onEdit } = props;
  const [editingMessageId, setEditingMessageId] = useState<MessageId | null>(null);
  const [draftText, setDraftText] = useState("");
  const [savingMessageId, setSavingMessageId] = useState<MessageId | null>(null);
  const editingItem = useMemo(
    () => items.find((item) => item.id === editingMessageId) ?? null,
    [editingMessageId, items],
  );
  const isSaving = savingMessageId !== null;

  useEffect(() => {
    if (editingMessageId !== null && !items.some((item) => item.id === editingMessageId)) {
      setEditingMessageId(null);
      setDraftText("");
    }
  }, [editingMessageId, items]);

  const beginEdit = useCallback((item: QueuedMessageItem) => {
    if (item.status !== "queued" || item.queueId === null) return;
    setEditingMessageId(item.id);
    setDraftText(item.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setDraftText("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingItem) return;
    if (draftText.trim().length === 0) return;
    if (draftText === editingItem.text) {
      cancelEdit();
      return;
    }
    setSavingMessageId(editingItem.id);
    try {
      const didSave = await onEdit(editingItem, draftText);
      if (didSave) {
        cancelEdit();
      }
    } finally {
      setSavingMessageId(null);
    }
  }, [cancelEdit, draftText, editingItem, onEdit]);

  if (items.length === 0) return null;

  return (
    <div className="mx-auto mb-2 w-full min-w-0 max-w-208 rounded-lg border border-border/60 bg-card/80 px-3 py-2 shadow-sm backdrop-blur">
      <div className="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs">
        <ListOrderedIcon className="size-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">Queued</span>
        <span>{items.length}</span>
      </div>
      <div className="grid gap-1.5">
        {items.map((item, index) => {
          const isEditing = editingMessageId === item.id;
          const isRowSaving = savingMessageId === item.id;
          const canEdit = item.status === "queued" && item.queueId !== null && !isSaving;
          const saveDisabled =
            isRowSaving ||
            draftText.trim().length === 0 ||
            (editingItem !== null && draftText === editingItem.text);
          return (
            <div
              key={item.id}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-md bg-muted/45 px-2 py-1.5 text-xs"
            >
              <span className="tabular-nums text-muted-foreground">{index + 1}</span>
              {isEditing ? (
                <div className="min-w-0 space-y-1.5">
                  <Textarea
                    autoFocus
                    size="sm"
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                        return;
                      }
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void saveEdit();
                      }
                    }}
                    rows={2}
                    disabled={isRowSaving}
                    aria-label="Queued message text"
                    className="min-h-14 text-xs"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40"
                      disabled={isRowSaving}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                      disabled={saveDisabled}
                      onClick={() => void saveEdit()}
                    >
                      {isRowSaving ? "Saving" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <span className="min-w-0 truncate text-foreground/90">
                  {queuedMessagePreview(item.text)}
                </span>
              )}
              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.status === "dispatching" ? "Sending" : "Queued"}
              </span>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-background enabled:hover:text-foreground disabled:opacity-30"
                    disabled={!canEdit}
                    onClick={() => beginEdit(item)}
                    aria-label="Edit queued message"
                  >
                    <PencilIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {item.queueId === null
                    ? "This queued message is still being saved"
                    : item.status === "queued"
                      ? "Edit queued message"
                      : "This message is already being sent"}
                </TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-background enabled:hover:text-foreground disabled:opacity-30"
                    disabled={item.status !== "queued" || isRowSaving}
                    onClick={() => onDelete(item)}
                    aria-label="Delete queued message"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {item.status === "queued"
                    ? "Delete queued message"
                    : "This message is already being sent"}
                </TooltipPopup>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function eventPathContainsSelector(event: Event, selector: string): boolean {
  const path = event.composedPath();
  if (path.length === 0 && event.target) {
    path.push(event.target);
  }
  return path.some((target) => target instanceof Element && target.closest(selector));
}

/**
 * Whether input that landed outside any editable or interactive element
 * should be redirected into the composer. Shared by type-to-focus and
 * paste-to-focus so both honour the same surfaces.
 */
function shouldRedirectInputToComposer(event: Event): boolean {
  if (event.defaultPrevented) return false;
  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR)) return false;
  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_INTERACTIVE_SELECTOR)) return false;
  if (document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)) return false;
  return true;
}

function shouldTypeToFocusComposer(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (!shouldRedirectInputToComposer(event)) return false;

  // The right-panel surface launcher claims its shortcut letters while it is
  // visible (data attribute set in RightPanelTabs); those keys open surfaces
  // instead of typing into the composer.
  const launcherKeys = document
    .querySelector("[data-surface-launcher-keys]")
    ?.getAttribute("data-surface-launcher-keys");
  if (launcherKeys && launcherKeys.toLowerCase().includes(event.key.toLowerCase())) return false;

  return true;
}

/**
 * Plain text pasted with nothing editable focused, such as after the resting
 * composer blurred. Files are left to the composer's own paste handler.
 */
function pasteTextToFocusComposer(event: ClipboardEvent): string | null {
  if (!event.clipboardData || event.clipboardData.files.length > 0) return null;
  if (!shouldRedirectInputToComposer(event)) return null;
  const text = event.clipboardData.getData("text/plain");
  return text.length > 0 ? text : null;
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
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

function isCompactCommandMessage(message: ChatMessage): boolean {
  const text = message.text.trim().toLowerCase();
  return message.role === "user" && text === "/compact" && !message.attachments?.length;
}

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      threadSyncPhase?: ThreadSyncPhase | null;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      threadSyncPhase?: never;
      routeKind: "draft";
      draftId: DraftId;
    };

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

type PersistentTerminalLaunchContext = Pick<TerminalLaunchContext, "cwd" | "worktreePath">;

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);
  const latestUserMessage = input.activeThread?.messages.findLast(
    (message) => message.role === "user",
  );
  const latestUserMessageId = latestUserMessage?.id ?? null;
  const currentTurnStartFailureId =
    localDispatch === null
      ? null
      : latestTurnStartFailureId(input.activeThread, latestUserMessageId);

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        latestUserMessageId,
        session: input.activeThread?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        latestTurnStartFailureId: currentTurnStartFailureId,
        threadError: input.threadError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.session,
      input.phase,
      input.threadError,
      latestUserMessageId,
      currentTurnStartFailureId,
      localDispatch,
    ],
  );
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean; submissionIntent?: ComposerSubmissionIntent }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        const active = serverAcknowledgedLocalDispatch ? null : current;
        if (active) {
          const submissionIntent = options?.submissionIntent ?? active.submissionIntent;
          return active.preparingWorktree === preparingWorktree &&
            active.submissionIntent === submissionIntent
            ? active
            : { ...active, preparingWorktree, submissionIntent };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread, serverAcknowledgedLocalDispatch],
  );

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    latestUserMessageAt: latestUserMessage?.createdAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: localDispatch?.submissionIntent === "background",
  };
}

/** Same terminal ids (order ignored) — avoids reconcile when only server session ordering differs. */
function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return true;
  }
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Server knows about fewer sessions than the client, but every server id still exists locally.
 * Typical right after `terminal.open`: known-session list lags; reconciling would drop the new id
 * and later re-add it as a separate group (no split layout).
 */
function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) {
    return false;
  }
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) {
      return false;
    }
  }
  return true;
}

interface PersistentThreadTerminalDrawerProps {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  threadId: ThreadId;
  active: boolean;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  splitVerticalShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

const PersistentThreadTerminalDrawer = memo(function PersistentThreadTerminalDrawer({
  threadRef,
  threadId,
  active,
  launchContext,
  focusRequestId,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  keybindings,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");
  const closeTerminalMutation = useAtomCommand(terminalEnvironment.close, "terminal close");
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const serverThread = useThread(threadRef, { waitForShell: draftThread !== null });
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const visible = active && terminalUiState.terminalOpen;
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId,
  });
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const panelTerminalIds = useMemo(
    () =>
      new Set(
        panelSurfaces.flatMap((surface) =>
          surface.kind === "terminal" ? surface.terminalIds : [],
        ),
      ),
    [panelSurfaces],
  );
  const drawerTerminalSessions = useMemo(
    () =>
      knownTerminalSessions.filter((session) => !panelTerminalIds.has(session.target.terminalId)),
    [knownTerminalSessions, panelTerminalIds],
  );
  const terminalLabelsById = useMemo(() => {
    const next = new Map<string, string>();
    for (const session of drawerTerminalSessions) {
      next.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return next;
  }, [drawerTerminalSessions]);
  const terminalLaunchLocationsById = useMemo(() => {
    const next = new Map<
      string,
      {
        readonly cwd: string;
        readonly worktreePath: string | null;
        readonly runtimeEnv: Record<string, string>;
      }
    >();
    if (!project) {
      return next;
    }

    for (const session of drawerTerminalSessions) {
      const summary = session.state.summary;
      if (!summary) {
        continue;
      }
      const worktreePathForLaunch =
        launchContext !== null ? launchContext.worktreePath : summary.worktreePath;
      next.set(session.target.terminalId, {
        cwd: launchContext?.cwd ?? summary.cwd,
        worktreePath: worktreePathForLaunch,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: worktreePathForLaunch,
        }),
      });
    }

    return next;
  }, [drawerTerminalSessions, launchContext, project]);
  const serverOrderedTerminalIds = useMemo(
    () => drawerTerminalSessions.map((session) => session.target.terminalId),
    [drawerTerminalSessions],
  );
  // Every client-side id source participates in allocation: the server list
  // lags fresh opens, and panel terminals are filtered out of the drawer's
  // sessions — an id collision attaches two viewports to one PTY session.
  const allocatableTerminalIds = useMemo(
    () => [
      ...new Set([
        ...serverOrderedTerminalIds,
        ...terminalUiState.terminalIds,
        ...panelTerminalIds,
      ]),
    ],
    [panelTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds],
  );
  const storeSetTerminalHeight = useTerminalUiStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalUiStateStore((state) => state.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore(
    (state) => state.splitTerminalVertical,
  );
  const storeNewTerminal = useTerminalUiStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const reconcileTerminalIds = useTerminalUiStateStore((state) => state.reconcileTerminalIds);

  useEffect(() => {
    if (terminalIdListsEqual(serverOrderedTerminalIds, terminalUiState.terminalIds)) {
      return;
    }
    if (
      serverTerminalIdsStrictSubsetOfClient(serverOrderedTerminalIds, terminalUiState.terminalIds)
    ) {
      return;
    }
    reconcileTerminalIds(threadRef, serverOrderedTerminalIds);
  }, [reconcileTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds, threadRef]);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = useMemo(() => {
    if (launchContext !== null) {
      return launchContext.worktreePath;
    }
    return worktreePath;
  }, [launchContext, worktreePath]);
  const cwd = useMemo(
    () =>
      launchContext?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.workspaceRoot },
            worktreePath: effectiveWorktreePath,
          })
        : null),
    [effectiveWorktreePath, launchContext?.cwd, project],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadRef, height);
    },
    [storeSetTerminalHeight, threadRef],
  );

  const splitTerminal = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeSplitTerminal(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    allocatableTerminalIds,
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    runtimeEnv,
    storeSplitTerminal,
    threadId,
    threadRef,
    openTerminal,
  ]);
  const splitTerminalVertical = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeSplitTerminalVertical(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    allocatableTerminalIds,
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    openTerminal,
    runtimeEnv,
    storeSplitTerminalVertical,
    threadId,
    threadRef,
  ]);

  const createNewTerminal = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeNewTerminal(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    allocatableTerminalIds,
    runtimeEnv,
    storeNewTerminal,
    threadId,
    threadRef,
    openTerminal,
  ]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const fallbackExitWrite = () =>
        writeTerminal({
          environmentId: threadRef.environmentId,
          input: { threadId, terminalId, data: "exit\n" },
        });

      void (async () => {
        const closeResult = await closeTerminalMutation({
          environmentId: threadRef.environmentId,
          input: {
            threadId,
            terminalId,
            deleteHistory: true,
          },
        });
        if (closeResult._tag === "Failure" && !isAtomCommandInterrupted(closeResult)) {
          await fallbackExitWrite();
        }
      })();

      storeCloseTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [
      bumpFocusRequestId,
      storeCloseTerminal,
      threadId,
      threadRef,
      closeTerminalMutation,
      writeTerminal,
    ],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || (!terminalUiState.terminalOpen && !active) || !cwd) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid shrink-0 overflow-clip",
        active ? (visible ? "grid-rows-[1fr]" : "grid-rows-[0fr]") : "hidden",
        active &&
          "[[data-panel-animations=true]_&]:transition-[grid-template-rows] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out",
        active && visible && "[[data-panel-animations=true]_&]:starting:grid-rows-[0fr]!",
      )}
    >
      <div className="min-h-0 overflow-clip">
        <ThreadTerminalDrawer
          threadRef={threadRef}
          threadId={threadId}
          cwd={cwd}
          worktreePath={effectiveWorktreePath}
          runtimeEnv={runtimeEnv}
          visible={visible}
          height={terminalUiState.terminalHeight}
          // Known-session order is MRU and changes on focus; persisted store order keeps sidebar labels stable.
          terminalIds={terminalUiState.terminalIds}
          activeTerminalId={terminalUiState.activeTerminalId}
          terminalGroups={terminalUiState.terminalGroups}
          activeTerminalGroupId={terminalUiState.activeTerminalGroupId}
          focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
          onSplitTerminal={splitTerminal}
          onSplitTerminalVertical={splitTerminalVertical}
          onNewTerminal={createNewTerminal}
          splitShortcutLabel={visible ? splitShortcutLabel : undefined}
          splitVerticalShortcutLabel={visible ? splitVerticalShortcutLabel : undefined}
          newShortcutLabel={visible ? newShortcutLabel : undefined}
          closeShortcutLabel={visible ? closeShortcutLabel : undefined}
          keybindings={keybindings}
          onActiveTerminalChange={activateTerminal}
          onCloseTerminal={closeTerminal}
          onHeightChange={setTerminalHeight}
          onAddTerminalContext={handleAddTerminalContext}
          terminalLabelsById={terminalLabelsById}
          terminalLaunchLocationsById={terminalLaunchLocationsById}
        />
      </div>
    </div>
  );
});

interface PersistentThreadTerminalPanelProps {
  visible: boolean;
  threadRef: ScopedThreadRef;
  surface: Extract<RightPanelSurface, { kind: "terminal" }>;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
}

const PersistentThreadTerminalPanel = memo(function PersistentThreadTerminalPanel({
  visible,
  threadRef,
  surface,
  launchContext,
  focusRequestId,
  keybindings,
  onAddTerminalContext,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  onActiveTerminalChange,
  onCloseTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: PersistentThreadTerminalPanelProps) {
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const serverThread = useThread(threadRef, { waitForShell: draftThread !== null });
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeSummary =
    knownTerminalSessions.find((session) => session.target.terminalId === surface.activeTerminalId)
      ?.state.summary ?? null;
  const worktreePath =
    launchContext?.worktreePath ?? activeSummary?.worktreePath ?? threadWorktreePath;
  const cwd = useMemo(
    () =>
      launchContext?.cwd ??
      activeSummary?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          })
        : null),
    [activeSummary?.cwd, launchContext?.cwd, project, worktreePath],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          })
        : {},
    [project, worktreePath],
  );
  const terminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      labels.set(terminalId, resolveTerminalSessionLabel(terminalId, summary));
    }
    return labels;
  }, [knownTerminalSessions, surface.terminalIds]);
  const terminalLaunchLocationsById = useMemo(() => {
    const locations = new Map<
      string,
      {
        readonly cwd: string;
        readonly worktreePath: string | null;
        readonly runtimeEnv: Record<string, string>;
      }
    >();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      const terminalWorktreePath =
        launchContext?.worktreePath ?? summary?.worktreePath ?? threadWorktreePath;
      const terminalCwd =
        launchContext?.cwd ??
        summary?.cwd ??
        (project
          ? projectScriptCwd({
              project: { cwd: project.workspaceRoot },
              worktreePath: terminalWorktreePath,
            })
          : null);
      if (!terminalCwd || !project) continue;
      locations.set(terminalId, {
        cwd: terminalCwd,
        worktreePath: terminalWorktreePath,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: terminalWorktreePath,
        }),
      });
    }
    return locations;
  }, [
    knownTerminalSessions,
    launchContext?.cwd,
    launchContext?.worktreePath,
    project,
    surface.terminalIds,
    threadWorktreePath,
  ]);

  if (!project || !cwd) return null;

  return (
    <ThreadTerminalDrawer
      mode="panel"
      visible={visible}
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={worktreePath}
      runtimeEnv={runtimeEnv}
      height={0}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      focusRequestId={focusRequestId}
      onSplitTerminal={onSplitTerminal}
      onSplitTerminalVertical={onSplitTerminalVertical}
      onNewTerminal={onNewTerminal}
      splitShortcutLabel={splitShortcutLabel}
      splitVerticalShortcutLabel={splitVerticalShortcutLabel}
      newShortcutLabel={newShortcutLabel}
      closeShortcutLabel={closeShortcutLabel}
      onActiveTerminalChange={onActiveTerminalChange}
      onCloseTerminal={onCloseTerminal}
      onHeightChange={() => undefined}
      onAddTerminalContext={onAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
      keybindings={keybindings}
    />
  );
});

// Errors surface through two maps (draft-keyed and thread-keyed) whose entries
// can race around promotion, so each write carries its time to let the latest
// one win when they collide.
type LocalThreadErrorEntry = {
  readonly message: string | null;
  readonly at: number;
};

function chatActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

const ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE = 3;

/**
 * Drops the send-time anchored end space. That space is what holds a sent
 * message near the top while its turn streams, and it keeps LegendList's
 * maintainScrollAtEnd switched off for as long as it is installed — ChatView
 * drives the streaming scrolls itself, but only in "anchoring-new-turn" mode.
 * So every return to the live edge has to release the anchor too, otherwise the
 * timeline settles into "following-end" with nothing following anything.
 */
function releaseChatTimelineAnchor<T extends { readonly messageId: MessageId | null }>(
  current: T,
): T {
  return current.messageId === null ? current : { ...current, messageId: null };
}

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
  } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const threadSyncPhase = routeKind === "server" ? (props.threadSyncPhase ?? null) : null;
  const threadDetailLoading = threadSyncPhase === "loading";
  const handleNewThread = useNewThreadHandler();
  const { settleThread, pinThread, confirmAndUnpinThread } = useThreadActions();
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");
  const closeTerminalMutation = useAtomCommand(terminalEnvironment.close, "terminal close");
  const createThread = useAtomCommand(threadEnvironment.create, {
    reportFailure: false,
  });
  const deleteThread = useAtomCommand(threadEnvironment.delete, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const switchGitRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const setThreadRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const deleteThreadQueuedTurn = useAtomCommand(threadEnvironment.deleteQueuedTurn, {
    reportFailure: false,
  });
  const updateThreadQueuedTurn = useAtomCommand(threadEnvironment.updateQueuedTurn, {
    reportFailure: false,
  });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const recordThreadWorkflow = useAtomCommand(threadEnvironment.recordWorkflow, {
    reportFailure: false,
  });
  const uploadThreadFeedback = useAtomCommand(threadEnvironment.uploadFeedback, {
    reportFailure: false,
  });
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const respondToThreadApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToThreadUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const revertThreadCheckpoint = useAtomCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, {
    reportFailure: false,
  });
  const environmentById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const composerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const routeServerThreadShell = useThreadShell(routeKind === "server" ? routeThreadRef : null);
  const serverThread = useThread(routeThreadRef, { waitForShell: draftThread !== null });
  const loadingServerThread = useMemo(
    () =>
      threadDetailLoading && routeServerThreadShell
        ? buildLoadingThreadFromShell(routeServerThreadShell)
        : null,
    [routeServerThreadShell, threadDetailLoading],
  );
  const activeServerThread = serverThread ?? loadingServerThread;
  // Pagination window state for the routed server thread: drives the
  // "load earlier turns" header when the loaded window has older history.
  const routeThreadState = useEnvironmentThread(
    routeKind === "server" ? routeThreadRef.environmentId : null,
    routeKind === "server" ? routeThreadRef.threadId : null,
  );
  const loadEarlierTurns = useMemo(() => {
    if (routeKind !== "server" || !threadHasOlderTurns(routeThreadState)) {
      return null;
    }
    return {
      loading: routeThreadState.page._tag === "Some" && routeThreadState.page.value.loadingOlder,
      cursor:
        routeThreadState.page._tag === "Some" ? routeThreadState.page.value.beforeCursor : null,
      onLoadEarlier: () => {
        requestOlderThreadTurns(routeThreadRef.environmentId, routeThreadRef.threadId);
      },
    };
  }, [routeKind, routeThreadRef, routeThreadState]);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const settings = useEnvironmentSettings(environmentId);
  // New-thread defaults live in the primary environment's settings.json (the
  // settings UI never writes to remote environments), so read them from the
  // primary server rather than the thread's environment.
  const primaryServerSettings = useAtomValue(primaryServerSettingsAtom);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const citationLocation = useLocation({
    select: (location) => ({
      href: location.href,
      key: location.state.assistantCitationActivation ?? location.state.__TSR_key,
    }),
  });
  const citationRequest = useMemo<AssistantCitationRequest | null>(() => {
    const citation = assistantCitationFromLocation(citationLocation.href);
    return citation && citation.environmentId === environmentId && citation.threadId === threadId
      ? { citation, key: citationLocation.key ?? citationLocation.href }
      : null;
  }, [citationLocation.href, citationLocation.key, environmentId, threadId]);
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerHasUnsentContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget)),
  );
  const composerHasAttachments = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return (draft?.attachments.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftAttachments = useComposerDraftStore((store) => store.addAttachments);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftElementContexts = useComposerDraftStore(
    (store) => store.setElementContexts,
  );
  const setComposerDraftPreviewAnnotations = useComposerDraftStore(
    (store) => store.setPreviewAnnotations,
  );
  const setComposerDraftReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const composerElementContextsRef = useRef<ElementContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const [restingComposerControlsHost, setRestingComposerControlsHost] =
    useState<HTMLDivElement | null>(null);
  const [restingComposerControlsVisible, setRestingComposerControlsVisible] = useState(false);
  const citeAssistantText = useCallback(
    (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => {
      const inserted = composerRef.current?.citeAssistantText(citation, sourceAnchor) ?? false;
      if (!inserted) {
        toastManager.add({
          type: "warning",
          title: "The composer is not ready",
          description:
            "Try citing the selection after the connection or pending input is resolved.",
        });
      }
      return inserted;
    },
    [composerRef],
  );
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  useEffect(() => {
    const item = expandedImage?.images[expandedImage.index];
    if (item?.type !== "video" || item.src === null || !item.src.startsWith("blob:")) return;
    const src = item.src;
    return () => revokeBlobPreviewUrl(src);
  }, [expandedImage]);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions = useMemo(
    () => feedbackSubmissionsByThreadKey[routeThreadKey] ?? [],
    [feedbackSubmissionsByThreadKey, routeThreadKey],
  );
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [optimisticQueuedMessages, setOptimisticQueuedMessages] = useState<ChatMessage[]>([]);
  const optimisticQueuedMessagesRef = useRef(optimisticQueuedMessages);
  optimisticQueuedMessagesRef.current = optimisticQueuedMessages;
  const [locallyCancelledQueuedMessageIds, setLocallyCancelledQueuedMessageIds] = useState<
    ReadonlySet<MessageId>
  >(() => new Set());
  const queuedDeleteInFlightByQueueIdRef = useRef<Set<string>>(new Set());
  const queuedUpdateInFlightByQueueIdRef = useRef<Set<string>>(new Set());
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [maximizedRightPanelThreadKey, setMaximizedRightPanelThreadKey] = useState<string | null>(
    null,
  );
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);

  useEffect(() => {
    setIsWorkspaceFileDragActive(false);
  }, [draftId, routeThreadKey]);

  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalUiLaunchContext, setTerminalUiLaunchContext] =
    useState<TerminalLaunchContext | null>(null);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [selectedMediaArtifactKey, setSelectedMediaArtifactKey] = useState<string | null>(null);
  const [pendingServerThreadEnvMode, setPendingServerThreadEnvMode] =
    useState<DraftThreadEnvMode | null>(null);
  const [pendingServerThreadBranch, setPendingServerThreadBranch] = useState<string | null>();
  const [
    pendingServerThreadStartFromOriginByThreadId,
    setPendingServerThreadStartFromOriginByThreadId,
  ] = useState<Record<string, boolean>>({});
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const getTimelineScrollableNode = useCallback(
    () => legendListRef.current?.getScrollableNode() ?? null,
    [],
  );
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const composerOverlayHeightRef = useRef(0);
  // Space the timeline keeps clear above its end. Tracks the overlay while the
  // composer is expanded and holds that height while it rests, so the resting
  // composer never exposes rows that its expansion will cover.
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const composerRestingRef = useRef(false);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const isAtEndRef = useRef(true);
  const isTimelineAtLogicalEnd = useCallback(() => isAtEndRef.current, []);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const sendInFlightRef = useRef(false);
  const workflowLaneLaunchInFlightRef = useRef<Set<string>>(new Set());
  const workflowLaneLaunchRecordedRef = useRef<Set<string>>(new Set());
  const workflowCompletionInFlightRef = useRef<Set<string>>(new Set());
  const workflowCompletionRecordedRef = useRef<Set<string>>(new Set());
  const environmentUnavailableSendToastSlotRef = useRef(0);
  const feedbackUploadsInFlightRef = useRef(new Set<string>());
  const terminalUiOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalUiStateStore(
    useShallow((state) =>
      Object.entries(state.terminalUiStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalUiState]) =>
          nextTerminalUiState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalUiStateStore((s) => s.setTerminalOpen);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeSplitTerminal = useTerminalUiStateStore((s) => s.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore((s) => s.splitTerminalVertical);
  const storeNewTerminal = useTerminalUiStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((s) => s.closeTerminal);
  const serverThreadRefs = useThreadRefs();
  const serverThreadKeys = useMemo(() => serverThreadRefs.map(scopedThreadKey), [serverThreadRefs]);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = activeServerThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  // Draft errors are keyed by draftId while server errors are keyed by thread
  // key, so a pending draft entry must migrate when the server thread loads or
  // a failed send would silently disappear on promotion. When both keys hold
  // an entry, the most recent write wins.
  useEffect(() => {
    if (!activeServerThread || !draftId) {
      return;
    }
    const pendingDraftEntry = localDraftErrorsByDraftId[draftId];
    if (pendingDraftEntry === undefined) {
      return;
    }
    setLocalDraftErrorsByDraftId((existing) => {
      if (existing[draftId] === undefined) {
        return existing;
      }
      const next = { ...existing };
      delete next[draftId];
      return next;
    });
    setLocalServerErrorsByThreadKey((existing) => {
      const currentEntry = existing[routeThreadKey];
      if (
        currentEntry !== undefined &&
        (currentEntry.at > pendingDraftEntry.at ||
          currentEntry.message === pendingDraftEntry.message)
      ) {
        return existing;
      }
      return {
        ...existing,
        [routeThreadKey]: pendingDraftEntry,
      };
    });
  }, [activeServerThread, draftId, localDraftErrorsByDraftId, routeThreadKey]);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, threadId],
  );
  // Promotion is data-driven: the draft route keeps rendering while the
  // server thread (same pre-allocated ref) starts, so live state must not
  // depend on which route is mounted.
  const isServerThread = activeServerThread !== null;
  const activeThread = activeServerThread ?? localDraftThread;
  const threadError = isServerThread
    ? (localServerError ?? activeServerThread?.session?.lastError ?? null)
    : localDraftError;
  // Dismissals can only mask the shown error, never clear it: a server thread
  // keeps its error in session.lastError, so clearing the local shadow would
  // just fall through to the persisted one. Mask the current error until a
  // different error arrives, mirroring the provider status banner.
  const threadErrorBannerKey = getThreadErrorBannerKey(routeThreadKey, threadError);
  const visibleThreadError = shouldShowThreadErrorBanner(
    routeThreadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(threadErrorBannerKey),
  )
    ? threadError
    : null;
  // Dismissing only mutates the session-scoped mask set, which does not
  // trigger a render on its own; setThreadError(null) can also bail when the
  // local shadow is already empty and the banner is driven purely by
  // session.lastError. Bump a tick so the banner hides immediately. Mirrors
  // the branch mismatch banner.
  const [, setThreadErrorBannerDismissTick] = useState(0);
  const runtimeMode = composerRuntimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  const activeThreadEnvironmentId = activeThread?.environmentId ?? null;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessionsRaw = useKnownTerminalSessions({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessions = useMemo(() => {
    if (activeThreadId === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  }, [activeThreadId, activeThreadKnownSessionsRaw]);
  const activeServerOrderedTerminalIds = useMemo(
    () => activeThreadKnownSessions.map((session) => session.target.terminalId),
    [activeThreadKnownSessions],
  );
  const activeKnownTerminalIds = useMemo(
    () => [...new Set([...activeServerOrderedTerminalIds, ...terminalUiState.terminalIds])],
    [activeServerOrderedTerminalIds, terminalUiState.terminalIds],
  );
  const activeTerminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return labels;
  }, [activeThreadKnownSessions]);
  const activeThreadRef = useMemo(
    () =>
      activeThreadEnvironmentId && activeThreadId
        ? scopeThreadRef(activeThreadEnvironmentId, activeThreadId)
        : null,
    [activeThreadEnvironmentId, activeThreadId],
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeThreadShell = useThreadShell(isServerThread ? activeThreadRef : null);
  const changeRequestSnapshotByKey = useAtomValue(threadChangeRequestSnapshotsAtom);
  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: activeThreadKey, messageId: null });
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff";
  const planSidebarOpen = activeRightPanelKind === "plan";
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const sidebarPrRefreshKeyRef = useRef<string | null>(null);
  const threadPrRelinkKeysRef = useRef(new Map<string, string>());
  const threadPrRelinkWriteRef = useRef(Promise.resolve());
  const activePreviewState = useThreadPreviewState(activeThreadRef);
  usePreviewSession(activeThreadRef);
  const serverConfig = activeThreadEnvironmentId
    ? (environmentById.get(activeThreadEnvironmentId)?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const browserAvailable = isPreviewSupportedInRuntime(serverConfig);
  const activePreviewServerEpoch = activePreviewState.serverEpoch;
  const resolvePreviewRuntimeTabId = useMemo(
    () =>
      activeThreadRef
        ? (tabId: string) => previewRuntimeTabId(activeThreadRef, activePreviewServerEpoch, tabId)
        : undefined,
    [activeThreadRef, activePreviewServerEpoch],
  );
  const activePreviewMiniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, activeThreadRef),
  );
  const panelTerminalIds = useMemo(
    () =>
      new Set(
        rightPanelState.surfaces.flatMap((surface) =>
          surface.kind === "terminal" ? surface.terminalIds : [],
        ),
      ),
    [rightPanelState.surfaces],
  );
  const allocatableActiveTerminalIds = useMemo(
    () => [...new Set([...activeKnownTerminalIds, ...panelTerminalIds])],
    [activeKnownTerminalIds, panelTerminalIds],
  );
  const previewPanelOpen = activeRightPanelKind === "preview" && browserAvailable;
  const rightPanelOpen = rightPanelState.isOpen;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const activeTerminalDrawerPresence = usePanelPresence(
    Boolean(activeThreadKey && terminalUiState.terminalOpen),
    true,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const rightPanelPresenceValue = useMemo(
    () => ({
      activeSurface: activeRightPanelSurface,
      surfaces: rightPanelState.surfaces,
    }),
    [activeRightPanelSurface, rightPanelState.surfaces],
  );
  const rightPanelPresence = usePanelPresence(
    rightPanelOpen && activeThreadRef !== null,
    rightPanelPresenceValue,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const rightPanelPresent = rightPanelPresence.present;
  const rightPanelControlsInPanel = shouldUseRightPanelSheet && rightPanelPresent && rightPanelOpen;
  const rightPanelControlsAtRoot = rightPanelPresent && !shouldUseRightPanelSheet;
  const renderedRightPanelSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  const previewMiniPlayerVisible = shouldRenderPreviewMiniPlayer(
    activePreviewMiniPlayer?.tabId ?? null,
    renderedRightPanelSurface,
  );
  const canMaximizeRightPanel = rightPanelOpen && !shouldUseRightPanelSheet;
  const rightPanelMaximized =
    canMaximizeRightPanel && maximizedRightPanelThreadKey === routeThreadKey;
  const inlineRightPanelOwnsTitleBar = rightPanelOpen && !shouldUseRightPanelSheet;

  useEffect(() => {
    if (!activeThreadRef) return;
    useRightPanelStore
      .getState()
      .reconcileBrowserSurfaces(activeThreadRef, Object.keys(activePreviewState.sessions));
  }, [activePreviewState.sessions, activeThreadRef]);

  useEffect(() => {
    if (!activeThreadRef || !activePreviewMiniPlayer) return;
    const miniTabStillExists = Boolean(activePreviewState.sessions[activePreviewMiniPlayer.tabId]);
    if (!miniTabStillExists) {
      usePreviewMiniPlayerStore.getState().close(activeThreadRef);
    }
  }, [activePreviewMiniPlayer, activePreviewState.sessions, activeThreadRef]);

  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const sourcePlanThreadRef = useMemo(() => {
    const sourceThreadId = activeLatestTurn?.sourceProposedPlan?.threadId;
    if (!activeThread || !sourceThreadId || sourceThreadId === activeThread.id) {
      return null;
    }
    return scopeThreadRef(activeThread.environmentId, sourceThreadId);
  }, [activeLatestTurn?.sourceProposedPlan?.threadId, activeThread]);
  const sourceThreadProposedPlans = useThreadProposedPlans(sourcePlanThreadRef);
  const threadPlanCatalog = useMemo<ThreadPlanCatalogEntry[]>(() => {
    if (!activeThread) {
      return [];
    }
    const entries: ThreadPlanCatalogEntry[] = [
      { id: activeThread.id, proposedPlans: activeThread.proposedPlans },
    ];
    if (sourcePlanThreadRef) {
      entries.push({
        id: sourcePlanThreadRef.threadId,
        proposedPlans: sourceThreadProposedPlans,
      });
    }
    return entries;
  }, [activeThread, sourcePlanThreadRef, sourceThreadProposedPlans]);
  const activeRunningTurnId =
    (activeThread?.session?.status === "running" ? activeThread.session.activeTurnId : null) ??
    (activeLatestTurn?.state === "running" ? activeLatestTurn.turnId : null);
  // Reading a finished thread clears the sidebar's Done badge. The visit is
  // stamped at the turn's completion time — not now/updatedAt — so it clears
  // exactly the completion the user is looking at: a wake or completion that
  // lands later still gets its signal (markThreadVisited never moves the
  // timestamp backwards).
  useEffect(() => {
    const completedAt = serverThread?.latestTurn?.completedAt;
    if (!serverThread?.id || !completedAt) return;
    markThreadVisited(
      scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)),
      completedAt,
    );
  }, [
    markThreadVisited,
    serverThread?.environmentId,
    serverThread?.id,
    serverThread?.latestTurn?.completedAt,
  ]);
  useEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: activeTerminalDrawerPresence.present,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeTerminalDrawerPresence.present, activeThreadKey, existingOpenTerminalThreadKeys]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProjectRef = useMemo(
    () =>
      activeThread ? scopeProjectRef(activeThread.environmentId, activeThread.projectId) : null,
    [activeThread?.environmentId, activeThread?.projectId],
  );
  const activeProject = useProject(activeProjectRef);
  const handleNewThreadInActiveProject = useCallback(() => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  }, [activeProjectRef, handleNewThread]);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const activeDraftLogicalProjectKey =
    !isServerThread && activeProject
      ? deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings)
      : undefined;
  const handleOpenDraftProjectSettings = useCallback(() => {
    if (!activeDraftLogicalProjectKey) return;
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: activeDraftLogicalProjectKey },
    });
  }, [activeDraftLogicalProjectKey, navigate]);
  const activeEnvironmentShell = useEnvironmentQuery(
    activeThread ? environmentShell.stateAtom(activeThread.environmentId) : null,
  );
  const activeEnvironmentBootstrapComplete = activeEnvironmentShell.data?.snapshot._tag === "Some";
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const clientSettingsHydrated = useClientSettingsHydrated();
  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = useCallback(
    (relativePath: string, pending: boolean) => {
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
    },
    [activeProjectKey],
  );
  const configuredPreviewUrls = useMemo(
    () => getConfiguredPreviewUrls(activeProject?.scripts),
    [activeProject?.scripts],
  );

  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  // Compute the list of environments this logical project spans, used to
  // drive the environment picker in BranchToolbar.
  const allProjects = useProjects();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  useEffect(() => {
    if (!activeThreadRef || !activeProjectRef) return;
    registerFaviconProjectForThread(activeThreadRef, activeProjectRef);
  }, [activeProjectRef, activeThreadRef]);
  useEffect(() => {
    if (!clientSettingsHydrated || !activeThreadRef || !activeProject) return;
    // Reuse the sidebar's grouping so history follows the project rows the user
    // sees. Deriving the key from the active project alone would miss the
    // identity a duplicate row borrows from its siblings.
    const logicalKeyByPhysicalKey = buildPhysicalToLogicalProjectKeyMap({
      projects: allProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
    });
    useBrowserHistoryStore
      .getState()
      .registerThreadProject(
        activeThreadRef,
        logicalKeyByPhysicalKey.get(derivePhysicalProjectKey(activeProject)) ??
          deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings),
      );
  }, [
    activeProject,
    activeThreadRef,
    allProjects,
    clientSettingsHydrated,
    primaryEnvironmentId,
    projectGroupingSettings,
  ]);
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironmentConnectionPhase !== "connected";
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" ||
    activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  const [reconnectWarningGraceElapsedEnvironmentId, setReconnectWarningGraceElapsedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const reconnectWarningGraceElapsed = hasEnvironmentReconnectWarningGraceElapsed(
    activeReconnectingEnvironmentId,
    reconnectWarningGraceElapsedEnvironmentId,
  );
  useEffect(() => {
    setReconnectWarningGraceElapsedEnvironmentId(null);
    if (activeReconnectingEnvironmentId === null) return;
    return scheduleEnvironmentReconnectWarning(() =>
      setReconnectWarningGraceElapsedEnvironmentId(activeReconnectingEnvironmentId),
    );
  }, [activeReconnectingEnvironmentId]);
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = useMemo<EnvironmentUnavailableState | null>(() => {
    if (!activeEnvironmentUnavailable || !activeEnvironmentUnavailableLabel || !activeEnvironment) {
      return null;
    }

    return {
      environmentId: activeEnvironment.environmentId,
      label: activeEnvironmentUnavailableLabel,
      connection: activeEnvironment.connection,
    };
  }, [activeEnvironment, activeEnvironmentUnavailable, activeEnvironmentUnavailableLabel]);
  const handleReconnectActiveEnvironment = useCallback(
    async (environmentId: EnvironmentId) => {
      const result = await retryEnvironment(environmentId);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not reconnect environment",
            description: error instanceof Error ? error.message : "Failed to reconnect.",
          }),
        );
      }
    },
    [retryEnvironment],
  );
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const memberProjects = allProjects.filter(
      (p) => deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) === logicalKey,
    );
    const seen = new Set<string>();
    const envs: EnvironmentOption[] = [];
    for (const p of memberProjects) {
      if (seen.has(p.environmentId)) continue;
      seen.add(p.environmentId);
      const isPrimary = p.environmentId === primaryEnvironmentId;
      const environment = environmentById.get(p.environmentId) ?? null;
      envs.push({
        environmentId: p.environmentId,
        projectId: p.id,
        label: environment?.label ?? p.environmentId,
        isPrimary,
        machine: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
      });
    }
    // Sort: primary first, then alphabetical
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [activeProject, allProjects, projectGroupingSettings, primaryEnvironmentId, environmentById]);
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
  const activeEnvironmentOption =
    logicalProjectEnvironments.find(
      (environment) => environment.environmentId === activeThread?.environmentId,
    ) ?? null;
  const showComposerEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftThreadContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            threadId: storedDraftSession.threadId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.threadId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerThread &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftThreadContext(draftId, input);
        setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
          threadId: activeDraftSession.threadId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          ...input,
        });
        return activeDraftSession.threadId;
      }

      const nextDraftId = newDraftId();
      const nextThreadId = newThreadId();
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
        threadId: nextThreadId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(nextDraftId),
      });
      return nextThreadId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerThread,
      navigate,
      projectGroupingSettings,
      routeKind,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
  });
  // Once a thread selects an environment, never substitute the primary
  // environment's config while the selected environment is still loading.
  const pullRequestsCapabilityKnown = serverConfig !== null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  const attachmentEnvironmentConfig = environmentById.get(environmentId)?.serverConfig ?? null;
  const attachmentUploadsCapabilityKnown = attachmentEnvironmentConfig !== null;
  const supportsAttachmentUploads =
    attachmentEnvironmentConfig?.environment.capabilities.attachmentUploads === true;
  const advertisedFileAttachmentBytes =
    attachmentEnvironmentConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const maxFileAttachmentBytes =
    advertisedFileAttachmentBytes === null
      ? null
      : clampFileAttachmentUploadBytes(advertisedFileAttachmentBytes);
  const supportsSpeechTranscription =
    attachmentEnvironmentConfig?.environment.capabilities.speechTranscription === true;
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeThread
      ? buildVersionMismatchDismissalKey(activeThread.environmentId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const hasMultipleRegisteredEnvironments = environments.length > 1;
  const versionMismatchServerLabel =
    hasMultipleRegisteredEnvironments && activeThread
      ? `${environmentById.get(activeThread.environmentId)?.label ?? serverConfig?.environment.label ?? activeThread.environmentId} server`
      : "server";
  const serverUpdateEnvironmentId = activeThread?.environmentId ?? null;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const versionMismatchThreadContinuation = supportsServerUpdateThreadContinuation(serverConfig);
  const serverUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(serverUpdateEnvironmentId),
  );
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<
    typeof serverUpdateState | null
  >(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState ||
    isServerUpdateFailureDismissed(serverUpdateState);
  const systemComposerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    const updateRunning = serverUpdateState.status === "running";
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    // Reconnecting to a version-skewed server with no update in flight
    // usually means the server is restarting mid-update and a refresh wiped
    // the in-memory update state. Fold the reconnect and version banners
    // into one calm line instead of stacking "Failed to connect" on
    // "versions differ". A failed update never folds: its error and retry
    // action must stay visible.
    const reconnectingThroughVersionSkew =
      serverUpdateState.status === "idle" && environmentReconnecting && versionMismatch !== null;
    // While an update runs, transient connect blips are expected (the server
    // restarts) and the update banner already shows progress. Hard failure
    // phases still surface so the Reconnect action stays reachable.
    const suppressUnavailableBanner =
      environmentReconnecting &&
      (updateRunning || (!reconnectingThroughVersionSkew && !reconnectWarningGraceElapsed));
    if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      if (reconnectingThroughVersionSkew) {
        items.push({
          id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
          variant: "default",
          // Prioritize live connection progress among the notices.
          priority: "urgent",
          icon: (
            <span
              className="size-1.5 animate-status-pulse rounded-full bg-foreground"
              aria-hidden="true"
            />
          ),
          title: `${unavailableConnection.phase === "connecting" ? "Connecting" : "Reconnecting"} to ${activeEnvironmentUnavailableState.label}`,
          description: "Finishing an update",
        });
      } else {
        items.push({
          id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
          variant: unavailableConnection.phase === "error" ? "error" : "warning",
          icon: <WifiOffIcon />,
          title: `${activeEnvironmentUnavailableState.label} is ${environmentReconnecting ? "reconnecting" : "offline"}`,
          description: environmentReconnecting ? "Trying again" : "Reconnect to continue",
          actions: (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={environmentReconnecting}
                onClick={() =>
                  void handleReconnectActiveEnvironment(
                    activeEnvironmentUnavailableState.environmentId,
                  )
                }
              >
                {environmentReconnecting ? "Reconnecting..." : "Reconnect"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void navigate({ to: "/settings/connections" })}
              >
                Connections
              </Button>
            </>
          ),
        });
      }
    }
    if (
      serverUpdateEnvironmentId &&
      !reconnectingThroughVersionSkew &&
      (serverUpdateState.status === "idle"
        ? showVersionMismatchBanner
        : !serverUpdateFailureDismissed)
    ) {
      const updateInProgress = serverUpdateState.status === "running";
      const updateFailed = serverUpdateState.status === "failed";
      items.push({
        id: `server-version:${serverUpdateEnvironmentId}`,
        variant: updateFailed ? "error" : "default",
        // Prioritize update progress over passive notices, but keep activity attached.
        priority: updateInProgress ? "urgent" : "notice",
        icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
        title:
          updateInProgress || updateFailed ? (
            <ComposerServerUpdateStatus
              state={serverUpdateState}
              serverLabel={versionMismatchServerLabel}
            />
          ) : versionMismatch ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="block max-w-full cursor-help truncate rounded-sm text-left"
                  >
                    Server update available
                  </button>
                }
              />
              <TooltipPopup side="top">
                {versionMismatchServerLabel} {versionMismatch.serverVersion}{" "}
                <span aria-hidden="true">→</span> {versionMismatch.clientVersion}
              </TooltipPopup>
            </Tooltip>
          ) : (
            "Server update available"
          ),
        description:
          !updateInProgress &&
          !updateFailed &&
          versionMismatchSelfUpdate !== null &&
          (versionMismatchSelfUpdate !== "desktop-managed" || !versionMismatchDesktopAppUpdate)
            ? serverUpdateGuidance(versionMismatchSelfUpdate)
            : undefined,
        actions:
          updateInProgress ||
          !versionMismatch ||
          (versionMismatchSelfUpdate === "desktop-managed" &&
            !versionMismatchDesktopAppUpdate) ? undefined : (
            <ServerUpdateAction
              environmentId={serverUpdateEnvironmentId}
              serverLabel={versionMismatchServerLabel}
              selfUpdate={versionMismatchSelfUpdate}
              desktopAppUpdate={versionMismatchDesktopAppUpdate}
              threadContinuation={versionMismatchThreadContinuation}
              targetVersion={versionMismatch.clientVersion}
              label={updateFailed ? "Retry" : "Update"}
              variant="ghost"
            />
          ),
        ...(updateInProgress || (!updateFailed && !versionMismatchDismissKey)
          ? {}
          : {
              dismissLabel: "Dismiss update notice",
              onDismiss: () => {
                if (updateFailed) {
                  dismissServerUpdateFailure(serverUpdateState);
                  setDismissedServerUpdateState(serverUpdateState);
                }
                dismissVersionMismatch(versionMismatchDismissKey);
                setDismissedVersionMismatchKey(versionMismatchDismissKey);
              },
            }),
      });
    }
    return items;
  }, [
    activeEnvironmentUnavailableState,
    reconnectWarningGraceElapsed,
    handleReconnectActiveEnvironment,
    navigate,
    setDismissedVersionMismatchKey,
    showVersionMismatchBanner,
    serverUpdateFailureDismissed,
    serverUpdateState,
    versionMismatch,
    versionMismatchDismissKey,
    serverUpdateEnvironmentId,
    versionMismatchSelfUpdate,
    versionMismatchDesktopAppUpdate,
    versionMismatchThreadContinuation,
    versionMismatchServerLabel,
  ]);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const providerInstanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
      ),
    [providerStatuses, settings],
  );
  const { selectedProviderEntry, requestedDriverKind } = useMemo(
    () =>
      resolveComposerProviderSelection({
        entries: providerInstanceEntries,
        candidateInstanceIds: [
          selectedProviderByThreadId,
          activeThread?.session?.providerInstanceId,
          activeThread?.modelSelection.instanceId,
          activeProject?.defaultModelSelection?.instanceId,
        ],
        lockedProvider,
        lockedInstanceId:
          activeThread?.session?.providerInstanceId ?? activeThread?.modelSelection.instanceId,
      }),
    [
      activeProject?.defaultModelSelection?.instanceId,
      activeThread?.modelSelection.instanceId,
      activeThread?.session?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProviderByThreadId,
    ],
  );
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const { enabled: interactionModeEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: activeProviderStatus,
    interactionMode:
      composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
  });
  const conversationProviderStatus =
    providerStatuses.find(
      (status) => status.instanceId === activeThread?.session?.providerInstanceId,
    ) ?? activeProviderStatus;
  const supportsConversationRollback =
    conversationProviderStatus !== null &&
    conversationProviderStatus.supportsConversationRollback !== false;
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const latestCheckpointCompletedAt = activeThread?.checkpoints.at(-1)?.completedAt ?? null;
  const workspaceMutationId = useMemo(() => {
    const activityId = latestWorkspaceMutationId(threadActivities);
    return activityId === null && latestCheckpointCompletedAt === null
      ? null
      : JSON.stringify([activityId, latestCheckpointCompletedAt]);
  }, [latestCheckpointCompletedAt, threadActivities]);
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(threadActivities),
    [threadActivities],
  );
  const workLogEntries = useMemo(() => deriveWorkLogEntries(threadActivities), [threadActivities]);
  // Native subagent fold: memoized by activity-list identity, shared by the
  // Agents surface, live strip, and workflow cards. v2Projection is null
  // until orchestration-v2 lands (source precedence lives in the derive).
  // sessionLive derives interruption for agents orphaned by session death.
  const agentSessionLive = phase !== "disconnected";
  const agentPanelModel = useMemo(
    () =>
      deriveAgentPanelModel({
        agents: foldSubagentActivities(threadActivities, { sessionLive: agentSessionLive }),
      }),
    [agentSessionLive, threadActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const workflowChildCompletionsAtom = useMemo(
    () =>
      Atom.make((get): WorkflowChildCompletionObservation[] => {
        if (!activeThread) return [];
        return workflowChildCompletionObservations({
          parentThread: activeThread,
          childThreadForId: (childThreadId) =>
            get(
              environmentThreadDetails.detailAtom(
                scopeThreadRef(activeThread.environmentId, childThreadId),
              ),
            ),
        });
      }).pipe(Atom.withLabel(`workflow-child-completions:${routeThreadKey}`)),
    [activeThread, routeThreadKey],
  );
  const workflowChildCompletions = useAtomValue(workflowChildCompletionsAtom);
  const workflowLaneRunDetailsAtom = useMemo(
    () =>
      Atom.make((get): WorkflowLaneRunDetail[] => {
        if (!activeThread) return [];
        return workflowLaneRunDetails({
          parentThread: activeThread,
          childThreadForId: (childThreadId) =>
            get(
              environmentThreadDetails.detailAtom(
                scopeThreadRef(activeThread.environmentId, childThreadId),
              ),
            ),
        });
      }).pipe(Atom.withLabel(`workflow-lane-run-details:${routeThreadKey}`)),
    [activeThread, routeThreadKey],
  );
  const workflowLaneRunDetailsForSidebar = useAtomValue(workflowLaneRunDetailsAtom);
  const workflowSidebarActive = interactionMode === "workflow";
  const planSidebarLabel = workflowSidebarActive
    ? "Workflow"
    : sidebarProposedPlan || interactionMode === "plan"
      ? "Plan"
      : "Tasks";
  // Current step for the in-chat working row: only for the running turn's own
  // plan (deriveActivePlanState falls back to older turns' plans, which must
  // not label fresh work). Falls back to the first pending step so an
  // all-pending freshly written plan labels the row, matching the chip and
  // the server's planProgress.
  const workingStepLabel = useMemo(() => {
    if (!activePlan || activePlan.turnId !== (activeLatestTurn?.turnId ?? null)) {
      return null;
    }
    return (
      activePlan.steps.find((step) => step.status === "inProgress")?.step ??
      activePlan.steps.find((step) => step.status === "pending")?.step ??
      null
    );
  }, [activeLatestTurn?.turnId, activePlan]);
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    latestUserMessageAt,
    isPreparingWorktree,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const pendingCompactionMessage =
    isSendBusy &&
    optimisticCompactionMessage !== undefined &&
    isCompactCommandMessage(optimisticCompactionMessage)
      ? optimisticCompactionMessage
      : activeThread?.messages.findLast(isCompactCommandMessage);
  const compactRequestIsActive =
    pendingCompactionMessage !== undefined &&
    (pendingCompactionMessage.createdAt >
      (activeLatestTurn?.requestedAt ?? pendingCompactionMessage.createdAt) ||
      (activeLatestTurn?.state === "running" &&
        pendingCompactionMessage.createdAt === activeLatestTurn.requestedAt));
  const compactionSettled =
    pendingCompactionMessage !== undefined &&
    (latestTurnStartFailureId(activeThread, pendingCompactionMessage.id) !== null ||
      activeThread?.activities.some((activity) => {
        if (activity.kind !== "context-compaction") return false;
        const payload = activity.payload as { readonly requestId?: unknown } | null | undefined;
        return payload?.requestId === pendingCompactionMessage.id;
      }));
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    compactRequestIsActive &&
    !compactionSettled;
  const isWorking =
    phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint || isCompacting;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
    latestUserMessageAt,
  );
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
      for (const message of optimisticQueuedMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const nextPreviewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!nextPreviewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  const serverMessages = activeThread?.messages;
  const [projectServerMessagePreviews] = useState(createMessageAttachmentPreviewProjector);
  const [projectHandoffMessagePreviews] = useState(createMessageAttachmentPreviewProjector);
  const downloadFileAttachment = useCallback(
    async (attachment: ChatFileAttachment) => {
      const connection = readPreparedConnection(environmentId);
      if (!connection) {
        toastManager.add({ type: "error", title: "The environment is not connected." });
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
          title: "Could not download " + attachment.name,
          description: error instanceof Error ? error.message : "The attachment is unavailable.",
        });
      }
    },
    [createAttachmentAssetUrl, environmentId],
  );
  const openFileAttachment = useCallback(
    (attachment: ChatFileAttachment) => {
      if (isBrowserPreviewAttachment(attachment) && activeThreadRef) {
        useRightPanelStore.getState().openAttachment(activeThreadRef, attachment);
        return;
      }
      void downloadFileAttachment(attachment);
    },
    [activeThreadRef, downloadFileAttachment],
  );
  const serverAttachmentResources = useMemo(
    () => selectHandoffImageResources(serverMessages, attachmentPreviewHandoffByMessageId),
    [serverMessages, attachmentPreviewHandoffByMessageId],
  );
  const serverAttachmentUrls = useAssetUrls(environmentId, serverAttachmentResources);
  const serverAttachmentUrlById = useMemo(
    () =>
      new Map(
        serverAttachmentResources.flatMap((resource, index) => {
          const url = serverAttachmentUrls[index];
          return url ? [[resource.attachmentId, url] as const] : [];
        }),
      ),
    [serverAttachmentResources, serverAttachmentUrls],
  );
  const displayServerMessages = useMemo<ReadonlyArray<ChatMessage>>(() => {
    if (!serverMessages) return [];
    return serverMessages.map((message) =>
      projectServerMessagePreviews(message, (attachment) =>
        serverAttachmentUrlById.get(attachment.id),
      ),
    );
  }, [projectServerMessagePreviews, serverAttachmentUrlById, serverMessages]);
  useEffect(() => {
    if (typeof Image === "undefined" || displayServerMessages.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    const userMessagesById = new Map<string, ChatMessage>(
      displayServerMessages
        .filter((message) => message.role === "user")
        .map((message) => [String(message.id), message] as const),
    );

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = userMessagesById.get(messageId);
      if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        isImageAttachment(attachment) && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [attachmentPreviewHandoffByMessageId, clearAttachmentPreviewHandoff, displayServerMessages]);
  const activeQueuedTurns = useMemo(
    () =>
      (activeThread?.queuedTurns ?? []).filter(
        (
          turn,
        ): turn is typeof turn & {
          status: "queued" | "dispatching";
        } => turn.status === "queued" || turn.status === "dispatching",
      ),
    [activeThread?.queuedTurns],
  );
  const pendingQueuedTurns = useMemo(
    () => activeQueuedTurns.filter(isPendingQueuedTurn),
    [activeQueuedTurns],
  );
  const activeQueuedMessageIds = useMemo(() => {
    const ids = new Set<MessageId>();
    for (const turn of pendingQueuedTurns) {
      ids.add(turn.messageId);
    }
    for (const message of optimisticQueuedMessages) {
      ids.add(message.id);
    }
    for (const messageId of locallyCancelledQueuedMessageIds) {
      ids.add(messageId);
    }
    if (activeThread) {
      for (const message of displayServerMessages) {
        if (
          pendingQueuedMessageDeleteKeys.has(
            queuedMessageDeleteKey(environmentId, activeThread.id, message.id),
          )
        ) {
          ids.add(message.id);
        }
      }
    }
    return ids;
  }, [
    activeThread,
    environmentId,
    locallyCancelledQueuedMessageIds,
    optimisticQueuedMessages,
    pendingQueuedTurns,
    displayServerMessages,
  ]);
  const timelineMessages = useMemo(() => {
    const messages = displayServerMessages.filter(
      (message) => !activeQueuedMessageIds.has(message.id),
    );
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let imageIndex = 0;
            return projectHandoffMessagePreviews(message, (attachment) => {
              if (!isImageAttachment(attachment)) {
                return undefined;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              return handoffPreviewUrl;
            });
          });

    const localMessages = [
      ...optimisticUserMessages,
      ...feedbackSubmissions.flatMap((submission) =>
        submission.status === "interrupted"
          ? []
          : [codexFeedbackMessage(submission), codexFeedbackMessage(submission, "assistant")],
      ),
    ];
    if (localMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = localMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [
    activeQueuedMessageIds,
    attachmentPreviewHandoffByMessageId,
    displayServerMessages,
    feedbackSubmissions,
    optimisticUserMessages,
    projectHandoffMessagePreviews,
  ]);
  const timelineProjectionRef = useRef<{
    threadKey: string | null;
    projection: TimelineEntriesProjection;
  } | null>(null);
  const timelineEntries = useMemo(() => {
    const previous = timelineProjectionRef.current;
    const projection = deriveTimelineEntriesWithState(
      timelineMessages,
      activeThread?.proposedPlans ?? [],
      workLogEntries,
      previous?.threadKey === activeThreadKey ? previous.projection : null,
    );
    timelineProjectionRef.current = { threadKey: activeThreadKey, projection };
    return projection.entries;
  }, [
    timelineProjectionRef,
    activeThreadKey,
    activeThread?.proposedPlans,
    timelineMessages,
    workLogEntries,
  ]);
  const queuedMessageItems = useMemo<ReadonlyArray<QueuedMessageItem>>(() => {
    const messagesById = new Map(displayServerMessages.map((message) => [message.id, message]));
    const serverItems = pendingQueuedTurns.flatMap((turn): QueuedMessageItem[] => {
      if (
        activeThread &&
        pendingQueuedMessageDeleteKeys.has(
          queuedMessageDeleteKey(environmentId, activeThread.id, turn.messageId),
        )
      ) {
        return [];
      }
      if (locallyCancelledQueuedMessageIds.has(turn.messageId)) return [];
      const message = messagesById.get(turn.messageId);
      if (!message || message.role !== "user") return [];
      return [
        {
          id: message.id,
          queueId: turn.queueId,
          text: message.text,
          status: turn.status,
          createdAt: message.createdAt,
        },
      ];
    });
    const knownIds = new Set(serverItems.map((item) => item.id));
    const optimisticItems = optimisticQueuedMessages
      .filter(
        (message) => !knownIds.has(message.id) && !locallyCancelledQueuedMessageIds.has(message.id),
      )
      .map((message): QueuedMessageItem => ({
        id: message.id,
        queueId: null,
        text: message.text,
        status: "queued",
        createdAt: message.createdAt,
      }));
    return [...serverItems, ...optimisticItems];
  }, [
    activeThread,
    environmentId,
    locallyCancelledQueuedMessageIds,
    optimisticQueuedMessages,
    pendingQueuedTurns,
    displayServerMessages,
  ]);
  const threadMediaArtifacts = useMemo(
    () => collectThreadMediaArtifacts(timelineMessages),
    [timelineMessages],
  );
  const displayableThreadMediaArtifacts = useDisplayableMediaArtifacts({
    environmentId,
    threadRef: activeThreadRef,
    artifacts: threadMediaArtifacts,
  });
  const selectedThreadMediaArtifact = useMemo(
    () =>
      displayableThreadMediaArtifacts.find(
        (artifact) => artifact.dedupeKey === selectedMediaArtifactKey,
      ) ?? null,
    [displayableThreadMediaArtifacts, selectedMediaArtifactKey],
  );
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: timelineEntries.length > 0,
    isWorking,
    draftHeroDockRequested,
    backgroundSubmissionPending,
  });
  const [
    attachDraftHeroTransitionGroupRef,
    attachDraftHeroComposerAnchorRef,
    captureDraftHeroComposerRect,
  ] = useDraftHeroLayoutTransition(isDraftHeroState);
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const lastRevertTurnCountRef = useRef<Map<MessageId, number> | null>(null);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const next = buildRevertTurnCountByUserMessageId(
      {
        supportsConversationRollback,
        timelineEntries,
        turnDiffSummaryByAssistantMessageId,
        inferredCheckpointTurnCountByTurnId,
      },
      lastRevertTurnCountRef.current,
    );
    lastRevertTurnCountRef.current = next;
    return next;
  }, [
    supportsConversationRollback,
    inferredCheckpointTurnCountByTurnId,
    timelineEntries,
    turnDiffSummaryByAssistantMessageId,
  ]);

  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusQuery = useEnvironmentQuery(
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        }),
  );
  useWorkspaceMutationRefresh({
    enabled: gitStatusCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatusQuery.refresh,
    resourceKey: `git-status:${activeThreadKey ?? ""}:${gitStatusCwd ?? ""}`,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const manualCompactionProviderAvailable = useMemo(
    () =>
      hasAvailableCompactionProvider({
        providers: providerInstanceEntries,
        driverKind: selectedProvider,
        instanceId: activeProviderInstanceId,
        lockedInstanceId: lockedProvider
          ? (activeThread?.session?.providerInstanceId ??
            activeThread?.modelSelection.instanceId ??
            null)
          : null,
      }),
    [
      activeProviderInstanceId,
      activeThread?.modelSelection.instanceId,
      activeThread?.session?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ],
  );
  const [resumeCompactionPermanentlyDismissed, setResumeCompactionPermanentlyDismissed] =
    useLocalStorage(
      `t3code:resume-compaction-dismissed:${environmentId}:${activeProviderInstanceId ?? "claudeAgent"}`,
      false,
      Schema.Boolean,
    );
  const nativeResumeCompactionDismissed = useMemo(
    () => hasDismissedResumeCompaction(threadActivities),
    [threadActivities],
  );
  useEffect(() => {
    if (nativeResumeCompactionDismissed && !resumeCompactionPermanentlyDismissed) {
      setResumeCompactionPermanentlyDismissed(true);
    }
  }, [
    nativeResumeCompactionDismissed,
    resumeCompactionPermanentlyDismissed,
    setResumeCompactionPermanentlyDismissed,
  ]);
  const providerStatusBannerKey = getProviderStatusBannerKey(activeProviderStatus);
  const [dismissedProviderStatusBannerKey, setDismissedProviderStatusBannerKey] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (providerStatusBannerKey === null && dismissedProviderStatusBannerKey !== null) {
      setDismissedProviderStatusBannerKey(null);
    }
  }, [dismissedProviderStatusBannerKey, providerStatusBannerKey]);
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    dismissedProviderStatusBannerKey,
  )
    ? activeProviderStatus
    : null;
  const hasTimelineTopBanner = Boolean(visibleThreadError) || visibleProviderStatus !== null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalUiLaunchContext?.threadId === activeThreadId ? terminalUiLaunchContext : null;
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  // Keep a hidden, off-flow strip mounted for existing threads so the composer
  // can measure whether its relocated controls fit. The visible chrome remains
  // content-driven: Git/environment context or controls that actually fit.
  const mountComposerContextStrip = shouldShowComposerContextStrip({
    hasActiveProject: activeProject !== null,
    isGitRepo,
    showEnvironmentIndicator: showComposerEnvironmentIndicator,
    hostsRestingComposerControls: routeKind === "server",
  });
  const showComposerContextStrip = shouldShowComposerContextStrip({
    hasActiveProject: activeProject !== null,
    isGitRepo,
    showEnvironmentIndicator: showComposerEnvironmentIndicator,
    hostsRestingComposerControls: routeKind === "server" && restingComposerControlsVisible,
  });
  const initialDiffPanelGitScope =
    gitStatusQuery.data?.hasWorkingTreeChanges === true ? "unstaged" : "branch";
  const diffPanelGitStatusResolutionKey = gitStatusQuery.data ? "resolved" : "pending";
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalUiState.terminalOpen),
      },
    }),
    [terminalUiState.terminalOpen],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const splitTerminalVerticalShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "terminal.splitVertical", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const onToggleDiff = useCallback(() => {
    if (!isServerThread) {
      return;
    }
    if (!diffOpen) {
      onDiffPanelOpen?.();
    }
    if (activeThreadRef) {
      useRightPanelStore.getState().toggle(activeThreadRef, "diff");
    }
  }, [activeThreadRef, diffOpen, isServerThread, onDiffPanelOpen]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "stopped")),
  );

  // Handle environment change for draft threads.  When the user picks a
  // different environment we update the draft context to point at the physical
  // project in that environment while keeping the same logical project.
  const onEnvironmentChange = useCallback(
    (nextEnvironmentId: EnvironmentId) => {
      if (envLocked || !draftId) return;
      const target = logicalProjectEnvironments.find(
        (env) => env.environmentId === nextEnvironmentId,
      );
      if (!target) return;
      setDraftThreadContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [draftId, envLocked, logicalProjectEnvironments, setDraftThreadContext],
  );

  const activeTerminalGroup =
    terminalUiState.terminalGroups.find(
      (group) => group.id === terminalUiState.activeTerminalGroupId,
    ) ??
    terminalUiState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalUiState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      const nextError = sanitizeThreadErrorMessage(error);
      const nextEntry: LocalThreadErrorEntry = { message: nextError, at: Date.now() };
      if (
        shouldWriteThreadErrorToCurrentServerThread({
          activeServerThread,
          routeThreadRef,
          targetThreadId,
        })
      ) {
        setLocalServerErrorsByThreadKey((existing) => {
          if ((existing[routeThreadKey]?.message ?? null) === nextError) {
            return existing;
          }
          return {
            ...existing,
            [routeThreadKey]: nextEntry,
          };
        });
        return;
      }
      const localDraftErrorKey = draftId ?? targetThreadId;
      setLocalDraftErrorsByDraftId((existing) => {
        if ((existing[localDraftErrorKey]?.message ?? null) === nextError) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextEntry,
        };
      });
    },
    [activeServerThread, draftId, routeThreadKey, routeThreadRef],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, [composerRef]);
  const updateQueuedMessage = useCallback(
    async (item: QueuedMessageItem, text: string): Promise<boolean> => {
      const threadId = activeThread?.id;
      if (!threadId) return false;
      if (text.trim().length === 0) {
        setThreadError(threadId, "Queued message cannot be empty.");
        return false;
      }
      if (item.queueId === null) {
        setThreadError(threadId, "This queued message is still being saved.");
        return false;
      }
      const inFlightKey = item.queueId;
      if (queuedUpdateInFlightByQueueIdRef.current.has(inFlightKey)) return false;
      queuedUpdateInFlightByQueueIdRef.current.add(inFlightKey);
      try {
        const result = await updateThreadQueuedTurn({
          environmentId,
          input: {
            threadId,
            queueId: item.queueId,
            messageId: item.id,
            text,
            createdAt: new Date().toISOString(),
          },
        });
        if (result._tag !== "Failure") {
          setThreadError(threadId, null);
          return true;
        }
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setThreadError(
            threadId,
            error instanceof Error ? error.message : "Failed to edit queued message.",
          );
        }
        return false;
      } catch (err: unknown) {
        setThreadError(
          threadId,
          err instanceof Error ? err.message : "Failed to edit queued message.",
        );
        return false;
      } finally {
        queuedUpdateInFlightByQueueIdRef.current.delete(inFlightKey);
      }
    },
    [activeThread?.id, environmentId, setThreadError, updateThreadQueuedTurn],
  );
  const dispatchQueuedMessageDelete = useCallback(
    (input: { queueId: string | null; messageId: MessageId }) => {
      const threadId = activeThread?.id;
      if (!threadId) return;
      const pendingKey = queuedMessageDeleteKey(environmentId, threadId, input.messageId);
      const inFlightKey = input.queueId ?? pendingKey;
      if (queuedDeleteInFlightByQueueIdRef.current.has(inFlightKey)) return;
      queuedDeleteInFlightByQueueIdRef.current.add(inFlightKey);
      void deleteThreadQueuedTurn({
        environmentId,
        input: {
          threadId,
          ...(input.queueId !== null ? { queueId: input.queueId } : {}),
          messageId: input.messageId,
          createdAt: new Date().toISOString(),
        },
      })
        .then((result) => {
          if (result._tag !== "Failure") {
            pendingQueuedMessageDeleteKeys.delete(pendingKey);
            return;
          }
          if (input.queueId === null) {
            return;
          }
          pendingQueuedMessageDeleteKeys.delete(pendingKey);
          setLocallyCancelledQueuedMessageIds((existing) => {
            if (!existing.has(input.messageId)) return existing;
            const next = new Set(existing);
            next.delete(input.messageId);
            return next;
          });
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            setThreadError(
              threadId,
              error instanceof Error ? error.message : "Failed to delete queued message.",
            );
          }
        })
        .catch((err: unknown) => {
          if (input.queueId === null) {
            return;
          }
          pendingQueuedMessageDeleteKeys.delete(pendingKey);
          setLocallyCancelledQueuedMessageIds((existing) => {
            if (!existing.has(input.messageId)) return existing;
            const next = new Set(existing);
            next.delete(input.messageId);
            return next;
          });
          setThreadError(
            threadId,
            err instanceof Error ? err.message : "Failed to delete queued message.",
          );
        })
        .finally(() => {
          queuedDeleteInFlightByQueueIdRef.current.delete(inFlightKey);
        });
    },
    [activeThread?.id, deleteThreadQueuedTurn, environmentId, setThreadError],
  );
  const deleteQueuedMessage = useCallback(
    (item: QueuedMessageItem) => {
      setLocallyCancelledQueuedMessageIds((existing) => {
        if (existing.has(item.id)) return existing;
        const next = new Set(existing);
        next.add(item.id);
        return next;
      });
      if (activeThread) {
        pendingQueuedMessageDeleteKeys.add(
          queuedMessageDeleteKey(environmentId, activeThread.id, item.id),
        );
      }
      if (item.queueId === null) {
        setOptimisticQueuedMessages((existing) => {
          const removed = existing.filter((message) => message.id === item.id);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          return existing.filter((message) => message.id !== item.id);
        });
        return;
      }
      dispatchQueuedMessageDelete({
        queueId: item.queueId,
        messageId: item.id,
      });
    },
    [dispatchQueuedMessageDelete],
  );
  useEffect(() => {
    if (locallyCancelledQueuedMessageIds.size === 0 && pendingQueuedMessageDeleteKeys.size === 0) {
      return;
    }
    for (const turn of activeQueuedTurns) {
      const pendingKey = activeThread
        ? queuedMessageDeleteKey(environmentId, activeThread.id, turn.messageId)
        : null;
      if (
        !locallyCancelledQueuedMessageIds.has(turn.messageId) &&
        (pendingKey === null || !pendingQueuedMessageDeleteKeys.has(pendingKey))
      ) {
        continue;
      }
      dispatchQueuedMessageDelete({
        queueId: turn.queueId,
        messageId: turn.messageId,
      });
    }
  }, [
    activeQueuedTurns,
    activeThread,
    dispatchQueuedMessageDelete,
    environmentId,
    locallyCancelledQueuedMessageIds,
  ]);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const useArtifactTemplate = useCallback(
    (template: CodexArtifactTemplate) => {
      const composer = composerRef.current;
      if (!composer) return;

      const currentDraft = composer.getSendContext().prompt;
      const prompt = codexArtifactTemplatePromptToAppend(currentDraft, template);
      if (prompt !== null && !composer.insertTextAtEnd(prompt, { ensureLeadingBoundary: true })) {
        toastManager.add({
          type: "error",
          title: "Unable to add to chat",
          description: "The composer is busy; try again once it is ready.",
        });
        return;
      }
      scheduleComposerFocus();
    },
    [composerRef, scheduleComposerFocus],
  );
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      composerRef.current?.addTerminalContext(selection);
    },
    [composerRef],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadRef) return;
      storeSetTerminalOpen(activeThreadRef, open);
    },
    [activeThreadRef, storeSetTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadRef) return;
    const nextOpen = !terminalUiState.terminalOpen;
    if (nextOpen && terminalUiState.terminalIds.length === 0) {
      if (!activeThreadId || !activeProject) {
        return;
      }
      const cwdForOpen = gitCwd ?? activeProject.workspaceRoot;
      if (!cwdForOpen) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      storeEnsureTerminal(activeThreadRef, terminalId, { open: true });
      void openTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd: cwdForOpen,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
      return;
    }
    setTerminalOpen(nextOpen);
  }, [
    activeProject,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    allocatableActiveTerminalIds,
    environmentId,
    gitCwd,
    openTerminal,
    setTerminalOpen,
    storeEnsureTerminal,
    terminalUiState.terminalIds.length,
    terminalUiState.terminalOpen,
  ]);
  const splitTerminal = useCallback(
    (direction: "horizontal" | "vertical" = "horizontal") => {
      if (!activeThreadRef || hasReachedSplitLimit || !activeThreadId || !activeProject) {
        return;
      }
      const cwdForOpen = gitCwd ?? activeProject.workspaceRoot;
      if (!cwdForOpen) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      if (direction === "vertical") {
        storeSplitTerminalVertical(activeThreadRef, terminalId);
      } else {
        storeSplitTerminal(activeThreadRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
      void openTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd: cwdForOpen,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
    },
    [
      activeProject,
      activeThreadId,
      allocatableActiveTerminalIds,
      activeThreadRef,
      openTerminal,
      activeThreadWorktreePath,
      environmentId,
      gitCwd,
      hasReachedSplitLimit,
      storeSplitTerminal,
      storeSplitTerminalVertical,
    ],
  );
  const createNewTerminal = useCallback(() => {
    if (!activeThreadRef || !activeThreadId || !activeProject) {
      return;
    }
    const cwdForOpen = gitCwd ?? activeProject.workspaceRoot;
    if (!cwdForOpen) {
      return;
    }
    const terminalId = nextTerminalId(allocatableActiveTerminalIds);
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
    void openTerminal({
      environmentId,
      input: {
        threadId: activeThreadId,
        terminalId,
        cwd: cwdForOpen,
        ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
        env: projectScriptRuntimeEnv({
          project: { cwd: activeProject.workspaceRoot },
          worktreePath: activeThreadWorktreePath,
        }),
      },
    });
  }, [
    activeProject,
    activeThreadId,
    allocatableActiveTerminalIds,
    activeThreadRef,
    openTerminal,
    activeThreadWorktreePath,
    environmentId,
    gitCwd,
    storeNewTerminal,
  ]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId || !activeThreadRef) return;
      const fallbackExitWrite = () =>
        writeTerminal({
          environmentId,
          input: { threadId: activeThreadId, terminalId, data: "exit\n" },
        });
      void (async () => {
        const closeResult = await closeTerminalMutation({
          environmentId,
          input: {
            threadId: activeThreadId,
            terminalId,
            deleteHistory: true,
          },
        });
        if (closeResult._tag === "Failure" && !isAtomCommandInterrupted(closeResult)) {
          await fallbackExitWrite();
        }
      })();
      storeCloseTerminal(activeThreadRef, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeThreadId,
      activeThreadRef,
      closeTerminalMutation,
      environmentId,
      storeCloseTerminal,
      writeTerminal,
    ],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      if (!activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.workspaceRoot;
      const baseTerminalId =
        terminalUiState.activeTerminalId || activeKnownTerminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

      setTerminalUiLaunchContext({
        threadId: activeThreadId,
        cwd: targetCwd,
        worktreePath: targetWorktreePath,
      });
      setTerminalOpen(true);
      if (!activeThreadRef) {
        return;
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.workspaceRoot,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const targetTerminalId = shouldCreateNewTerminal
        ? nextTerminalId(allocatableActiveTerminalIds)
        : baseTerminalId;
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
          };

      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadRef, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadRef, targetTerminalId);
      }

      const openResult = await openTerminal({
        environmentId,
        input: openTerminalInput,
      });
      if (openResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(openResult)) {
          const error = squashAtomCommandFailure(openResult);
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
          );
        }
        return;
      }

      const writeResult = await writeTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        },
      });
      if (writeResult._tag === "Failure" && !isAtomCommandInterrupted(writeResult)) {
        const error = squashAtomCommandFailure(writeResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      activeThreadRef,
      gitCwd,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      environmentId,
      openTerminal,
      activeKnownTerminalIds,
      allocatableActiveTerminalIds,
      runningTerminalIds,
      terminalUiState.activeTerminalId,
      writeTerminal,
    ],
  );

  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ReadonlyArray<ProjectScript>;
      nextScripts: ReadonlyArray<ProjectScript>;
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand;
    }): Promise<AtomCommandResult<void, unknown>> => {
      const updateResult = mapAtomCommandResult(
        await updateProject({
          environmentId,
          input: {
            projectId: input.projectId,
            scripts: input.nextScripts,
          },
        }),
        () => undefined,
      );
      if (updateResult._tag === "Failure") {
        return updateResult;
      }

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (isElectron && keybindingRule) {
        return mapAtomCommandResult(
          await upsertKeybinding({
            environmentId,
            input: keybindingRule,
          }),
          () => undefined,
        );
      }
      return updateResult;
    },
    [environmentId, updateProject, upsertKeybinding],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript = buildProjectScript(nextId, input);
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (
      scriptId: string,
      input: NewProjectScriptInput,
    ): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
      }

      const updatedScript = buildProjectScript(existingScript.id, input);
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;

      const result = await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: null,
        keybindingCommand: commandForProjectScript(scriptId),
      });
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } else if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not delete action",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
      return result;
    },
    [activeProject, persistProjectScripts],
  );

  const saveProjectTestEnvironments = useCallback(
    async (testEnvironments: ProjectTestEnvironment[]) => {
      if (!activeProject) return;
      await updateProject({
        environmentId,
        input: {
          projectId: activeProject.id,
          testEnvironments,
        },
      });
    },
    [activeProject, environmentId, updateProject],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === "plan" && !interactionModeEnabled) return;
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      interactionModeEnabled,
      isLocalDraftThread,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    const nextInteractionMode: ProviderInteractionMode =
      interactionMode === "default"
        ? "plan"
        : interactionMode === "plan"
          ? "test"
          : interactionMode === "test"
            ? "workflow"
            : interactionMode === "workflow"
              ? "trigger"
              : "default";
    handleInteractionModeChange(nextInteractionMode);
  }, [handleInteractionModeChange, interactionMode]);
  const openProviderSetup = useCallback(
    (instanceId: ProviderInstanceId) => {
      void navigate({
        to: "/settings/providers",
        search: { environmentId, instanceId },
      });
    },
    [environmentId, navigate],
  );
  const togglePlanSidebar = useCallback(() => {
    if (!activeThreadRef) return;
    if (planSidebarOpen) {
      planSidebarDismissedForTurnRef.current =
        activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
    } else {
      planSidebarDismissedForTurnRef.current = null;
    }
    useRightPanelStore.getState().toggle(activeThreadRef, "plan");
  }, [activePlan?.turnId, activeThreadRef, planSidebarOpen, sidebarProposedPlan?.turnId]);
  const createBrowserSurface = useCallback(
    (profileId?: string) => {
      if (!activeThreadRef) return;
      void addBrowserSurface({
        threadRef: activeThreadRef,
        openPreview,
        ...(profileId === undefined ? {} : { profileId }),
      }).then((result) => {
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        if (error instanceof BrowserSettingsReadError) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Unable to open browser",
              description: error.message,
            }),
          );
        }
      });
    },
    [activeThreadRef, openPreview],
  );
  const addDiffSurface = useCallback(() => {
    if (!activeThreadRef || !isServerThread || !isGitRepo) return;
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  }, [activeThreadRef, isGitRepo, isServerThread, onDiffPanelOpen]);
  const addFilesSurface = useCallback(() => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  }, [activeProject, activeThreadRef]);
  const openMediaPanel = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "media");
  }, [activeThreadRef]);
  const openTestsPanel = useCallback(() => {
    if (!activeThreadRef || !activeProject?.workspaceRoot) return;
    useRightPanelStore.getState().open(activeThreadRef, "tests");
  }, [activeProject?.workspaceRoot, activeThreadRef]);
  const addAgentsSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "agents");
  }, [activeThreadRef]);
  const openFileSurface = useCallback(
    (relativePath: string) => {
      if (!activeThreadRef || !activeProject) return;
      useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
    },
    [activeProject, activeThreadRef],
  );
  // The thread's own change request, placed against the project it belongs to. Without a
  // project there is nothing to resolve it against, so the caller falls back to the browser.
  const persistedLinkedThreadPullRequest = isServerThread
    ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
    : (activeThread?.linkedPullRequest ?? null);
  const activeProjectRepository = activeProject?.repositoryIdentity?.displayName ?? null;
  const persistedLinkedThreadPullRequestStatus = useLinkedThreadPullRequest(
    activeThreadRef?.environmentId ?? null,
    persistedLinkedThreadPullRequest,
  );
  const replacementLinkedThreadPullRequest = useMemo(() => {
    const detected = gitStatusQuery.data?.pr;
    const threadBranch = activeThread?.branch;
    const projectId = activeProject?.id;
    if (
      persistedLinkedThreadPullRequest === null ||
      (persistedLinkedThreadPullRequestStatus?.pr.state !== "merged" &&
        persistedLinkedThreadPullRequestStatus?.pr.state !== "closed") ||
      gitStatusQuery.data?.refName !== threadBranch ||
      detected?.state !== "open" ||
      detected.headRef !== threadBranch ||
      projectId === undefined ||
      activeProjectRepository === null ||
      (persistedLinkedThreadPullRequest.projectId === projectId &&
        persistedLinkedThreadPullRequest.repository.toLowerCase() ===
          activeProjectRepository.toLowerCase() &&
        persistedLinkedThreadPullRequest.number === detected.number)
    ) {
      return null;
    }
    return {
      projectId,
      repository: activeProjectRepository,
      number: detected.number,
      url: detected.url,
    };
  }, [
    activeProject?.id,
    activeProjectRepository,
    activeThread?.branch,
    gitStatusQuery.data,
    persistedLinkedThreadPullRequest,
    persistedLinkedThreadPullRequestStatus?.pr.state,
  ]);
  const linkedThreadPullRequest =
    replacementLinkedThreadPullRequest ?? persistedLinkedThreadPullRequest;
  const linkedThreadPullRequestKey = linkedThreadPullRequest
    ? JSON.stringify([
        linkedThreadPullRequest.projectId,
        linkedThreadPullRequest.repository,
        linkedThreadPullRequest.number,
      ])
    : null;
  const threadRepository = linkedThreadPullRequest?.repository ?? activeProjectRepository;
  const openThreadPullRequest = useCallback(
    (number: number) => {
      if (!supportsPullRequests || !activeThreadRef) {
        return;
      }
      const projectId = linkedThreadPullRequest?.projectId ?? activeProject?.id;
      const repository = linkedThreadPullRequest?.repository ?? activeProjectRepository;
      if (projectId === undefined || repository === null) return;
      useRightPanelStore.getState().openPullRequest(activeThreadRef, {
        projectId,
        repository,
        number,
      });
    },
    [
      activeProject,
      activeProjectRepository,
      activeThreadRef,
      linkedThreadPullRequest,
      supportsPullRequests,
    ],
  );
  useEffect(() => {
    if (!isServerThread || activeThreadKey === null || activeThreadRef === null) {
      return;
    }
    if (replacementLinkedThreadPullRequest === null) {
      threadPrRelinkKeysRef.current.delete(activeThreadKey);
      return;
    }
    const relinkKey = `${replacementLinkedThreadPullRequest.projectId}:${replacementLinkedThreadPullRequest.repository}#${replacementLinkedThreadPullRequest.number}`;
    if (threadPrRelinkKeysRef.current.get(activeThreadKey) === relinkKey) return;
    threadPrRelinkKeysRef.current.set(activeThreadKey, relinkKey);
    const openSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (
      openSurface?.kind === "pull-request" &&
      persistedLinkedThreadPullRequest !== null &&
      openSurface.projectId === persistedLinkedThreadPullRequest.projectId &&
      openSurface.repository.toLowerCase() ===
        persistedLinkedThreadPullRequest.repository.toLowerCase() &&
      openSurface.number === persistedLinkedThreadPullRequest.number
    ) {
      useRightPanelStore
        .getState()
        .openPullRequest(activeThreadRef, replacementLinkedThreadPullRequest);
    }

    threadPrRelinkWriteRef.current = threadPrRelinkWriteRef.current.then(async () => {
      if (threadPrRelinkKeysRef.current.get(activeThreadKey) !== relinkKey) return;
      const result = await updateThreadMetadata({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeThreadRef.threadId,
          linkedPullRequest: replacementLinkedThreadPullRequest,
        },
      });
      if (threadPrRelinkKeysRef.current.get(activeThreadKey) !== relinkKey) return;
      if (result._tag !== "Failure") return;
      threadPrRelinkKeysRef.current.delete(activeThreadKey);
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to update the thread pull request",
          description: chatActionErrorMessage(squashAtomCommandFailure(result)),
        }),
      );
    });
  }, [
    activeThreadKey,
    activeThreadRef,
    isServerThread,
    persistedLinkedThreadPullRequest,
    replacementLinkedThreadPullRequest,
    updateThreadMetadata,
  ]);
  const openProjectPullRequest = useCallback(
    (number: number) => {
      if (
        !supportsPullRequests ||
        !activeThreadRef ||
        !activeProject ||
        activeProjectRepository === null
      ) {
        return;
      }
      useRightPanelStore.getState().openPullRequest(activeThreadRef, {
        projectId: activeProject.id,
        repository: activeProjectRepository,
        number,
      });
    },
    [activeProject, activeProjectRepository, activeThreadRef, supportsPullRequests],
  );
  const proactiveTurnObservationRef = useRef<{
    threadKey: string;
    runningTurnId: TurnId | null;
  } | null>(null);
  const proactivePullRequestObservationRef = useRef<{
    threadKey: string;
    targetKey: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isServerThread || activeThreadKey === null || activeThreadRef === null) {
      proactiveTurnObservationRef.current = null;
      return;
    }
    if (!clientSettingsHydrated || threadDetailLoading) {
      return;
    }

    const previousObservation = proactiveTurnObservationRef.current;
    const observingSameThread = previousObservation?.threadKey === activeThreadKey;
    const previousRunningTurnId = observingSameThread
      ? previousObservation.runningTurnId
      : undefined;
    const settledTurnId = latestTurnSettled ? (activeLatestTurn?.turnId ?? null) : null;
    const newlyCompletedTurnId = shouldOpenProactiveTurnDiff({
      previousRunningTurnId,
      runningTurnId: activeRunningTurnId,
      settledTurnId,
      turnCompleted: activeLatestTurn?.state === "completed",
    })
      ? settledTurnId
      : null;
    const eligibleCompletion =
      settings.proactivePanelsEnabled && !shouldUseRightPanelSheet && newlyCompletedTurnId !== null;
    const completedCheckpoint = eligibleCompletion
      ? activeThread?.checkpoints.find((checkpoint) => checkpoint.turnId === newlyCompletedTurnId)
      : undefined;
    const diffAction = eligibleCompletion
      ? resolveProactiveTurnDiffAction({
          checkpoint: completedCheckpoint,
          isGitRepo: gitStatusQuery.data?.isRepo,
          activeSurfaceKind: activeRightPanelSurface?.kind ?? null,
        })
      : "ignore";
    proactiveTurnObservationRef.current = {
      threadKey: activeThreadKey,
      runningTurnId: diffAction === "defer" ? (previousRunningTurnId ?? null) : activeRunningTurnId,
    };
    if (diffAction !== "open" || newlyCompletedTurnId === null) return;

    useDiffPanelStore.getState().selectTurn(activeThreadRef, newlyCompletedTurnId);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  }, [
    activeThread?.checkpoints,
    activeLatestTurn?.turnId,
    activeLatestTurn?.state,
    activeRunningTurnId,
    activeThreadKey,
    activeThreadRef,
    activeRightPanelSurface?.kind,
    clientSettingsHydrated,
    gitStatusQuery.data?.isRepo,
    isServerThread,
    latestTurnSettled,
    onDiffPanelOpen,
    settings.proactivePanelsEnabled,
    shouldUseRightPanelSheet,
    threadDetailLoading,
  ]);

  useEffect(() => {
    if (!isServerThread || activeThreadKey === null || activeThreadRef === null) {
      proactivePullRequestObservationRef.current = null;
      return;
    }
    if (!clientSettingsHydrated || threadDetailLoading) {
      return;
    }

    const previousObservation = proactivePullRequestObservationRef.current;
    const observingSameThread = previousObservation?.threadKey === activeThreadKey;
    const previousTargetKey = observingSameThread ? previousObservation.targetKey : undefined;
    const newlyLinkedPullRequest = shouldOpenProactivePullRequest(
      previousTargetKey,
      linkedThreadPullRequestKey,
    );
    const eligibleLink =
      settings.proactivePanelsEnabled && !shouldUseRightPanelSheet && newlyLinkedPullRequest;
    const shouldOpenLink =
      eligibleLink &&
      pullRequestsCapabilityKnown &&
      supportsPullRequests &&
      linkedThreadPullRequest !== null;
    const shouldDeferLink = eligibleLink && !pullRequestsCapabilityKnown;
    proactivePullRequestObservationRef.current = {
      threadKey: activeThreadKey,
      targetKey: shouldDeferLink ? (previousTargetKey ?? null) : linkedThreadPullRequestKey,
    };
    if (!shouldOpenLink || linkedThreadPullRequest === null) return;

    useRightPanelStore.getState().openPullRequest(activeThreadRef, linkedThreadPullRequest);
  }, [
    activeThreadKey,
    activeThreadRef,
    clientSettingsHydrated,
    isServerThread,
    linkedThreadPullRequest,
    linkedThreadPullRequestKey,
    pullRequestsCapabilityKnown,
    settings.proactivePanelsEnabled,
    shouldUseRightPanelSheet,
    supportsPullRequests,
    threadDetailLoading,
  ]);
  const togglePreviewPanel = useCallback(() => {
    if (!activeThreadRef || !browserAvailable) return;
    if (previewPanelOpen) {
      useRightPanelStore.getState().close(activeThreadRef);
      return;
    }
    const activeTabId = activePreviewState.activeTabId;
    if (activeTabId) {
      useRightPanelStore.getState().openBrowser(activeThreadRef, activeTabId);
    } else {
      createBrowserSurface();
    }
  }, [
    activePreviewState.activeTabId,
    activeThreadRef,
    browserAvailable,
    createBrowserSurface,
    previewPanelOpen,
  ]);
  const closePreviewPanel = useCallback(() => {
    if (activeThreadRef) {
      setMaximizedRightPanelThreadKey(null);
      useRightPanelStore.getState().close(activeThreadRef);
    }
  }, [activeThreadRef]);
  const addTerminalSurface = useCallback(() => {
    if (!activeThreadRef || !activeThreadId || !activeProject) return;
    const cwd = gitCwd ?? activeProject.workspaceRoot;
    const terminalId = nextTerminalId(allocatableActiveTerminalIds);
    useRightPanelStore.getState().openTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
    void openTerminal({
      environmentId: activeThreadRef.environmentId,
      input: {
        threadId: activeThreadId,
        terminalId,
        cwd,
        ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
        env: projectScriptRuntimeEnv({
          project: { cwd: activeProject.workspaceRoot },
          worktreePath: activeThreadWorktreePath,
        }),
      },
    });
  }, [
    activeProject,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    allocatableActiveTerminalIds,
    gitCwd,
    openTerminal,
  ]);
  const splitPanelTerminal = useCallback(
    (direction: "horizontal" | "vertical" = "horizontal") => {
      if (
        !activeThreadRef ||
        !activeThreadId ||
        !activeProject ||
        activeRightPanelSurface?.kind !== "terminal" ||
        activeRightPanelSurface.terminalIds.length >= MAX_TERMINALS_PER_GROUP
      ) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      const cwd = gitCwd ?? activeProject.workspaceRoot;
      useRightPanelStore
        .getState()
        .splitTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId, direction);
      setTerminalFocusRequestId((value) => value + 1);
      void openTerminal({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
    },
    [
      activeProject,
      activeRightPanelSurface,
      activeThreadId,
      activeThreadRef,
      activeThreadWorktreePath,
      allocatableActiveTerminalIds,
      gitCwd,
      openTerminal,
    ],
  );
  const splitPanelTerminalVertical = useCallback(() => {
    splitPanelTerminal("vertical");
  }, [splitPanelTerminal]);
  const activatePanelTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
      useRightPanelStore
        .getState()
        .activateTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeRightPanelSurface, activeThreadRef],
  );
  const closePanelTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
      void closeTerminalMutation({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeThreadRef.threadId,
          terminalId,
          deleteHistory: true,
        },
      });
      storeCloseTerminal(activeThreadRef, terminalId);
      useRightPanelStore
        .getState()
        .closeTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeRightPanelSurface, activeThreadRef, closeTerminalMutation, storeCloseTerminal],
  );
  const requestCloseTerminal = useCallback(
    (terminalId: string) => {
      const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
      void confirmTerminalClose([label]).then((confirmed) => {
        if (confirmed) closeTerminal(terminalId);
      });
    },
    [activeTerminalLabelsById, closeTerminal],
  );
  const requestClosePanelTerminal = useCallback(
    (terminalId: string) => {
      const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
      void confirmTerminalClose([label]).then((confirmed) => {
        if (confirmed) closePanelTerminal(terminalId);
      });
    },
    [activeTerminalLabelsById, closePanelTerminal],
  );
  const activateRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
      if (surface.kind === "preview" && surface.resourceId) {
        setActivePreviewTab(activeThreadRef, surface.resourceId);
      }
      if (surface.kind === "terminal") {
        setTerminalFocusRequestId((value) => value + 1);
      }
      if (surface.kind === "plan") {
        planSidebarDismissedForTurnRef.current = null;
      }
      if (surface.kind === "diff" && !diffOpen) {
        onDiffPanelOpen?.();
      }
    },
    [activeThreadRef, diffOpen, onDiffPanelOpen],
  );
  const toggleRightPanel = useCallback(() => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      closePreviewPanel();
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  }, [activeThreadRef, closePreviewPanel, rightPanelOpen]);
  const toggleRightPanelMaximized = useCallback(() => {
    if (!canMaximizeRightPanel) return;
    setMaximizedRightPanelThreadKey((threadKey) =>
      threadKey === routeThreadKey ? null : routeThreadKey,
    );
  }, [canMaximizeRightPanel, routeThreadKey]);
  const cleanupRightPanelSurfaces = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (!activeThreadRef) return;
      for (const surface of surfaces) {
        if (surface.kind === "preview" && surface.resourceId) {
          void closePreviewSession({
            closePreview,
            snapshot: activePreviewState.sessions[surface.resourceId] ?? null,
            tabId: surface.resourceId,
            threadRef: activeThreadRef,
          });
        }
        if (surface.kind === "terminal") {
          for (const terminalId of surface.terminalIds) {
            storeCloseTerminal(activeThreadRef, terminalId);
            void closeTerminalMutation({
              environmentId: activeThreadRef.environmentId,
              input: {
                threadId: activeThreadRef.threadId,
                terminalId,
                deleteHistory: true,
              },
            });
          }
        }
      }
    },
    [
      activeThreadRef,
      activePreviewState.sessions,
      closePreview,
      closeTerminalMutation,
      storeCloseTerminal,
    ],
  );
  const closeAfterAgentBrowserConfirmation = useCallback(
    (surfaces: readonly RightPanelSurface[], closeSurfaces: () => void) => {
      const message = agentControlledBrowserCloseConfirmation(
        surfaces,
        activePreviewState.desktopByTabId,
      );
      if (!message) {
        closeSurfaces();
        return;
      }
      const localApi = readLocalApi();
      if (!localApi) return;
      void localApi.dialogs.confirm(message, { variant: "destructive" }).then(
        (confirmed) => {
          if (confirmed) closeSurfaces();
        },
        () => undefined,
      );
    },
    [activePreviewState.desktopByTabId],
  );
  const syncActivePreviewSurface = useCallback(() => {
    if (!activeThreadRef) return;
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(activeThreadRef, nextActiveSurface.resourceId);
    }
  }, [activeThreadRef]);
  const finishRightPanelSurfaceClose = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (!activeThreadRef) return;
      cleanupRightPanelSurfaces(surfaces);
      const store = useRightPanelStore.getState();
      for (const surface of surfaces) {
        store.closeSurface(activeThreadRef, surface.id);
      }
      syncActivePreviewSurface();
    },
    [activeThreadRef, cleanupRightPanelSurfaces, syncActivePreviewSurface],
  );
  const closeRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const currentPanelState = selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        activeThreadRef,
      );
      const closesFinalPlanSurface =
        surface.kind === "plan" &&
        currentPanelState.surfaces.length === 1 &&
        currentPanelState.surfaces[0]?.id === surface.id;
      const finishClose = () => {
        cleanupRightPanelSurfaces([surface]);
        useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
        if (closesFinalPlanSurface) {
          setMaximizedRightPanelThreadKey(null);
          useRightPanelStore.getState().close(activeThreadRef);
        }
        syncActivePreviewSurface();
      };
      if (surface.kind !== "terminal") {
        finishClose();
        return;
      }
      const activeLabel =
        activeTerminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId);
      const otherLabels = surface.terminalIds
        .filter((terminalId) => terminalId !== surface.activeTerminalId)
        .map(
          (terminalId) => activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
        );
      void confirmTerminalClose([activeLabel, ...otherLabels]).then((confirmed) => {
        if (confirmed) finishClose();
      });
    },
    [
      activeThreadRef,
      activeTerminalLabelsById,
      closeAfterAgentBrowserConfirmation,
      finishRightPanelSurfaceClose,
    ],
  );
  const closeOtherRightPanelSurfaces = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaces = rightPanelState.surfaces.filter((entry) => entry.id !== surface.id);
      const finishClose = () => finishRightPanelSurfaceClose(surfaces);
      closeAfterAgentBrowserConfirmation(surfaces, finishClose);
    },
    [
      activeThreadRef,
      closeAfterAgentBrowserConfirmation,
      finishRightPanelSurfaceClose,
      rightPanelState.surfaces,
    ],
  );
  const closeRightPanelSurfacesToRight = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaceIndex = rightPanelState.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      const surfaces = rightPanelState.surfaces.slice(surfaceIndex + 1);
      const finishClose = () => finishRightPanelSurfaceClose(surfaces);
      closeAfterAgentBrowserConfirmation(surfaces, finishClose);
    },
    [
      activeThreadRef,
      closeAfterAgentBrowserConfirmation,
      finishRightPanelSurfaceClose,
      rightPanelState.surfaces,
    ],
  );
  const closeAllRightPanelSurfaces = useCallback(() => {
    if (!activeThreadRef) return;
    const finishClose = () => finishRightPanelSurfaceClose(rightPanelState.surfaces);
    closeAfterAgentBrowserConfirmation(rightPanelState.surfaces, finishClose);
  }, [
    activeThreadRef,
    closeAfterAgentBrowserConfirmation,
    finishRightPanelSurfaceClose,
    rightPanelState.surfaces,
  ]);
  const copyRightPanelFilePath = useCallback((relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(relativePath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: relativePath,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, []);
  useEffect(
    () =>
      subscribePreviewAction((action) => {
        if (action === "toggle-panel") togglePreviewPanel();
      }),
    [togglePreviewPanel],
  );
  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
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
        ...(input.modelSelection ? { nextModelSelection: input.modelSelection } : {}),
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
    },
    [
      environmentId,
      serverThread,
      setThreadInteractionMode,
      setThreadRuntimeMode,
      updateThreadMetadata,
    ],
  );

  // Scroll helpers — LegendList handles auto-scroll via maintainScrollAtEnd.
  const appendWorkflowActivity = useCallback(
    async (input: {
      threadId: ThreadId;
      kind: WorkflowRecordKind;
      summary: string;
      payload: Record<string, unknown>;
      turnId?: TurnId | null;
      createdAt?: string;
    }) => {
      const createdAt = input.createdAt ?? new Date().toISOString();
      return await recordThreadWorkflow({
        environmentId,
        input: {
          threadId: input.threadId,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: input.turnId ?? null,
          createdAt,
        },
      });
    },
    [environmentId, recordThreadWorkflow],
  );

  const launchWorkflowChildLane = useCallback(
    async (input: {
      lane: WorkflowPlannedSubAgent;
      workflowGoal: string;
      guidance?: string;
      existingChildThreadId?: ThreadId | null;
    }): Promise<ThreadId | null> => {
      if (!activeThread || !activeProject) return null;

      const childThreadId = input.existingChildThreadId ?? newThreadId();
      const childTurnMessageId = newMessageId();
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
      const childModelSelection = workflowLaneModelSelection(
        activeThread.modelSelection,
        input.lane,
      );

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
          error instanceof Error
            ? error.message
            : `Failed to record ${input.lane.role} lane start.`,
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
    },
    [
      activeProject,
      activeThread,
      appendWorkflowActivity,
      createThread,
      environmentId,
      runtimeMode,
      setThreadError,
      startThreadTurn,
    ],
  );

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
            try {
              const result = await appendWorkflowActivity({
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
            } finally {
              workflowCompletionInFlightRef.current.delete(key);
            }
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
            try {
              const result = await appendWorkflowActivity({
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
            } finally {
              workflowCompletionInFlightRef.current.delete(key);
            }
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeThread, appendWorkflowActivity, workflowChildCompletions]);

  useEffect(() => {
    if (!activeThread) return;
    if (!activeThread.activities.some((activity) => activity.kind === "workflow.started")) return;

    const { goal, plannedSubAgents } = latestWorkflowPlanDetails(
      activeThread.activities,
      activePlan?.explanation ?? "Workflow",
    );
    if (plannedSubAgents.length === 0) return;

    const completedLaneIds = workflowCompletedLaneIds(activeThread.activities);
    const startedLaneIds = workflowStartedChildLaneIds(activeThread.activities);
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
          workflowStartedChildLaneIds(activeThread.activities).has(lane.id)
        ) {
          continue;
        }
        workflowLaneLaunchInFlightRef.current.add(laneLaunchKey);
        try {
          const childThreadId = await launchWorkflowChildLane({ lane, workflowGoal: goal });
          if (childThreadId) {
            workflowLaneLaunchRecordedRef.current.add(laneLaunchKey);
          }
        } finally {
          workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePlan?.explanation, activeThread, launchWorkflowChildLane]);

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollIntentRef = useRef<"toward-end" | "away-from-end" | null>(null);
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end");
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(true);
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  // Manual navigation stops live-follow without removing anchored end space.
  // Collapsing that space during a gesture clamps the viewport back to the end.
  const cancelTimelineLiveFollowForUserNavigation = useCallback(() => {
    anchorUserScrollGenerationRef.current += 1;
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
  }, []);
  const cancelTimelineLiveFollowForUserNavigationRef = useRef(
    cancelTimelineLiveFollowForUserNavigation,
  );
  useEffect(() => {
    cancelTimelineLiveFollowForUserNavigationRef.current =
      cancelTimelineLiveFollowForUserNavigation;
  }, [cancelTimelineLiveFollowForUserNavigation]);
  const getActiveTimelineTurnMetrics = useCallback(
    (list?: LegendListRef | null) => {
      const resolvedList = list ?? legendListRef.current;
      const anchorIndex = activeTimelineAnchorIndexRef.current;
      const state = resolvedList?.getState();
      if (!resolvedList || !state || anchorIndex === null) {
        return null;
      }

      return getAnchoredTurnMetrics({
        state,
        anchorIndex,
        composerOverlayHeight: composerTimelineInset,
        anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
      });
    },
    [composerTimelineInset],
  );
  const timelineRealContentOverflowsViewport = useCallback(
    (list?: LegendListRef | null) => {
      const resolvedList = list ?? legendListRef.current;
      const state = resolvedList?.getState();
      if (!resolvedList || !state || state.data.length === 0) {
        return false;
      }

      const lastRowIndex = state.data.length - 1;
      const lastRowTop = state.positionAtIndex(lastRowIndex);
      const lastRowHeight = state.sizeAtIndex(lastRowIndex);
      if (
        typeof lastRowTop !== "number" ||
        typeof lastRowHeight !== "number" ||
        !Number.isFinite(lastRowTop) ||
        !Number.isFinite(lastRowHeight)
      ) {
        return false;
      }

      const realContentBottom = lastRowTop + Math.max(1, lastRowHeight);
      const visibleScrollLength = Math.max(
        0,
        (state.scrollLength ?? 0) - composerTimelineInset - CHAT_TIMELINE_ANCHOR_OFFSET,
      );
      return realContentBottom > visibleScrollLength;
    },
    [composerTimelineInset],
  );
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useEffectEvent((key: PageScrollKey) => {
    if (key === "PageUp" && timelineRealContentOverflowsViewport()) {
      cancelTimelineLiveFollowForUserNavigation();
    }
  });
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;

    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) {
        pageScrollControllerRef.current = null;
      }
    };
  }, [composerOverlayElement]);
  const onComposerPageScrollKeyDown = useCallback((key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  }, []);
  const onComposerPageScrollKeyUp = useCallback((key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  }, []);
  const onComposerPageScrollRelease = useCallback(() => {
    pageScrollControllerRef.current?.releaseActiveKey();
  }, []);
  // Live-follow stays active after send/thread-open until an actual list scroll
  // gesture opts out.
  const scrollToEnd = useCallback((animated = false) => {
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    requestAnimationFrame(() => {
      void legendListRef.current?.scrollToEnd?.({ animated });
    });
  }, []);
  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }

    if (
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEnd();
    }
  }, [
    activeRunningTurnId,
    scrollToEnd,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);
  useEffect(() => {
    let removeListeners: (() => void) | null = null;
    let frame: number | null = null;
    const attach = (remainingAttempts: number) => {
      frame = requestAnimationFrame(() => {
        frame = null;
        const scrollNode = legendListRef.current?.getScrollableNode();
        if (!scrollNode) {
          // The list may not have mounted on the first frame after a thread
          // switch — without a retry the opt-out listeners never attach and
          // live-follow becomes impossible to escape for the whole thread.
          if (remainingAttempts > 0) {
            attach(remainingAttempts - 1);
          }
          return;
        }
        const handleManualNavigation = () => {
          cancelTimelineLiveFollowForUserNavigationRef.current();
        };
        // The gestures below must only break follow when they can actually
        // move the viewport away from the live edge. Follow now gates
        // LegendList's maintainScrollAtEnd, so a spurious break while pinned
        // at the end produces no scroll event, never re-arms, and streaming
        // silently stops following. Underflowing content can't scroll at all,
        // so nothing there should break follow.
        const contentScrollsUp = () => timelineRealContentOverflowsViewport();
        // The follow re-arm band, not the strict flag: streaming growth makes
        // isAtEnd flicker false for a frame before the follow scroll catches
        // up, and a gesture landing in that window while still pinned would
        // otherwise break follow with no scroll event left to re-arm it.
        const viewportIsAwayFromEnd = () =>
          resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
        // Only an upward wheel is a navigation intent; wheeling down while
        // following either does nothing (at the end) or moves toward it.
        const handleWheel = (event: WheelEvent) => {
          if (event.deltaY > 0) {
            timelineScrollIntentRef.current = "toward-end";
            if (isAtEndRef.current) {
              composerRef.current?.restoreAfterTimelineReachedEnd();
            }
          } else if (event.deltaY < 0) {
            timelineScrollIntentRef.current = "away-from-end";
          }
          if (
            event.deltaY < 0 &&
            contentScrollsUp() &&
            !toolGroupConsumesUpwardNavigation(event.target)
          ) {
            handleManualNavigation();
          }
        };
        // Touch direction isn't observable here (touchmove fires on any
        // finger motion, scrolling or not), so break only once the drag has
        // actually carried the viewport out of the end band — an upward flick
        // gets there within its first few events and later touchmoves break.
        const handleTouchMove = () => {
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Scrollbar drags produce no wheel/touch events; they are the only
        // pointerdowns whose target is the scroll node itself rather than a
        // message row. Content clicks break follow only away from the end
        // (reading or selecting up there must hold position); clicking near
        // the live edge keeps following.
        const handlePointerDown = (event: PointerEvent) => {
          if (event.target === scrollNode) {
            if (contentScrollsUp()) {
              handleManualNavigation();
            }
            return;
          }
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Keyboard scrolling (PageUp/Home/ArrowUp) bypasses wheel and
        // pointer events entirely; without this the timeline yanks back to
        // the end on the next stream chunk.
        const handleKeyDown = (event: KeyboardEvent) => {
          switch (event.key) {
            case "PageUp":
            case "Home":
            case "ArrowUp":
              timelineScrollIntentRef.current = "away-from-end";
              if (contentScrollsUp() && !toolGroupConsumesUpwardNavigation(event.target)) {
                handleManualNavigation();
              }
              break;
            case "PageDown":
            case "End":
            case "ArrowDown":
              timelineScrollIntentRef.current = "toward-end";
              break;
            default:
              break;
          }
        };
        scrollNode.addEventListener("wheel", handleWheel, {
          passive: true,
        });
        scrollNode.addEventListener("touchmove", handleTouchMove, {
          passive: true,
        });
        scrollNode.addEventListener("pointerdown", handlePointerDown, {
          passive: true,
        });
        scrollNode.addEventListener("keydown", handleKeyDown);
        removeListeners = () => {
          scrollNode.removeEventListener("wheel", handleWheel);
          scrollNode.removeEventListener("touchmove", handleTouchMove);
          scrollNode.removeEventListener("pointerdown", handlePointerDown);
          scrollNode.removeEventListener("keydown", handleKeyDown);
        };
      });
    };
    attach(12);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      removeListeners?.();
    };
  }, [activeThread?.id, timelineRealContentOverflowsViewport]);

  const onTimelineAnchorReady = useCallback((messageId: MessageId, anchorIndex: number) => {
    // Anchored-end space can be remeasured when the turn completes. Once the
    // user has scrolled away (or returned to ordinary end-following), that
    // remeasurement must not restart the send-time anchor positioning.
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          }
          return;
        }
        void list
          .scrollToIndex({
            index: anchorIndex,
            animated: true,
            viewPosition: 0,
            viewOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
          })
          .then(() => {
            if (positionedTimelineAnchorRef.current !== messageId) {
              return;
            }
            settledTimelineAnchorRef.current = messageId;
          });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  }, []);

  const onToolOutputCollapsedAtEnd = useCallback(() => {
    composerRef.current?.restoreAfterTimelineReachedEnd();
  }, []);

  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    if (
      !isAtEnd &&
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current
    ) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      if (timelineScrollIntentRef.current === "toward-end") {
        composerRef.current?.restoreAfterTimelineReachedEnd();
      }
      timelineScrollModeRef.current = "following-end";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      // Reachable only once manual navigation has already broken follow, so
      // the anchored turn framing is over: the user scrolled back to the live
      // edge and expects the stream to stick to it again, exactly like the
      // scroll-to-bottom pill.
      setTimelineAnchor(releaseChatTimelineAnchor);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      timelineScrollModeRef.current = "free-scrolling";
      liveFollowUserScrollGenerationRef.current = null;
      showScrollDebouncer.current.maybeExecute();
    }
  }, []);

  // Anchored end space intentionally disables LegendList's normal end-follow so
  // the sent message can stay near the top. T3 only owns streaming adjustments
  // during that mode; LegendList owns ordinary end-follow everywhere else.
  useEffect(() => {
    if (!activeThread?.id) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current !== anchorUserScrollGenerationRef.current) {
      return;
    }
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }

    let secondFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (liveFollowUserScrollGenerationRef.current !== anchorUserScrollGenerationRef.current) {
          return;
        }
        if (pendingTimelineAnchorRef.current !== null) {
          return;
        }
        if (
          positionedTimelineAnchorRef.current !== null &&
          settledTimelineAnchorRef.current !== positionedTimelineAnchorRef.current
        ) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          return;
        }

        const metrics = getActiveTimelineTurnMetrics(list);
        if (!metrics || metrics.scrollDeltaToRevealEnd <= 1) {
          return;
        }

        const nextOffset = list.getState().scroll + metrics.scrollDeltaToRevealEnd;
        void list.scrollToOffset({ offset: nextOffset, animated: false });
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [activeThread?.id, timelineEntries, getActiveTimelineTurnMetrics]);

  useEffect(() => {
    setPullRequestDialogState(null);
    isAtEndRef.current = true;
    timelineScrollIntentRef.current = null;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    // activeThreadRef resets transitively with the active thread.
  }, [activeThread?.id]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    if (!activeThread?.id) return;
    const queuedServerIds = new Set(activeThread.messages.map((message) => message.id));
    for (const turn of activeQueuedTurns) {
      queuedServerIds.add(turn.messageId);
    }
    const removedMessages = optimisticQueuedMessages.filter((message) =>
      queuedServerIds.has(message.id),
    );
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticQueuedMessages((existing) =>
        existing.filter((message) => !queuedServerIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeQueuedTurns,
    activeThread?.id,
    activeThread?.messages,
    handoffAttachmentPreviews,
    optimisticQueuedMessages,
  ]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    setOptimisticQueuedMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    setLocallyCancelledQueuedMessageIds(new Set());
    queuedDeleteInFlightByQueueIdRef.current.clear();
    queuedUpdateInFlightByQueueIdRef.current.clear();
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, threadId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeThread.messages.length === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? draftThread?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranch !== undefined
      ? pendingServerThreadBranch
      : (activeThread?.branch ?? null);
  const startFromOrigin = isLocalDraftThread
    ? (draftThread?.startFromOrigin ?? false)
    : canOverrideServerThreadEnvMode
      ? (pendingServerThreadStartFromOriginByThreadId[activeThread?.id ?? ""] ??
        primaryServerSettings.newWorktreesStartFromOrigin)
      : false;
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const localCheckoutBranchMismatch = useMemo(
    () =>
      isServerThread
        ? resolveLocalCheckoutBranchMismatch({
            effectiveEnvMode: envMode,
            activeWorktreePath,
            activeThreadBranch,
            currentGitBranch: gitStatusQuery.data?.refName ?? null,
          })
        : null,
    [activeThreadBranch, activeWorktreePath, envMode, gitStatusQuery.data?.refName, isServerThread],
  );
  const activeComposerTasksProgress = useMemo(() => {
    if (!activeLatestTurn || latestTurnSettled || activePlan?.turnId !== activeLatestTurn.turnId) {
      return null;
    }
    const currentStep =
      activePlan.steps.find((step) => step.status === "inProgress") ??
      activePlan.steps.find((step) => step.status === "pending");
    if (!currentStep) return null;
    return {
      step: currentStep.step,
      completedSteps: activePlan.steps.filter((step) => step.status === "completed").length,
      totalSteps: activePlan.steps.length,
    };
  }, [activeLatestTurn, activePlan, latestTurnSettled]);
  const activeComposerTaskSteps =
    activeComposerTasksProgress && activePlan && activePlan.turnId === activeLatestTurn?.turnId
      ? activePlan.steps
      : null;

  const publishComposerOverlayHeight = useCallback((height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    const previousHeight = composerOverlayHeightRef.current;
    if (previousHeight !== nextHeight) {
      composerOverlayHeightRef.current = nextHeight;
      setComposerOverlayHeight(nextHeight);
    }
    const nextInset = resolveComposerTimelineInset({
      currentInset: composerTimelineInsetRef.current,
      overlayHeight: nextHeight,
      isResting: composerRestingRef.current,
    });
    if (composerTimelineInsetRef.current !== nextInset) {
      composerTimelineInsetRef.current = nextInset;
      setComposerTimelineInset(nextInset);
    }
    setScrollToEndClearance((currentClearance) =>
      currentClearance === nextHeight ? currentClearance : nextHeight,
    );
  }, []);
  // The composer reports its resting flag from a layout effect, which runs
  // before this component's own layout effects and before any resize
  // observation, so every measurement below sees the flag for its layout.
  // Only the flag is stored here: the stored height still belongs to the
  // previous layout, and the composer publishes the new layout's height
  // itself once it has measured it.
  const onComposerRestingChange = useCallback((resting: boolean) => {
    composerRestingRef.current = resting;
  }, []);
  // A held reservation belongs to the previous thread's draft. Rebuild it from
  // this thread's overlay so a tall draft elsewhere does not pad this one.
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    publishComposerOverlayHeight(composerOverlayElement.getBoundingClientRect().height);
  }, [activeThreadKey, composerOverlayElement, publishComposerOverlayHeight]);

  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      publishComposerOverlayHeight(composerOverlayElement.getBoundingClientRect().height);
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(composerOverlayElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [composerOverlayElement, publishComposerOverlayHeight]);
  const activeThreadPr =
    replacementLinkedThreadPullRequest !== null
      ? (gitStatusQuery.data?.pr ?? null)
      : resolveDisplayedThreadPr({
          threadBranch: activeThread?.branch ?? null,
          gitStatus: gitStatusQuery.data ?? null,
          snapshot: activeThreadKey ? changeRequestSnapshotByKey.get(activeThreadKey) : undefined,
          retainTerminalOnBranchMismatch: activeThread?.worktreePath === null,
          linkedPullRequest: linkedThreadPullRequest,
          linkedPullRequestStatus: persistedLinkedThreadPullRequestStatus,
        });
  const handlePullRequestTabStatusChange = useCallback(
    (status: Pick<PullRequestTabStatus, "repository" | "number" | "state">) => {
      if (
        threadRepository?.toLowerCase() !== status.repository.toLowerCase() ||
        activeThreadPr?.number !== status.number ||
        activeThreadPr.state === status.state
      ) {
        sidebarPrRefreshKeyRef.current = null;
        return;
      }
      const refreshKey = `${activeThreadKey}:vcs:${status.repository}#${status.number}:${status.state}`;
      if (sidebarPrRefreshKeyRef.current === refreshKey) return;
      sidebarPrRefreshKeyRef.current = refreshKey;
      if (activeThreadRef === null || gitCwd === null) return;
      void refreshVcsStatus({
        environmentId: activeThreadRef.environmentId,
        input: { cwd: gitCwd },
      }).then(() => {
        if (sidebarPrRefreshKeyRef.current === refreshKey) {
          sidebarPrRefreshKeyRef.current = null;
        }
      });
    },
    [
      activeThreadKey,
      activeThreadPr?.number,
      activeThreadPr?.state,
      activeThreadRef,
      gitCwd,
      refreshVcsStatus,
      threadRepository,
    ],
  );
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(activeThreadRef);
  const activeThreadReferenceCopyTarget = useMemo(
    () =>
      activeThreadId === null || !isServerThread
        ? null
        : resolveThreadReferenceCopyTarget({
            threadId: activeThreadId,
            openPanelPullRequestUrl,
            linkedPullRequestUrl: linkedThreadPullRequest?.url ?? null,
            detectedPullRequestUrl: activeThreadPr?.url ?? null,
          }),
    [
      activeThreadId,
      activeThreadPr?.url,
      isServerThread,
      linkedThreadPullRequest?.url,
      openPanelPullRequestUrl,
    ],
  );
  const copyActiveThreadReference = useCallback(() => {
    const target = activeThreadReferenceCopyTarget;
    if (target === null) return;
    void writeTextToClipboard(target.value, target.clipboardTarget).then(
      (didCopy) => {
        if (!didCopy) return;
        toastManager.add({
          type: "success",
          title: target.successTitle,
          description: target.value,
        });
      },
      (error) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: target.failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, [activeThreadReferenceCopyTarget]);
  // The right panel offers the thread's own change request, so it can only offer it once the
  // branch has one; until then the picker says so rather than opening an empty panel.
  const addPullRequestSurface = useCallback(() => {
    if (activeThreadPr === null) return;
    openThreadPullRequest(activeThreadPr.number);
  }, [activeThreadPr, openThreadPullRequest]);
  const pullRequestSurfaceAvailable =
    supportsPullRequests && activeThreadPr !== null && threadRepository !== null;
  const supportsSettlement = serverConfig?.environment.capabilities.threadSettlement === true;
  const supportsSnooze = serverConfig?.environment.capabilities.threadSnooze === true;
  const supportsPinning = serverConfig?.environment.capabilities.threadPinning === true;
  const activeThreadPinned = supportsPinning && activeThreadShell?.pinnedAt != null;
  const nowMinute = useNowMinute();
  const snoozeNow = new Date().toISOString();
  const activeThreadSnoozed =
    activeThreadShell !== null &&
    supportsSnooze &&
    effectiveSnoozed(activeThreadShell, { now: snoozeNow });
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);
  void snoozeWakeTick;
  const activeThreadWokeAt =
    activeThreadShell !== null && supportsSnooze
      ? threadWokeAt(activeThreadShell, { now: snoozeNow })
      : null;
  useEffect(() => {
    if (!activeThreadSnoozed) return;
    const wakeAtMs = Date.parse(activeThreadShell?.snoozedUntil ?? "");
    if (!Number.isFinite(wakeAtMs)) return;
    const id = window.setTimeout(
      () => bumpSnoozeWakeTick((tick) => tick + 1),
      Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [activeThreadShell?.snoozedUntil, activeThreadSnoozed, snoozeWakeTick]);
  const acknowledgeActiveThreadWoke = useCallback(() => {
    if (activeThreadRef === null || activeThreadWokeAt === null) return;
    markThreadVisited(scopedThreadKey(activeThreadRef), activeThreadWokeAt);
  }, [activeThreadRef, activeThreadWokeAt, markThreadVisited]);
  // Mirror of the sidebar's Woke pill for the open thread.
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    activeThreadKey === null ? undefined : store.threadLastVisitedAtById[activeThreadKey],
  );
  const activeThreadWokeVisible = useMemo(() => {
    if (activeThreadWokeAt === null) return false;
    if (activeThreadShell?.settledOverride === "settled") return false;
    const wokeAtMs = Date.parse(activeThreadWokeAt);
    if (Number.isNaN(wokeAtMs)) return false;
    // Having the thread open counts as a visit at completedAt (the effect
    // above stamps it); folding that floor in here keeps a completion-
    // triggered wake from flashing a banner for one frame before the stamp
    // lands. An unparseable stored visit counts as never-visited: corrupt
    // local data must not eat the wake signal.
    const storedVisitMs = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    const completedAtMs = activeLatestTurn?.completedAt
      ? Date.parse(activeLatestTurn.completedAt)
      : NaN;
    const lastVisitedMs = Math.max(
      Number.isNaN(storedVisitMs) ? -Infinity : storedVisitMs,
      Number.isNaN(completedAtMs) ? -Infinity : completedAtMs,
    );
    return lastVisitedMs < wokeAtMs;
  }, [
    activeLatestTurn?.completedAt,
    activeThreadLastVisitedAt,
    activeThreadShell,
    activeThreadWokeAt,
  ]);
  const activeThreadSettled =
    supportsSettlement && activeThreadShell?.settledOverride === "settled";
  const unsettleThreadMutation = useAtomCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  // Keyed by thread, not a boolean: the pending state must follow the thread
  // it belongs to across navigation, and a request resolving for thread A
  // must never clear (or re-enable) thread B's button.
  const [unsettlingThreadKey, setUnsettlingThreadKey] = useState<string | null>(null);
  const isUnsettling = unsettlingThreadKey !== null && unsettlingThreadKey === activeThreadKey;
  const handleUnsettleActiveThread = useCallback(async () => {
    if (!activeThreadRef) return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setUnsettlingThreadKey(threadKey);
    try {
      const result = await unsettleThreadMutation({
        environmentId: activeThreadRef.environmentId,
        input: { threadId: activeThreadRef.threadId, reason: "user" },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to un-settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      setUnsettlingThreadKey((current) => (current === threadKey ? null : current));
    }
  }, [activeThreadRef, unsettleThreadMutation]);
  const unsnoozeThreadMutation = useAtomCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const [unsnoozingThreadKey, setUnsnoozingThreadKey] = useState<string | null>(null);
  const isUnsnoozing = unsnoozingThreadKey !== null && unsnoozingThreadKey === activeThreadKey;
  const handleUnsnoozeActiveThread = useCallback(async () => {
    if (!activeThreadRef) return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setUnsnoozingThreadKey(threadKey);
    try {
      const result = await unsnoozeThreadMutation({
        environmentId: activeThreadRef.environmentId,
        input: { threadId: activeThreadRef.threadId, reason: "user" },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      setUnsnoozingThreadKey((current) => (current === threadKey ? null : current));
    }
  }, [activeThreadRef, unsnoozeThreadMutation]);
  const [isRestoringThreadBranch, setIsRestoringThreadBranch] = useState(false);
  const [branchRestoreConfirmOpen, setBranchRestoreConfirmOpen] = useState(false);
  // Once revealed for a given mismatch, the banner stays mounted until the
  // mismatch changes or resolves, so clearing the draft doesn't flicker it.
  const [revealedBranchMismatchKey, setRevealedBranchMismatchKey] = useState<string | null>(null);
  // Dismissal lives in a module-level set (survives remounts); this tick just
  // forces a re-render so the banner leaves immediately.
  const [, setBranchMismatchDismissTick] = useState(0);
  const activeBranchMismatchKey = branchMismatchKey(
    activeThread?.id ?? null,
    localCheckoutBranchMismatch,
  );
  const showBranchMismatchBanner = shouldShowBranchMismatchBanner({
    hasMismatch: localCheckoutBranchMismatch !== null,
    isDismissed: isBranchMismatchDismissedForSession(activeBranchMismatchKey),
    composerHasContent: composerHasUnsentContent,
    wasShownForCurrentMismatch:
      revealedBranchMismatchKey !== null && revealedBranchMismatchKey === activeBranchMismatchKey,
  });
  useEffect(() => {
    setRevealedBranchMismatchKey((revealed) => {
      if (showBranchMismatchBanner) {
        return activeBranchMismatchKey;
      }
      // Hysteresis is scoped to an uninterrupted mismatch: reset when the
      // mismatch resolves or changes so a recurrence re-gates on intent.
      return revealed !== null && revealed !== activeBranchMismatchKey ? null : revealed;
    });
  }, [activeBranchMismatchKey, showBranchMismatchBanner]);
  const handleSwitchCheckoutToThread = useCallback(async () => {
    if (
      !activeProjectCwd ||
      !activeThread ||
      !localCheckoutBranchMismatch ||
      isRestoringThreadBranch
    ) {
      return;
    }
    setIsRestoringThreadBranch(true);
    const checkoutResult = await switchGitRef({
      environmentId,
      input: {
        cwd: activeProjectCwd,
        refName: localCheckoutBranchMismatch.threadBranch,
      },
    });
    if (checkoutResult._tag === "Failure") {
      setIsRestoringThreadBranch(false);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch checkout",
            description: chatActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
      return;
    }

    const nextBranch = checkoutResult.value.refName ?? localCheckoutBranchMismatch.threadBranch;
    if (nextBranch !== activeThread.branch) {
      const updateResult = await updateThreadMetadata({
        environmentId,
        input: { threadId: activeThread.id, branch: nextBranch, worktreePath: null },
      });
      if (updateResult._tag === "Failure") {
        setIsRestoringThreadBranch(false);
        if (!isAtomCommandInterrupted(updateResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Checkout switched, but the thread could not be updated",
              description: chatActionErrorMessage(squashAtomCommandFailure(updateResult)),
            }),
          );
        }
        gitStatusQuery.refresh();
        return;
      }
    }
    gitStatusQuery.refresh();
    setIsRestoringThreadBranch(false);
    scheduleComposerFocus();
  }, [
    activeProjectCwd,
    activeThread,
    environmentId,
    gitStatusQuery,
    isRestoringThreadBranch,
    localCheckoutBranchMismatch,
    scheduleComposerFocus,
    switchGitRef,
    updateThreadMetadata,
  ]);
  // Background work (subagent fleets, workflow runs, watch loops) can outlive
  // the turn; once it settles, the composer stop button is gone, so this
  // banner is the only visible stop affordance. Stop routes through the
  // stop-everything interrupt: it kills every live background task before
  // interrupting, and works by session, so no active turn is needed.
  const activeBackgroundLiveness =
    !isWorking && activeThread ? (activeThreadShell?.backgroundLiveness ?? null) : null;
  const [isStoppingBackgroundWork, setIsStoppingBackgroundWork] = useState(false);
  useEffect(() => {
    // "Stopping..." holds until the liveness clears; the interrupt command
    // returning only means the request was accepted.
    if (activeBackgroundLiveness === null) {
      setIsStoppingBackgroundWork(false);
    }
  }, [activeBackgroundLiveness]);
  useEffect(() => {
    // Per-thread state: switching threads while A's stop is pending must not
    // disable B's Stop button (review finding).
    setIsStoppingBackgroundWork(false);
  }, [activeThreadId]);
  const handleStopBackgroundWork = useCallback(async () => {
    if (!activeThread) return;
    setIsStoppingBackgroundWork(true);
    const result = await interruptThreadTurn({
      environmentId,
      input: buildThreadTurnInterruptInput(activeThread),
    });
    if (result._tag === "Failure") {
      // Every failure clears the pending state — an interrupted command
      // never reached the server, so liveness would hold "Stopping..."
      // forever. Only real failures toast.
      setIsStoppingBackgroundWork(false);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to stop background work.",
        );
      }
    }
  }, [activeThread, environmentId, interruptThreadTurn, setThreadError]);
  const backgroundLivenessBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (activeBackgroundLiveness === null || !activeThread) {
      return null;
    }
    const working = activeBackgroundLiveness === "working";
    const liveCount = agentPanelModel.liveCount;
    return {
      id: `background-liveness:${activeThread.id}`,
      variant: "default",
      priority: "activity",
      icon: (
        <span
          className={cn("size-1.5 rounded-full bg-foreground", working && "animate-status-pulse")}
          aria-hidden="true"
        />
      ),
      title: working
        ? liveCount > 0
          ? `${liveCount} ${liveCount === 1 ? "agent" : "agents"} working`
          : "Background work"
        : "Monitoring",
      actions: (
        <Button
          size="xs"
          variant="ghost"
          disabled={isStoppingBackgroundWork}
          onClick={() => void handleStopBackgroundWork()}
        >
          {isStoppingBackgroundWork ? "Stopping..." : "Stop"}
        </Button>
      ),
    };
  }, [
    activeBackgroundLiveness,
    activeThread,
    agentPanelModel.liveCount,
    handleStopBackgroundWork,
    isStoppingBackgroundWork,
  ]);
  // A woken thread announces itself in the open view, not just the sidebar
  // pill. Dismissing marks the wake as seen (same acknowledgment as the
  // pill); sending a message clears it as a side effect of the send path.
  const wokeThreadBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (!activeThreadWokeVisible) {
      return null;
    }
    return {
      id: `thread-woke:${activeThread?.id ?? "unknown"}`,
      variant: "info",
      icon: <AlarmClockIcon />,
      title: "Thread woke from snooze",
      description: "Send a message to continue",
      dismissLabel: "Dismiss Woke notification",
      onDismiss: acknowledgeActiveThreadWoke,
    };
  }, [acknowledgeActiveThreadWoke, activeThread?.id, activeThreadWokeVisible]);
  const parkedThreadBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (!activeThreadSnoozed && !activeThreadSettled) {
      return null;
    }
    const isSnoozed = activeThreadSnoozed;
    return {
      id: `thread-${isSnoozed ? "snoozed" : "settled"}:${activeThread?.id ?? "unknown"}`,
      variant: "info",
      icon: isSnoozed ? <AlarmClockIcon /> : <CheckCircle2Icon />,
      title: `This thread is ${isSnoozed ? "snoozed" : "settled"}`,
      description: `Send a message to ${isSnoozed ? "wake" : "unsettle"}`,
      actions: (
        <Button
          size="xs"
          variant="ghost"
          disabled={isSnoozed ? isUnsnoozing : isUnsettling}
          onClick={() =>
            void (isSnoozed ? handleUnsnoozeActiveThread() : handleUnsettleActiveThread())
          }
        >
          {isSnoozed
            ? isUnsnoozing
              ? "Waking..."
              : "Wake now"
            : isUnsettling
              ? "Un-settling..."
              : "Un-settle"}
        </Button>
      ),
    };
  }, [
    activeThread?.id,
    activeThreadSettled,
    activeThreadSnoozed,
    handleUnsnoozeActiveThread,
    handleUnsettleActiveThread,
    isUnsnoozing,
    isUnsettling,
  ]);
  // Session-scoped dismissals, one key per (thread, snapshot). A set rather
  // than a single slot so dismissing the banner on one thread does not
  // resurface it on another thread dismissed earlier.
  const [dismissedResumeCompactionKeys, setDismissedResumeCompactionKeys] = useState<
    ReadonlySet<string>
  >(new Set());
  const resumeCompactionKey =
    activeThread && activeContextWindow
      ? `${activeThread.id}:${activeContextWindow.updatedAt}`
      : null;
  const activeThreadHasCompactableConversation =
    activeThread?.messages.some(
      (message) => message.role === "user" && !isCompactCommandMessage(message),
    ) ?? false;
  const compactThreadUnavailable =
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    threadDetailLoading ||
    isPreparingWorktree ||
    activeEnvironmentUnavailable ||
    feedbackUploading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0 ||
    showPlanFollowUpPrompt;
  const compactDisabled = compactThreadUnavailable || composerHasUnsentContent;
  const compactDisabledReason = compactDisabled
    ? composerHasUnsentContent
      ? "Send or clear your draft before compacting"
      : !activeProject
        ? "Choose a project before compacting"
        : !manualCompactionProviderAvailable
          ? "Compaction is unavailable for this provider"
          : "Compacting is unavailable right now"
    : null;
  const resumeCompactionBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (
      !activeThread ||
      !activeContextWindow ||
      resumeCompactionKey === null ||
      dismissedResumeCompactionKeys.has(resumeCompactionKey) ||
      resumeCompactionPermanentlyDismissed ||
      nativeResumeCompactionDismissed ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      !shouldOfferResumeCompaction({
        provider: selectedProvider,
        usedTokens: activeContextWindow.usedTokens,
        updatedAt: activeContextWindow.updatedAt,
        now: `${nowMinute}:00.000Z`,
      })
    ) {
      return null;
    }

    const dismiss = () =>
      setDismissedResumeCompactionKeys((keys) => new Set(keys).add(resumeCompactionKey));
    const compactAction = (
      <Button
        size="xs"
        variant="ghost"
        disabled={compactDisabled}
        onClick={() => {
          if (compactDisabled) return;
          composerRef.current?.compactContext();
        }}
      >
        Compact
      </Button>
    );
    return {
      id: `resume-compaction:${resumeCompactionKey}`,
      variant: "info",
      icon: <Minimize2Icon />,
      title: "Resume with less context",
      description: `${formatContextWindowTokens(activeContextWindow.usedTokens)} tokens from earlier`,
      actions: compactDisabledReason ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex">{compactAction}</span>} />
          <TooltipPopup side="top">{compactDisabledReason}</TooltipPopup>
        </Tooltip>
      ) : (
        compactAction
      ),
      dismissLabel: "Keep full history",
      onDismiss: dismiss,
    };
  }, [
    activeContextWindow,
    activeThread,
    compactDisabled,
    compactDisabledReason,
    composerRef,
    dismissedResumeCompactionKeys,
    nativeResumeCompactionDismissed,
    nowMinute,
    pendingUserInputs.length,
    phase,
    resumeCompactionKey,
    resumeCompactionPermanentlyDismissed,
    selectedProvider,
  ]);
  const handleRestoreThreadBranch = useCallback(() => {
    if (gitStatusQuery.data?.hasWorkingTreeChanges) {
      setBranchRestoreConfirmOpen(true);
      return;
    }
    void handleSwitchCheckoutToThread();
  }, [gitStatusQuery.data?.hasWorkingTreeChanges, handleSwitchCheckoutToThread]);
  const composerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const backgroundLivenessItems =
      backgroundLivenessBannerItem === null ? [] : [backgroundLivenessBannerItem];
    const resumeCompactionItems =
      resumeCompactionBannerItem === null ? [] : [resumeCompactionBannerItem];
    const wokeThreadItems = wokeThreadBannerItem === null ? [] : [wokeThreadBannerItem];
    const parkedThreadItems = parkedThreadBannerItem === null ? [] : [parkedThreadBannerItem];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [
        ...systemComposerBannerItems,
        ...backgroundLivenessItems,
        ...resumeCompactionItems,
        ...wokeThreadItems,
        ...parkedThreadItems,
      ];
    }
    return [
      ...systemComposerBannerItems,
      ...backgroundLivenessItems,
      ...resumeCompactionItems,
      ...wokeThreadItems,
      {
        id: `branch-mismatch:${activeBranchMismatchKey}`,
        variant: "info",
        icon: <GitBranchIcon />,
        title: (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-normal text-muted-foreground">Branch changed — was</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <code className="min-w-0 truncate font-medium text-foreground">
                    {localCheckoutBranchMismatch.threadBranch}
                  </code>
                }
              />
              <TooltipPopup side="top" className="max-w-80">
                This thread last ran on {localCheckoutBranchMismatch.threadBranch}. Sending will
                continue on {localCheckoutBranchMismatch.currentBranch}.
              </TooltipPopup>
            </Tooltip>
          </span>
        ),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            disabled={isRestoringThreadBranch}
            onClick={handleRestoreThreadBranch}
          >
            {isRestoringThreadBranch ? "Restoring..." : "Restore branch"}
          </Button>
        ),
        dismissLabel: "Dismiss branch change notice",
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      },
      ...parkedThreadItems,
    ];
  }, [
    activeBranchMismatchKey,
    backgroundLivenessBannerItem,
    handleRestoreThreadBranch,
    isRestoringThreadBranch,
    localCheckoutBranchMismatch,
    parkedThreadBannerItem,
    resumeCompactionBannerItem,
    showBranchMismatchBanner,
    systemComposerBannerItems,
    wokeThreadBannerItem,
  ]);
  useEffect(() => {
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [activeThread?.id]);

  useEffect(() => {
    if (canOverrideServerThreadEnvMode) {
      return;
    }
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [canOverrideServerThreadEnvMode]);

  useEffect(() => {
    if (!activeThreadId) {
      setTerminalUiLaunchContext(null);
      return;
    }
    setTerminalUiLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalUiLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeThreadWorktreePath ?? null) === current.worktreePath
      ) {
        return null;
      }
      return current;
    });
  }, [activeProjectCwd, activeThreadId, activeThreadWorktreePath]);

  useEffect(() => {
    if (terminalUiState.terminalOpen) {
      return;
    }
    setTerminalUiLaunchContext((current) =>
      current?.threadId === activeThreadId ? null : current,
    );
  }, [activeThreadId, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalUiOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalUiState.terminalOpen);

    if (!previous && current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalUiOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposer, terminalUiState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }
      // While a close confirmation is open, terminal focus has moved to the
      // dialog, so a deliberate second close shortcut would otherwise fall
      // through to the native window/tab close accelerator.
      if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }
      if (!activeThreadId || isCommandPaletteOpen()) {
        return;
      }
      const terminalFocusOwner = getTerminalFocusOwner();
      if (event.defaultPrevented && terminalFocusOwner === null) {
        return;
      }
      const shortcutContext = {
        terminalFocus: terminalFocusOwner !== null,
        terminalOpen: Boolean(terminalUiState.terminalOpen),
        modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
      };

      if (
        !shortcutContext.terminalFocus &&
        !shortcutContext.modelPickerOpen &&
        shouldTypeToFocusComposer(event)
      ) {
        if (composerRef.current?.insertTextAtEnd(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "thread.copyReference") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) copyActiveThreadReference();
        return;
      }

      if (command === "thread.settle") {
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThreadRef || !supportsSettlement) return;
        if (activeThreadSettled) {
          void handleUnsettleActiveThread();
          return;
        }

        void settleThread(activeThreadRef).then((result) => {
          if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        });
        return;
      }

      if (command === "thread.pin") {
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThreadRef || !supportsPinning) return;
        const pinned = activeThreadPinned;
        void (pinned ? confirmAndUnpinThread(activeThreadRef) : pinThread(activeThreadRef)).then(
          (result) => {
            if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: pinned ? "Failed to unpin thread" : "Failed to pin thread",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          },
        );
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "rightPanel.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleRightPanel();
        return;
      }

      if (command === "rightPanel.toggleMaximized") {
        event.preventDefault();
        event.stopPropagation();
        toggleRightPanelMaximized();
        return;
      }

      if (command === "rightPanel.close") {
        // Nothing open: leave the event alone so the shortcut keeps its
        // native meaning (close window on desktop, close tab in a browser).
        if (!activeRightPanelSurface) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) closeRightPanelSurface(activeRightPanelSurface);
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminal();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.splitVertical") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminal("vertical");
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal("vertical");
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel" && activeRightPanelSurface?.kind === "terminal") {
          requestClosePanelTerminal(activeRightPanelSurface.activeTerminalId);
          return;
        }
        if (!terminalUiState.terminalOpen) return;
        requestCloseTerminal(terminalUiState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          addTerminalSurface();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      if (command === "modelPicker.toggle") {
        event.preventDefault();
        event.stopPropagation();
        composerRef.current?.toggleModelPicker();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeProject,
    activeRightPanelSurface,
    addTerminalSurface,
    activeThreadRef,
    activeThreadPinned,
    activeThreadSettled,
    terminalUiState.terminalOpen,
    terminalUiState.activeTerminalId,
    activeThreadId,
    closeRightPanelSurface,
    requestCloseTerminal,
    requestClosePanelTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    splitPanelTerminal,
    keybindings,
    handleUnsettleActiveThread,
    isServerThread,
    onToggleDiff,
    pinThread,
    settleThread,
    supportsPinning,
    supportsSettlement,
    confirmAndUnpinThread,
    copyActiveThreadReference,
    toggleRightPanel,
    toggleRightPanelMaximized,
    toggleTerminalVisibility,
    composerRef,
  ]);

  // Paste-to-focus: the resting composer blurs on a click into the timeline,
  // so a paste that follows has no editable target and would be dropped.
  // Route it to the composer like a typed key, which also expands it.
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (!activeThreadId || isCommandPaletteOpen()) return;
      if (getTerminalFocusOwner() !== null) return;
      if (composerRef.current?.isModelPickerOpen()) return;
      const text = pasteTextToFocusComposer(event);
      if (text === null) return;
      if (composerRef.current?.insertTextAtEnd(text)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("paste", handler, true);
    return () => window.removeEventListener("paste", handler, true);
  }, [activeThreadId, composerRef]);

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const localApi = readLocalApi();
      if (!localApi || !activeThread || isRevertingCheckpoint) return;

      if (!supportsConversationRollback) {
        setThreadError(
          activeThread.id,
          "This provider does not support reverting conversation history. Start a new thread instead.",
        );
        return;
      }
      if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
        setThreadError(
          activeThread.id,
          `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
        );
        return;
      }
      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
        return;
      }
      const confirmed = await localApi.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      const result = await revertThreadCheckpoint({
        environmentId,
        input: {
          threadId: activeThread.id,
          turnCount,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [
      activeThread,
      activeEnvironmentUnavailable,
      activeEnvironmentUnavailableLabel,
      environmentId,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      revertThreadCheckpoint,
      setThreadError,
      supportsConversationRollback,
    ],
  );

  const onSend = async (
    e?: { preventDefault: () => void },
    options?: {
      dispatchPolicy?: "immediate" | "queue";
      submissionIntent?: ComposerSubmissionIntent;
      directAnnotation?: {
        annotation: PreviewAnnotationPayload;
        image: ComposerImageAttachment | null;
      };
    },
  ) => {
    e?.preventDefault();
    const directAnnotation = options?.directAnnotation;
    const notifyDirectAnnotationAttached = () => {
      if (!directAnnotation) return;
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Annotation attached to draft",
          description: "Sending is unavailable right now. Finish the current action, then send.",
        }),
      );
    };
    if (
      !activeThread ||
      isSendBusy ||
      isConnecting ||
      threadDetailLoading ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      notifyDirectAnnotationAttached();
      return;
    }
    if (activeEnvironmentUnavailable) {
      const toastSlot = environmentUnavailableSendToastSlotRef.current;
      environmentUnavailableSendToastSlotRef.current =
        (toastSlot + 1) % ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE;
      toastManager.add({
        ...stackedThreadToast({
          type: "warning",
          title: "Not connected: message not sent",
          description: "Reconnecting to the environment. Try again once it is connected.",
        }),
        id: `chat-send-environment-unavailable:${toastSlot}`,
      });
      return;
    }
    if (activePendingProgress) {
      if (directAnnotation) {
        notifyDirectAnnotationAttached();
        return;
      }
      onAdvanceActivePendingUserInput();
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable) {
      notifyDirectAnnotationAttached();
      return;
    }
    const {
      attachments: sendContextAttachments,
      files: sendContextFiles,
      terminalContexts: composerTerminalContexts,
      elementContexts: composerElementContexts,
      previewAnnotations: sendContextPreviewAnnotations,
      reviewComments: composerReviewComments,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      interactionMode: sendInteractionMode,
      interactionModeEnabled: sendInteractionModeEnabled,
    } = sendCtx;
    const annotationImageAlreadyAttached =
      directAnnotation?.image !== undefined &&
      directAnnotation.image !== null &&
      sendContextAttachments.some((attachment) => attachment.id === directAnnotation.image?.id);
    const annotationImageAppended =
      directAnnotation?.image !== undefined &&
      directAnnotation.image !== null &&
      !annotationImageAlreadyAttached &&
      sendContextAttachments.length + sendContextFiles.length < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
    const composerAttachments =
      directAnnotation?.image && annotationImageAppended
        ? [...sendContextAttachments, directAnnotation.image]
        : sendContextAttachments;
    const composerPreviewAnnotations =
      directAnnotation &&
      !sendContextPreviewAnnotations.some(
        (annotation) => annotation.id === directAnnotation.annotation.id,
      )
        ? [
            ...sendContextPreviewAnnotations,
            {
              ...directAnnotation.annotation,
              // Claim an attached crop only when the screenshot really rides
              // along; a cap-dropped image must not produce a lying prompt.
              screenshot:
                directAnnotation.annotation.screenshot &&
                (annotationImageAppended || annotationImageAlreadyAttached)
                  ? { ...directAnnotation.annotation.screenshot, dataUrl: "" }
                  : null,
            },
          ]
        : sendContextPreviewAnnotations;
    const unsupportedComposerAttachments = composerAttachments.filter(
      (attachment) => attachment.status === "unsupported",
    );
    if (unsupportedComposerAttachments.length > 0) {
      setThreadError(
        activeThreadId,
        unsupportedComposerAttachments.length === 1
          ? `Remove unsupported attachment '${unsupportedComposerAttachments[0]?.name ?? "file"}' before sending.`
          : `Remove ${unsupportedComposerAttachments.length} unsupported attachments before sending.`,
      );
      return;
    }
    const sendableComposerAttachments = composerAttachments.filter(isSendableComposerAttachment);
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: sendableComposerAttachments.length + sendContextFiles.length,
      terminalContexts: composerTerminalContexts,
      elementContextCount:
        composerElementContexts.length +
        composerPreviewAnnotations.length +
        composerReviewComments.length,
    });
    const feedbackCommand =
      ctxSelectedProvider === "codex" &&
      sendableComposerAttachments.length === 0 &&
      sendContextFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerElementContexts.length === 0 &&
      composerPreviewAnnotations.length === 0 &&
      composerReviewComments.length === 0
        ? parseCodexFeedbackCommand(trimmed)
        : null;
    if (feedbackCommand) {
      if (!isServerThread || activeThread.session === null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Start a Codex thread first",
            description: "Send a message before you submit feedback.",
          }),
        );
        return;
      }
      feedbackUploadsInFlightRef.current.add(routeThreadKey);
      const result = await submitCodexFeedback({
        submission: {
          id: newMessageId(),
          command: trimmed,
          createdAt: new Date().toISOString(),
        },
        clearDraft: () => {
          promptRef.current = "";
          clearComposerDraftContent(composerDraftTarget);
          composerRef.current?.resetCursorState();
          scrollToEnd();
        },
        onUpdate: (submission) => {
          setFeedbackSubmissionsByThreadKey((current) => {
            const existing = current[routeThreadKey] ?? [];
            const found = existing.some((entry) => entry.id === submission.id);
            return {
              ...current,
              [routeThreadKey]: found
                ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
                : [...existing, submission],
            };
          });
        },
        upload: () =>
          uploadThreadFeedback({
            environmentId,
            input: {
              threadId: activeThread.id,
              ...feedbackCommand,
            },
          }),
      }).finally(() => {
        feedbackUploadsInFlightRef.current.delete(routeThreadKey);
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not send feedback to OpenAI",
              description: chatActionErrorMessage(squashAtomCommandFailure(result)),
            }),
          );
        }
        return;
      }
      const feedbackId = result.value.feedbackId;
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Feedback sent to OpenAI",
          description: `Thread ID: ${feedbackId}`,
          timeout: 0,
          actionProps: {
            children: "Copy ID",
            onClick: () => {
              void writeTextToClipboard(feedbackId, "Codex feedback thread ID").catch(
                (error: unknown) => {
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: "Could not copy thread ID",
                      description: chatActionErrorMessage(error),
                    }),
                  );
                },
              );
            },
          },
        }),
      );
      return;
    }
    if (
      !directAnnotation &&
      sendInteractionModeEnabled &&
      showPlanFollowUpPrompt &&
      activeProposedPlan &&
      sendableComposerAttachments.length === 0 &&
      sendContextFiles.length === 0
    ) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      const outgoingFollowUpText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: followUp.text.trim(),
      });
      if (composerRef.current?.validateProviderInput(outgoingFollowUpText) === false) {
        return;
      }
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    // Providers without the legacy toggle receive their native commands unchanged.
    const standaloneSlashCommand =
      settings.planModeEnabled &&
      sendableComposerAttachments.length === 0 &&
      sendContextFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerElementContexts.length === 0 &&
      composerPreviewAnnotations.length === 0 &&
      composerReviewComments.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      return;
    }
    if (!activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose a project first",
          description: "This draft no longer points to an available project.",
        }),
      );
      return;
    }
    const threadIdForSend = activeThread.id;
    const dispatchPolicy = options?.dispatchPolicy ?? "immediate";
    const isQueuedDispatch = dispatchPolicy === "queue";
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    const composerAttachmentsSnapshot = [...sendableComposerAttachments];
    const composerImagesSnapshot = composerAttachmentsSnapshot.filter(
      (attachment): attachment is ComposerImageAttachment => attachment.type === "image",
    );
    const composerInlineFilesSnapshot = composerAttachmentsSnapshot.filter(
      (attachment): attachment is ComposerFileAttachment & { readonly file: File } =>
        attachment.type === "file",
    );
    const composerFilesSnapshot = [...sendContextFiles];
    const composerUploadAttachmentsSnapshot = [
      ...composerImagesSnapshot,
      ...composerInlineFilesSnapshot,
      ...composerFilesSnapshot,
    ];
    const allComposerFilesSnapshot = [...composerInlineFilesSnapshot, ...composerFilesSnapshot];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerElementContextsSnapshot = [...composerElementContexts];
    const composerPreviewAnnotationsSnapshot = [...composerPreviewAnnotations];
    const composerReviewCommentsSnapshot: ReviewCommentContext[] = [...composerReviewComments];
    const mediaFollowUpReferences = resolveMediaFollowUpReferences({
      prompt: promptForSend,
      selectedArtifact: selectedThreadMediaArtifact,
      recentArtifacts: displayableThreadMediaArtifacts,
    });
    const promptWithMediaReferences = appendMediaFollowUpReferencesToPrompt({
      prompt: promptForSend,
      references: mediaFollowUpReferences,
    });
    const messageTextWithContexts = appendElementContextsToPrompt(
      appendTerminalContextsToPrompt(promptWithMediaReferences, composerTerminalContextsSnapshot),
      composerElementContextsSnapshot,
    );
    const messageTextWithPreviewAnnotations = composerPreviewAnnotationsSnapshot.reduce(
      (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
      messageTextWithContexts,
    );
    const messageTextForSend = appendReviewCommentsToPrompt(
      messageTextWithPreviewAnnotations,
      composerReviewCommentsSnapshot,
    );
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
    });
    if (composerRef.current?.validateProviderInput(outgoingMessageText) === false) {
      return;
    }

    const readLiveAttachmentCapabilities = () => {
      const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
      const liveSupportsAttachmentUploads =
        config?.environment.capabilities.attachmentUploads === true;
      return {
        supportsAttachmentUploads: liveSupportsAttachmentUploads,
        fileBlockReason: fileAttachmentCapabilityBlockReason({
          files: allComposerFilesSnapshot,
          attachmentUploadsCapabilityKnown: config !== null,
          supportsAttachmentUploads: liveSupportsAttachmentUploads,
          maxFileAttachmentBytes:
            config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
        }),
      };
    };

    sendInFlightRef.current = true;
    const attachmentCapabilitiesBeforeUpload = readLiveAttachmentCapabilities();
    if (attachmentCapabilitiesBeforeUpload.fileBlockReason !== null) {
      sendInFlightRef.current = false;
      setThreadError(threadIdForSend, attachmentCapabilitiesBeforeUpload.fileBlockReason);
      return;
    }
    const turnUsesAttachmentUploads =
      allComposerFilesSnapshot.length > 0
        ? attachmentCapabilitiesBeforeUpload.supportsAttachmentUploads
        : supportsAttachmentUploads;
    if (turnUsesAttachmentUploads && composerUploadAttachmentsSnapshot.length > 0) {
      for (const attachment of composerUploadAttachmentsSnapshot) {
        startAttachmentUpload({
          environmentId,
          image: attachment,
          draftTarget: composerDraftTarget,
        });
      }
      await awaitAttachmentUploads(
        composerUploadAttachmentsSnapshot.map((attachment) => attachment.id),
      );
      const attachmentCapabilitiesAfterUpload = readLiveAttachmentCapabilities();
      if (attachmentCapabilitiesAfterUpload.fileBlockReason !== null) {
        sendInFlightRef.current = false;
        setThreadError(threadIdForSend, attachmentCapabilitiesAfterUpload.fileBlockReason);
        return;
      }
      if (
        getUploadedAttachments({ environmentId, images: composerUploadAttachmentsSnapshot }) ===
        null
      ) {
        sendInFlightRef.current = false;
        setThreadError(threadIdForSend, "Retry or remove failed uploads before sending.");
        return;
      }
    }

    const resolvedSubmissionIntent =
      options?.submissionIntent === "background" && isLocalDraftThread
        ? "background"
        : "foreground";
    if (
      shouldDockDraftHeroForSubmission({
        isDraftHeroState,
        activeThreadKey,
        submissionIntent: resolvedSubmissionIntent,
      }) &&
      activeThreadKey
    ) {
      let resolveDockStarted: (() => void) | undefined;
      const dockStarted = new Promise<void>((resolve) => {
        resolveDockStarted = resolve;
      });
      const dockTransition = runMobileComposerTransition(() => {
        flushSync(() => {
          captureDraftHeroComposerRect();
          setDockedDraftHeroThreadKey(activeThreadKey);
        });
        resolveDockStarted?.();
      });
      void dockTransition.catch(() => resolveDockStarted?.());
      await dockStarted;
    }
    if (!isQueuedDispatch) {
      beginLocalDispatch({
        preparingWorktree: Boolean(baseBranchForWorktree),
        submissionIntent: resolvedSubmissionIntent,
      });
    }

    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const turnAttachmentsPromise = Promise.all([
      ...composerAttachmentsSnapshot.map(async (attachment) => {
        if (
          (attachment.type === "image" && supportsAttachmentUploads) ||
          (attachment.type === "file" && turnUsesAttachmentUploads)
        ) {
          const uploaded = getUploadedAttachments({ environmentId, images: [attachment] })?.[0];
          if (!uploaded) {
            throw new Error(`Attachment '${attachment.name}' did not finish uploading.`);
          }
          return uploaded;
        }
        return toUploadChatAttachment(attachment);
      }),
      ...composerFilesSnapshot.map(async (file) => {
        if (!turnUsesAttachmentUploads) {
          throw new Error("This server does not support file attachments.");
        }
        const uploaded = getUploadedAttachments({ environmentId, images: [file] })?.[0];
        if (!uploaded) {
          throw new Error(`Attachment '${file.name}' did not finish uploading.`);
        }
        return uploaded;
      }),
    ]);
    const optimisticAttachments: ChatAttachment[] = [
      ...composerAttachmentsSnapshot.map(toOptimisticChatAttachment),
      ...composerFilesSnapshot.map((file) => ({
        type: "file" as const,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        ...(file.previewUrl ? { previewUrl: file.previewUrl } : {}),
        downloadable: false,
      })),
    ];
    const optimisticMessage: ChatMessage = {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      turnId: null,
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
      streaming: false,
    };
    if (isQueuedDispatch) {
      setOptimisticQueuedMessages((existing) => [...existing, optimisticMessage]);
    } else {
      const shouldAnchorFirstMessage =
        activeThread.latestTurn === null &&
        !timelineMessages.some((message) => message.role === "user");
      if (shouldAnchorFirstMessage) {
        isAtEndRef.current = true;
        timelineScrollModeRef.current = "anchoring-new-turn";
        liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
        setTimelineLiveFollowEnabled(true);
        pendingTimelineAnchorRef.current = messageIdForSend;
        activeTimelineAnchorIndexRef.current = null;
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
        setTimelineAnchor({
          threadKey: scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
          messageId: messageIdForSend,
        });
      } else {
        scrollToEnd();
      }
      setOptimisticUserMessages((existing) => [...existing, optimisticMessage]);
    }
    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        }),
      );
    }
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    composerRef.current?.resetCursorState();

    const firstComposerAttachment =
      composerAttachmentsSnapshot[0] ?? composerFilesSnapshot[0] ?? null;
    let titleSeed = trimmed;
    if (!titleSeed) {
      if (firstComposerAttachment) {
        const attachmentKind =
          firstComposerAttachment.type === "video"
            ? "Video"
            : firstComposerAttachment.type === "file"
              ? "File"
              : "Image";
        titleSeed = `${attachmentKind}: ${firstComposerAttachment.name}`;
      } else if (composerTerminalContextsSnapshot.length > 0) {
        titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
      } else if (composerElementContextsSnapshot.length > 0) {
        titleSeed = formatElementContextLabel(composerElementContextsSnapshot[0]!);
      } else {
        titleSeed = "New thread";
      }
    }
    const title = truncate(titleSeed);
    const threadCreateModelSelection = createModelSelection(
      ctxSelectedModelSelection.instanceId,
      ctxSelectedModel || activeProject.defaultModelSelection?.model || DEFAULT_MODEL,
      ctxSelectedModelSelection.options,
    );

    let failure: AtomCommandResult<unknown, unknown> | null = null;
    // Auto-title from first message
    if (isFirstMessage && isServerThread) {
      const titleResult = await updateThreadMetadata({
        environmentId,
        input: {
          threadId: threadIdForSend,
          title,
        },
      });
      if (titleResult._tag === "Failure") {
        failure = titleResult;
      }
    }

    if (failure === null && isServerThread) {
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: sendInteractionMode,
      });
      if (settingsResult._tag === "Failure") {
        failure = settingsResult;
      }
    }

    const turnAttachmentsResult = await settlePromise(async () => {
      const turnAttachments = await turnAttachmentsPromise;
      const liveFileBlockReason = readLiveAttachmentCapabilities().fileBlockReason;
      if (liveFileBlockReason !== null) {
        throw new Error(liveFileBlockReason);
      }
      return turnAttachments;
    });
    if (failure === null && turnAttachmentsResult._tag === "Failure") {
      failure = turnAttachmentsResult;
    }

    let turnStartSucceeded = false;
    if (failure === null && turnAttachmentsResult._tag === "Success") {
      const bootstrap =
        isLocalDraftThread || baseBranchForWorktree
          ? {
              ...(isLocalDraftThread
                ? {
                    createThread: {
                      projectId: activeProject.id,
                      title,
                      modelSelection: threadCreateModelSelection,
                      runtimeMode,
                      interactionMode: sendInteractionMode,
                      branch: activeThreadBranch,
                      worktreePath: activeThread.worktreePath,
                      createdAt: activeThread.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject.workspaceRoot,
                      baseBranch: baseBranchForWorktree,
                      branch: buildTemporaryWorktreeBranchName(randomHex),
                      ...(startFromOrigin ? { startFromOrigin: true } : {}),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      if (!isQueuedDispatch) {
        beginLocalDispatch({
          preparingWorktree: false,
          submissionIntent: resolvedSubmissionIntent,
        });
      }
      const backgroundThreadRef =
        !isQueuedDispatch && resolvedSubmissionIntent === "background"
          ? scopeThreadRef(activeThread.environmentId, threadIdForSend)
          : null;
      if (backgroundThreadRef) {
        beginBackgroundDraftSubmissionByRef(backgroundThreadRef);
      }
      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: turnAttachmentsResult.value,
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          dispatchPolicy,
          ...(bootstrap ? { bootstrap } : {}),
          createdAt: messageCreatedAt,
        },
      });
      if (startResult._tag === "Failure") {
        if (backgroundThreadRef) {
          clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
        }
        failure = startResult;
      } else {
        turnStartSucceeded = true;
        if (
          isQueuedDispatch &&
          pendingQueuedMessageDeleteKeys.has(
            queuedMessageDeleteKey(environmentId, threadIdForSend, messageIdForSend),
          )
        ) {
          dispatchQueuedMessageDelete({
            queueId: null,
            messageId: messageIdForSend,
          });
        }
        if (turnUsesAttachmentUploads) {
          releaseDraftAttachments(composerUploadAttachmentsSnapshot);
        }
        acknowledgeActiveThreadWoke();
        if (backgroundThreadRef) {
          markPromotedDraftThreadByRef(backgroundThreadRef);
          try {
            const nextDraft = await handleNewThread(
              scopeProjectRef(activeProject.environmentId, activeProject.id),
              resolveBackgroundDraftWorkspaceOptions({
                envMode: sendEnvMode,
                branch: activeThreadBranch,
                startFromOrigin,
              }),
            );
            if (nextDraft) {
              finalizePromotedDraftThreadByRef(backgroundThreadRef);
              toastManager.add(
                stackedThreadToast({
                  type: "success",
                  title: "Started in background",
                  timeout: 5_000,
                  actionProps: {
                    children: "Open",
                    onClick: () => {
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(backgroundThreadRef),
                      });
                    },
                  },
                }),
              );
            } else {
              clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
            }
          } catch (error) {
            clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
            resetLocalDispatch();
            toastManager.add(
              stackedThreadToast({
                type: "warning",
                title: "Task started in the background",
                description:
                  error instanceof Error
                    ? `Could not open a fresh composer: ${error.message}`
                    : "Could not open a fresh composer.",
              }),
            );
          }
        }
      }
    }

    if (failure !== null) {
      const currentDraft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
      if (
        promptRef.current.length === 0 &&
        (currentDraft?.attachments.length ?? 0) === 0 &&
        (currentDraft?.files.length ?? 0) === 0 &&
        composerTerminalContextsRef.current.length === 0 &&
        composerElementContextsRef.current.length === 0 &&
        (currentDraft?.previewAnnotations.length ?? 0) === 0 &&
        (currentDraft?.reviewComments.length ?? 0) === 0
      ) {
        const removeOptimisticMessage = (existing: ChatMessage[]) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        };
        if (isQueuedDispatch) {
          setOptimisticQueuedMessages(removeOptimisticMessage);
        } else {
          setOptimisticUserMessages(removeOptimisticMessage);
        }
        promptRef.current = promptForSend;
        const retryComposerAttachments = composerAttachmentsSnapshot.map(
          cloneComposerAttachmentForRetry,
        );
        const retryComposerImages = retryComposerAttachments.filter(
          (attachment): attachment is ComposerImageAttachment => attachment.type === "image",
        );
        composerImagesRef.current = retryComposerImages;
        composerFilesRef.current = composerFilesSnapshot;
        composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
        composerElementContextsRef.current = composerElementContextsSnapshot;
        setComposerDraftPrompt(composerDraftTarget, promptForSend);
        addComposerDraftAttachments(composerDraftTarget, retryComposerAttachments);
        addComposerDraftFiles(composerDraftTarget, composerFilesSnapshot);
        setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
        setComposerDraftElementContexts(composerDraftTarget, composerElementContextsSnapshot);
        setComposerDraftPreviewAnnotations(composerDraftTarget, composerPreviewAnnotationsSnapshot);
        setComposerDraftReviewComments(composerDraftTarget, composerReviewCommentsSnapshot);
        composerRef.current?.resetCursorState({
          cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
          prompt: promptForSend,
          detectTrigger: true,
        });
      }
      if (isAtomCommandInterrupted(failure) && composerUploadAttachmentsSnapshot.length > 0) {
        setThreadError(
          threadIdForSend,
          "Attachment upload was interrupted. Your draft was restored; check the connection and try again.",
        );
      } else if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        if (isLocalDraftThread && draftId && wasBootstrapThreadDeleted(error)) {
          const failedDraftSession = getDraftSession(draftId);
          if (failedDraftSession?.threadId === threadIdForSend) {
            setLogicalProjectDraftThreadId(
              failedDraftSession.logicalProjectKey,
              scopeProjectRef(failedDraftSession.environmentId, failedDraftSession.projectId),
              draftId,
              {
                threadId: newThreadId(),
                createdAt: new Date().toISOString(),
              },
            );
          }
        }
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send message.",
        );
      }
    }
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      resetLocalDispatch();
    }
  };

  const onInterrupt = async () => {
    if (!activeThread) return;
    const result = await interruptThreadTurn({
      environmentId,
      input: buildThreadTurnInterruptInput(activeThread),
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to interrupt the current turn.",
      );
    }
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      if (!activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToThreadApproval({
        environmentId,
        input: {
          threadId: activeThreadId,
          requestId,
          decision,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to submit approval decision.",
        );
      }
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [activeThreadId, environmentId, respondToThreadApproval, setThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      if (!activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToThreadUserInput({
        environmentId,
        input: {
          threadId: activeThreadId,
          requestId,
          answers,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to submit user input.",
        );
      }
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [activeThreadId, environmentId, respondToThreadUserInput, setThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionValue: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          (activePendingProgress?.activeQuestion?.id === questionId
            ? activePendingProgress.activeQuestion
            : undefined) ??
          activePendingUserInput.questions.find((entry) => entry.id === questionId);
        if (!question) {
          return existing;
        }

        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionValue,
            ),
          },
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput, composerRef],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question || question.allowCustomAnswer === false) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput, composerRef],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
        return;
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

      scrollToEnd();

      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          turnId: null,
          createdAt: messageCreatedAt,
          updatedAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        modelSelection: ctxSelectedModelSelection,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
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
              attachments: [],
            },
            modelSelection: ctxSelectedModelSelection,
            titleSeed: activeThread.title,
            runtimeMode,
            interactionMode: nextInteractionMode,
            ...(nextInteractionMode === "default" && activeProposedPlan
              ? {
                  sourceProposedPlan: {
                    threadId: activeThread.id,
                    planId: activeProposedPlan.id,
                  },
                }
              : {}),
            createdAt: messageCreatedAt,
          },
        });
        failure = startResult._tag === "Failure" ? startResult : null;
      }

      if (failure === null) {
        acknowledgeActiveThreadWoke();
        sendInFlightRef.current = false;
        return;
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
    },
    [
      activeThread,
      activeProposedPlan,
      acknowledgeActiveThreadWoke,
      beginLocalDispatch,
      isConnecting,
      isSendBusy,
      isServerThread,
      localCheckoutBranchMismatch,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      runtimeMode,
      scrollToEnd,
      setComposerDraftInteractionMode,
      setThreadError,
      startThreadTurn,
      environmentId,
      composerRef,
    ],
  );

  const onSubmitWorkflowGuidance = useCallback(
    (lane: WorkflowLaneTarget, guidance: string) => {
      if (!activeThread) return;

      const { goal, plannedSubAgents } = latestWorkflowPlanDetails(
        activeThread.activities,
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
      const existingChildThreadId = latestWorkflowChildThreadId(activeThread.activities, lane);

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
        try {
          await launchWorkflowChildLane({
            lane: plannedLane,
            workflowGoal: goal,
            guidance,
            existingChildThreadId,
          });
        } finally {
          workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
        }
      })();
    },
    [activePlan?.explanation, activeThread, appendWorkflowActivity, launchWorkflowChildLane],
  );

  const onStartWorkflow = useCallback(() => {
    if (!activeThread) return;
    const {
      activity: workflowPlanActivity,
      payload: workflowPlanPayload,
      goal,
      plannedSubAgents,
    } = latestWorkflowPlanDetails(activeThread.activities, activePlan?.explanation ?? "Workflow");
    const launchableSubAgents = plannedSubAgents.filter(
      (agent) => (agent.startsAfter?.length ?? 0) === 0,
    );
    const startedLaneIds = workflowStartedChildLaneIds(activeThread.activities);

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
        try {
          const childThreadId = await launchWorkflowChildLane({
            lane,
            workflowGoal: goal,
          });
          if (childThreadId) {
            workflowLaneLaunchRecordedRef.current.add(laneLaunchKey);
          }
        } finally {
          workflowLaneLaunchInFlightRef.current.delete(laneLaunchKey);
        }
      }
    })();
  }, [activePlan?.explanation, activeThread, appendWorkflowActivity, launchWorkflowChildLane]);

  const onStopWorkflowLane = useCallback(
    (lane: WorkflowLaneTarget) => {
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
    },
    [activeThread, appendWorkflowActivity, onSubmitPlanFollowUp],
  );

  const onStopWorkflow = useCallback(() => {
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
  }, [activeThread, appendWorkflowActivity, onInterrupt]);

  const onWorkflowLaneControl = useCallback(
    (lane: WorkflowLaneTarget, action: "pause" | "replace" | "freeze" | "continue-manually") => {
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
    },
    [activeThread, appendWorkflowActivity, onSubmitPlanFollowUp],
  );

  const onWorkflowControl = useCallback(
    (action: "pause" | "freeze" | "continue-manually") => {
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
    },
    [activeThread, appendWorkflowActivity, onSubmitPlanFollowUp],
  );

  const onCustomizeWorkflow = useCallback(
    (input: {
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
    },
    [activeThread, appendWorkflowActivity, onSubmitPlanFollowUp],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    if (
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    if (composerRef.current?.validateProviderInput(outgoingImplementationPrompt) === false) {
      return;
    }
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    const createResult = await createThread({
      environmentId,
      input: {
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      },
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      createResult._tag === "Failure" ? createResult : null;

    if (failure === null) {
      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      const startedResult = await settlePromise(() =>
        waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId)),
      );
      failure = startedResult._tag === "Failure" ? startedResult : null;
    }

    if (failure === null) {
      const navigateResult = await settlePromise(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        }),
      );
      failure = navigateResult._tag === "Failure" ? navigateResult : null;
    }

    if (failure !== null) {
      const cleanupResult = await deleteThread({
        environmentId,
        input: {
          threadId: nextThreadId,
        },
      });
      if (cleanupResult._tag === "Failure" && !isAtomCommandInterrupted(cleanupResult)) {
        console.warn(
          "Failed to clean up implementation thread after start failure.",
          squashAtomCommandFailure(cleanupResult),
        );
      }
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start implementation thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while creating the new thread.",
          }),
        );
      }
    }
    finish();
  }, [
    activeProject,
    activeProposedPlan,
    activeThreadBranch,
    activeThread,
    beginLocalDispatch,
    activeEnvironmentUnavailable,
    createThread,
    deleteThread,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    startThreadTurn,
    environmentId,
    composerRef,
  ]);

  const getModelDisabledReason = useCallback(
    (instanceId: ProviderInstanceId, model: string): string | null => {
      if (!activeThread) {
        return null;
      }
      const reason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection: { instanceId, model },
      });
      return reason ? `${reason.description} Start a new thread to use this model.` : null;
    },
    [activeThread, providerStatuses],
  );

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeThread) return;
      // Look up the configured instance so model normalization and custom
      // model lookup stay scoped to that exact instance. Unknown instance ids
      // are rejected by returning early; the server remains authoritative too.
      const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
      const resolvedDriverKind = entry?.driver ?? null;
      if (
        lockedProvider !== null &&
        resolvedDriverKind !== null &&
        resolvedDriverKind !== lockedProvider
      ) {
        scheduleComposerFocus();
        return;
      }
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection,
      });
      if (modelChangeBlockReason) {
        toastManager.add({
          type: "warning",
          title: modelChangeBlockReason.title,
          description: modelChangeBlockReason.description,
        });
        scheduleComposerFocus();
        return;
      }
      setComposerDraftModelSelection(
        scopeThreadRef(activeThread.environmentId, activeThread.id),
        nextModelSelection,
        { explicit: true },
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (canOverrideServerThreadEnvMode) {
        setPendingServerThreadEnvMode(mode);
        scheduleComposerFocus();
        return;
      }
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, {
          envMode: mode,
          startFromOrigin: resolveNewDraftStartFromOrigin({
            envMode: mode,
            newWorktreesStartFromOrigin: primaryServerSettings.newWorktreesStartFromOrigin,
          }),
          ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
        });
      }
      scheduleComposerFocus();
    },
    [
      canOverrideServerThreadEnvMode,
      composerDraftTarget,
      draftThread?.worktreePath,
      isLocalDraftThread,
      primaryServerSettings.newWorktreesStartFromOrigin,
      setPendingServerThreadEnvMode,
      scheduleComposerFocus,
      setDraftThreadContext,
    ],
  );

  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    if (canOverrideServerThreadEnvMode && activeThread) {
      setPendingServerThreadStartFromOriginByThreadId((current) =>
        current[activeThread.id] === nextStartFromOrigin
          ? current
          : { ...current, [activeThread.id]: nextStartFromOrigin },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };

  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (!isServerThread || !activeThreadRef) return;
      useDiffPanelStore.getState().selectTurn(activeThreadRef, turnId, filePath);
      useRightPanelStore.getState().open(activeThreadRef, "diff");
      onDiffPanelOpen?.();
    },
    [activeThreadRef, isServerThread, onDiffPanelOpen],
  );
  // Both the Map and the revert handler are read from refs at call-time so
  // the callback reference is fully stable and never busts context identity.
  const revertTurnCountRef = useRef(revertTurnCountByUserMessageId);
  revertTurnCountRef.current = revertTurnCountByUserMessageId;
  const onRevertToTurnCountRef = useRef(onRevertToTurnCount);
  onRevertToTurnCountRef.current = onRevertToTurnCount;
  const onRevertUserMessage = useCallback((messageId: MessageId) => {
    const targetTurnCount = revertTurnCountRef.current.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCountRef.current(targetTurnCount);
  }, []);

  // Empty state: no active thread
  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  const panelToggleControls = (
    <PanelLayoutControls
      terminalAvailable={activeProject !== null}
      terminalOpen={terminalUiState.terminalOpen}
      terminalShortcutLabel={shortcutLabelForCommand(keybindings, "terminal.toggle")}
      rightPanelAvailable={activeProject !== null}
      rightPanelOpen={rightPanelOpen}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      // Suppressed while the Agents surface is visible: the roster itself is
      // on screen, so the toggle badge would be pointing at nothing.
      liveAgentCount={
        rightPanelOpen && activeRightPanelSurface?.kind === "agents" ? 0 : agentPanelModel.liveCount
      }
      onToggleTerminal={toggleTerminalVisibility}
      onToggleRightPanel={toggleRightPanel}
    />
  );
  const panelLayoutControls = (
    <div
      className={cn(
        // Keep one viewport anchor inside the header's no-drag region. The
        // header can shrink behind the right panel without moving the controls.
        "pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
      )}
      data-workspace-titlebar-controls
    >
      {!shouldUseRightPanelSheet ? (
        <span
          aria-hidden={!rightPanelOpen}
          className={cn(
            "flex shrink-0",
            panelAnimationsActive &&
              "motion-safe:transition-opacity motion-safe:[transition-duration:var(--panel-animation-duration)] motion-safe:ease-out",
            rightPanelOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
          inert={!rightPanelOpen}
        >
          <RightPanelMaximizeControl
            maximized={rightPanelMaximized}
            onToggle={toggleRightPanelMaximized}
          />
        </span>
      ) : null}
      <div className="pointer-events-auto flex h-full items-center">{panelToggleControls}</div>
    </div>
  );
  const rightPanelContent = activeThreadRef ? (
    renderedRightPanelSurface?.kind === "preview" ? (
      <Suspense fallback={null}>
        <PreviewPanel
          mode="embedded"
          threadRef={activeThreadRef}
          tabId={renderedRightPanelSurface.resourceId}
          configuredUrls={configuredPreviewUrls}
          visible
          browserAvailable={browserAvailable}
          onSendAnnotation={(annotation, image) => {
            void onSend(undefined, { directAnnotation: { annotation, image } });
          }}
        />
      </Suspense>
    ) : renderedRightPanelSurface?.kind === "terminal" ? (
      <PersistentThreadTerminalPanel
        visible={rightPanelOpen}
        threadRef={activeThreadRef}
        surface={renderedRightPanelSurface}
        launchContext={activeTerminalLaunchContext ?? null}
        focusRequestId={terminalFocusRequestId}
        keybindings={keybindings}
        onAddTerminalContext={addTerminalContextToDraft}
        onSplitTerminal={splitPanelTerminal}
        onSplitTerminalVertical={splitPanelTerminalVertical}
        onNewTerminal={addTerminalSurface}
        onActiveTerminalChange={activatePanelTerminal}
        onCloseTerminal={closePanelTerminal}
        splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
        splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
        newShortcutLabel={newTerminalShortcutLabel ?? undefined}
        closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
      />
    ) : renderedRightPanelSurface?.kind === "diff" ? (
      <Suspense fallback={null}>
        <DiffPanel
          key={`${activeThreadKey}:${diffPanelGitStatusResolutionKey}`}
          mode="embedded"
          composerDraftTarget={composerDraftTarget}
          initialGitScope={initialDiffPanelGitScope}
          workspaceMutationId={workspaceMutationId}
        />
      </Suspense>
    ) : activeRightPanelSurface?.kind === "plan" ? (
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
    ) : activeRightPanelSurface?.kind === "pull-request" && !pullRequestsCapabilityKnown ? (
      <PullRequestDetailGhost />
    ) : renderedRightPanelSurface?.kind === "pull-request" && !supportsPullRequests ? (
      <PullRequestsUnavailableState
        title="Pull requests unavailable"
        error="Update this environment's KamiCode server to browse pull requests."
      />
    ) : renderedRightPanelSurface?.kind === "pull-request" ? (
      // No onClose: the surface tab's own X owns closing here, and a second X in the header
      // would be the same action twice. The thread context also drops the checkout button, so it
      // is only right for the thread's own pull request, whose branch is already under the
      // reader's feet. A link the agent wrote can open any other one here, and that one has to be
      // checkable out like it is anywhere else.
      <PullRequestDetailPanel
        key={`${renderedRightPanelSurface.repository}#${renderedRightPanelSurface.number}`}
        environmentId={activeThread.environmentId}
        threadRef={activeThreadRef}
        reference={{
          projectId: renderedRightPanelSurface.projectId as ProjectId,
          repository: renderedRightPanelSurface.repository,
          number: renderedRightPanelSurface.number,
        }}
        context={
          isThreadOwnPullRequest(
            {
              projectId: linkedThreadPullRequest?.projectId ?? activeProject?.id ?? null,
              repository: threadRepository,
              number: activeThreadPr?.number ?? null,
            },
            {
              projectId: renderedRightPanelSurface.projectId,
              repository: renderedRightPanelSurface.repository,
              number: renderedRightPanelSurface.number,
            },
          )
            ? "thread"
            : "page"
        }
        composerDraftTarget={composerDraftTarget}
        {...(linkedThreadPullRequest === null
          ? { onStateChange: handlePullRequestTabStatusChange }
          : {})}
      />
    ) : renderedRightPanelSurface?.kind === "agents" ? (
      <AgentsPanel
        model={agentPanelModel}
        environmentId={activeThreadRef?.environmentId ?? null}
        threadId={activeThreadRef?.threadId ?? null}
      />
    ) : (renderedRightPanelSurface?.kind === "files" ||
        renderedRightPanelSurface?.kind === "file") &&
      ((activeProject && activeWorkspaceRoot) ||
        (renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment)) ? (
      <Suspense fallback={null}>
        <FilePreviewPanel
          key={`${activeThread.environmentId}:${
            renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment
              ? `attachment:${renderedRightPanelSurface.attachment.id}`
              : activeWorkspaceRoot
          }`}
          environmentId={activeThread.environmentId}
          cwd={activeWorkspaceRoot ?? ""}
          projectName={activeProject?.title ?? ""}
          threadRef={activeThreadRef}
          composerDraftTarget={composerDraftTarget}
          keybindings={keybindings}
          availableEditors={availableEditors}
          relativePath={
            renderedRightPanelSurface.kind === "file"
              ? renderedRightPanelSurface.relativePath
              : null
          }
          {...(renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment
            ? { attachment: renderedRightPanelSurface.attachment }
            : {})}
          revealLine={
            renderedRightPanelSurface.kind === "file"
              ? (renderedRightPanelSurface.revealLine ?? null)
              : null
          }
          revealRequestId={
            renderedRightPanelSurface.kind === "file"
              ? renderedRightPanelSurface.revealRequestId
              : 0
          }
          onOpenFile={openFileSurface}
          onPendingChange={handleFilePendingChange}
          selectedFilePending={
            renderedRightPanelSurface.kind === "file" &&
            pendingFileSurfaceIds.has(renderedRightPanelSurface.id)
          }
          workspaceMutationId={workspaceMutationId}
        />
      </Suspense>
    ) : null
  ) : null;

  const workspaceFileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: (files) => composerRef.current?.addDroppedFiles(files),
  });

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      {rightPanelControlsAtRoot ? panelLayoutControls : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-x-hidden",
          rightPanelMaximized ? "w-0 flex-none" : "flex-1",
        )}
        data-chat-column-maximized-away={rightPanelMaximized ? "true" : "false"}
      >
        {/* Top bar */}
        <WorkspacePageHeader
          data-chat-header
          electron={isElectron}
          reserveNativeControls={reserveTitleBarControlInset && !inlineRightPanelOwnsTitleBar}
          className="relative bg-background"
        >
          {isElectron && rightPanelControlsAtRoot ? (
            <span
              aria-hidden
              className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
            />
          ) : null}
          {!rightPanelControlsAtRoot && !rightPanelControlsInPanel ? panelLayoutControls : null}
          <ChatHeader
            {...(!supportsPullRequests || activeProjectRepository === null
              ? {}
              : { onOpenPullRequest: openProjectPullRequest })}
            activeThreadEnvironmentId={activeThread.environmentId}
            activeThreadId={activeThread.id}
            {...(routeKind === "draft" && draftId ? { draftId } : {})}
            activeThreadTitle={activeThread.title}
            activeThreadStartedBy={activeThread.startedBy ?? null}
            activeProjectId={activeProject?.id}
            isServerThread={isServerThread}
            activeProjectName={activeProject?.title}
            activeProjectCwd={activeProject?.workspaceRoot ?? null}
            activeProjectFaviconPath={activeProject?.faviconPath ?? null}
            activeProjectIcon={activeProject?.projectIcon ?? null}
            openInCwd={gitCwd}
            activeProjectScripts={activeProject?.scripts}
            preferredScriptId={
              activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
            }
            keybindings={keybindings}
            availableEditors={availableEditors}
            rightPanelOpen={rightPanelOpen}
            gitCwd={gitCwd}
            activeProjectTestEnvironments={
              activeProject ? (activeProject.testEnvironments ?? []) : undefined
            }
            onNewThreadInProject={handleNewThreadInActiveProject}
            {...(activeDraftLogicalProjectKey
              ? { onOpenProjectSettings: handleOpenDraftProjectSettings }
              : {})}
            onRunProjectScript={runProjectScript}
            onAddProjectScript={saveProjectScript}
            onUpdateProjectScript={updateProjectScript}
            onDeleteProjectScript={deleteProjectScript}
            onUpdateProjectTestEnvironments={saveProjectTestEnvironments}
            onOpenTestsPanel={openTestsPanel}
          />
        </WorkspacePageHeader>

        {/* Main content area with optional plan sidebar */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Chat column */}
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
            data-chat-workspace-drop-target="true"
            onDragEnter={workspaceFileDropHandlers.onDragEnter}
            onDragOver={workspaceFileDropHandlers.onDragOver}
            onDragLeave={workspaceFileDropHandlers.onDragLeave}
            onDrop={workspaceFileDropHandlers.onDrop}
          >
            {isWorkspaceFileDragActive ? (
              <div
                className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]"
                data-chat-workspace-drop-overlay="true"
              >
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
                >
                  <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
                  Drop files to attach
                </div>
              </div>
            ) : null}
            {/* Banners overlay the timeline without changing its content height. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col">
              <ProviderStatusBanner
                status={visibleProviderStatus}
                onDismiss={() => setDismissedProviderStatusBannerKey(providerStatusBannerKey)}
                onOpenProviderSetup={openProviderSetup}
              />
              <ThreadErrorBanner
                error={visibleThreadError}
                onDismiss={() => {
                  setThreadError(activeThread.id, null);
                  dismissThreadErrorBannerForSession(threadErrorBannerKey);
                  setThreadErrorBannerDismissTick((tick) => tick + 1);
                }}
              />
            </div>
            {/* Messages Wrapper */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Messages — LegendList handles virtualization and scrolling internally */}
              <MessagesTimeline
                citationRequest={citationRequest}
                citationHistoryLoading={threadDetailLoading}
                onCiteAssistantText={citeAssistantText}
                agentPanelModel={agentPanelModel}
                onOpenAgents={addAgentsSurface}
                key={activeThread.id}
                isWorking={isWorking}
                isPreparingWorktree={isPreparingWorktree}
                isCompacting={isCompacting}
                activeTurnStartedAt={activeWorkStartedAt}
                listRef={legendListRef}
                timelineEntries={timelineEntries}
                latestTurn={activeLatestTurn}
                runningTurnId={activeRunningTurnId}
                turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                activeThreadEnvironmentId={activeThread.environmentId}
                routeThreadKey={routeThreadKey}
                onOpenTurnDiff={onOpenTurnDiff}
                revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                onRevertUserMessage={onRevertUserMessage}
                onUseArtifactTemplate={useArtifactTemplate}
                isRevertingCheckpoint={isRevertingCheckpoint}
                onImageExpand={onExpandTimelineImage}
                onFileOpen={openFileAttachment}
                onFileDownload={downloadFileAttachment}
                markdownCwd={gitCwd ?? undefined}
                resolvedTheme={resolvedTheme}
                timestampFormat={timestampFormat}
                workspaceRoot={activeWorkspaceRoot}
                skills={
                  activeProviderStatus
                    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
                    : EMPTY_PROVIDER_SKILLS
                }
                anchorMessageId={timelineAnchorMessageId}
                onAnchorReady={onTimelineAnchorReady}
                contentInsetEndAdjustment={composerTimelineInset}
                liveFollowEnabled={timelineLiveFollowEnabled}
                onIsAtEndChange={onIsAtEndChange}
                onOpenTestsPanel={openTestsPanel}
                onToolOutputCollapsedAtEnd={onToolOutputCollapsedAtEnd}
                onManualNavigation={cancelTimelineLiveFollowForUserNavigation}
                hideEmptyPlaceholder={isDraftHeroState || threadDetailLoading}
                topFadeEnabled={!hasTimelineTopBanner}
                loadEarlier={loadEarlierTurns}
              />

              {/* scroll to end pill — shown when user has scrolled away from the live edge */}
              {showScrollToBottom && (
                <div
                  className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5"
                  style={{ bottom: scrollToEndClearance + 4 }}
                >
                  <Button
                    aria-label="Scroll to end"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      composerRef.current?.restoreAfterTimelineReachedEnd();
                      scrollToEnd(true);
                    }}
                    className="pointer-events-auto gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground"
                    size="xs"
                    variant="glass"
                  >
                    <ChevronDownIcon className="size-3.5" />
                    Scroll to end
                  </Button>
                </div>
              )}
            </div>

            {/* Input bar — centered hero while a draft has no messages, docked at the bottom otherwise */}
            <div
              ref={setComposerOverlayElement}
              data-chat-composer-overlay="true"
              className={
                isDraftHeroState
                  ? "pointer-events-none absolute inset-0 z-20 flex items-center"
                  : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
              }
            >
              <div
                ref={attachDraftHeroTransitionGroupRef}
                className="w-full ps-[calc(env(safe-area-inset-left)+0.75rem)] pe-[calc(env(safe-area-inset-right)+0.75rem)] sm:ps-[calc(env(safe-area-inset-left)+1.25rem)] sm:pe-[calc(env(safe-area-inset-right)+1.25rem)]"
              >
                <div className="group/composer-stack pointer-events-auto relative z-10">
                  {isDraftHeroState ? (
                    <div className="absolute inset-x-0 bottom-full z-0">
                      <div
                        className="pb-8 group-has-data-[composer-shoulder-tab]/composer-stack:pb-4"
                        style={
                          forceExpandedMobileComposer
                            ? {
                                viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
                              }
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
                  <QueuedMessagesPanel
                    items={queuedMessageItems}
                    onDelete={deleteQueuedMessage}
                    onEdit={updateQueuedMessage}
                  />
                  <div
                    className="relative"
                    style={
                      forceExpandedMobileComposer
                        ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                        : undefined
                    }
                  >
                    <ComposerSurface.Shell contextStrip={showComposerContextStrip}>
                      <ComposerSurface.Host>
                        <div ref={attachDraftHeroComposerAnchorRef} className="relative z-10">
                          <ChatComposer
                            composerRef={composerRef}
                            composerDraftTarget={composerDraftTarget}
                            environmentId={environmentId}
                            attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                            supportsAttachmentUploads={supportsAttachmentUploads}
                            maxFileAttachmentBytes={maxFileAttachmentBytes}
                            supportsSpeechTranscription={supportsSpeechTranscription}
                            routeKind={routeKind}
                            routeThreadRef={routeThreadRef}
                            draftId={draftId}
                            activeThreadId={activeThreadId}
                            activeThreadEnvironmentId={activeThread?.environmentId}
                            activeThread={activeThread}
                            promptHistoryMessages={timelineMessages}
                            isServerThread={isServerThread}
                            isLocalDraftThread={isLocalDraftThread}
                            forceExpandedOnMobile={forceExpandedMobileComposer && isDraftHeroState}
                            projectSelectionRequired={isLocalDraftThread && activeProject === null}
                            phase={phase}
                            isConnecting={isConnecting}
                            isSendBusy={isSendBusy}
                            sendDisabledReason={
                              feedbackUploading
                                ? "Sending feedback"
                                : threadDetailLoading
                                  ? "Messages loading"
                                  : null
                            }
                            isPreparingWorktree={isPreparingWorktree}
                            bannerItems={composerBannerItems}
                            environmentUnavailable={activeEnvironmentUnavailableState}
                            activePendingApproval={activePendingApproval}
                            pendingApprovals={pendingApprovals}
                            pendingUserInputs={pendingUserInputs}
                            activePendingProgress={activePendingProgress}
                            activePendingResolvedAnswers={activePendingResolvedAnswers}
                            activePendingIsResponding={activePendingIsResponding}
                            activePendingDraftAnswers={activePendingDraftAnswers}
                            activePendingQuestionIndex={activePendingQuestionIndex}
                            respondingRequestIds={respondingRequestIds}
                            showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                            activeProposedPlan={activeProposedPlan}
                            activePlan={activePlan as { turnId?: TurnId } | null}
                            sidebarProposedPlan={sidebarProposedPlan as { turnId?: TurnId } | null}
                            planSidebarLabel={planSidebarLabel}
                            planSidebarOpen={planSidebarOpen}
                            activeTasksProgress={activeComposerTasksProgress}
                            activeTaskSteps={activeComposerTaskSteps}
                            threadSyncPhase={activeEnvironmentUnavailable ? null : threadSyncPhase}
                            runtimeMode={runtimeMode}
                            interactionMode={interactionMode}
                            lockedProvider={lockedProvider}
                            providerStatuses={providerStatuses as ServerProvider[]}
                            activeProjectDefaultModelSelection={
                              activeProject?.defaultModelSelection
                            }
                            activeThreadModelSelection={activeThread?.modelSelection}
                            activeContextWindow={activeContextWindow}
                            compactThreadUnavailable={compactThreadUnavailable}
                            compactDisabled={compactDisabled}
                            compactDisabledReason={compactDisabledReason}
                            resolvedTheme={resolvedTheme}
                            settings={settings}
                            keybindings={keybindings}
                            terminalOpen={Boolean(terminalUiState.terminalOpen)}
                            gitCwd={gitCwd}
                            restingControlsHost={restingComposerControlsHost}
                            restingControlsHaveLeadingContext={
                              isGitRepo || showComposerEnvironmentIndicator
                            }
                            onRestingControlsVisibilityChange={setRestingComposerControlsVisible}
                            getTimelineScrollableNode={getTimelineScrollableNode}
                            isTimelineAtLogicalEnd={isTimelineAtLogicalEnd}
                            onComposerOverlayHeightChange={publishComposerOverlayHeight}
                            onRestingChange={onComposerRestingChange}
                            promptRef={promptRef}
                            composerImagesRef={composerImagesRef}
                            composerFilesRef={composerFilesRef}
                            composerTerminalContextsRef={composerTerminalContextsRef}
                            composerElementContextsRef={composerElementContextsRef}
                            onPageScrollKeyDown={onComposerPageScrollKeyDown}
                            onPageScrollKeyUp={onComposerPageScrollKeyUp}
                            onPageScrollRelease={onComposerPageScrollRelease}
                            onSend={onSend}
                            onInterrupt={onInterrupt}
                            onImplementPlanInNewThread={onImplementPlanInNewThread}
                            onRespondToApproval={onRespondToApproval}
                            onSelectActivePendingUserInputOption={
                              onSelectActivePendingUserInputOption
                            }
                            onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
                            onPreviousActivePendingUserInputQuestion={
                              onPreviousActivePendingUserInputQuestion
                            }
                            onChangeActivePendingUserInputCustomAnswer={
                              onChangeActivePendingUserInputCustomAnswer
                            }
                            onProviderModelSelect={onProviderModelSelect}
                            onOpenProviderSetup={openProviderSetup}
                            getModelDisabledReason={getModelDisabledReason}
                            toggleInteractionMode={toggleInteractionMode}
                            handleRuntimeModeChange={handleRuntimeModeChange}
                            handleInteractionModeChange={handleInteractionModeChange}
                            togglePlanSidebar={togglePlanSidebar}
                            focusComposer={focusComposer}
                            scheduleComposerFocus={scheduleComposerFocus}
                            setThreadError={setThreadError}
                            onExpandImage={onExpandTimelineImage}
                            onFileOpen={openFileAttachment}
                          />
                        </div>
                      </ComposerSurface.Host>
                      <div className="min-h-0">
                        <div
                          data-terminal-open={terminalUiState.terminalOpen ? "true" : undefined}
                          className="relative z-0"
                        >
                          {mountComposerContextStrip && (
                            <div className="pointer-events-auto">
                              <BranchToolbar
                                environmentId={activeThread.environmentId}
                                threadId={activeThread.id}
                                showGitControls={isGitRepo}
                                {...(routeKind === "draft" && draftId ? { draftId } : {})}
                                onEnvModeChange={onEnvModeChange}
                                startFromOrigin={startFromOrigin}
                                onStartFromOriginChange={onStartFromOriginChange}
                                {...(canOverrideServerThreadEnvMode
                                  ? { effectiveEnvModeOverride: envMode }
                                  : {})}
                                {...(canOverrideServerThreadEnvMode
                                  ? {
                                      activeThreadBranchOverride: activeThreadBranch,
                                      onActiveThreadBranchOverrideChange:
                                        setPendingServerThreadBranch,
                                    }
                                  : {})}
                                envLocked={envLocked}
                                onComposerFocusRequest={scheduleComposerFocus}
                                {...(canCheckoutPullRequestIntoThread
                                  ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                                  : {})}
                                {...(hasMultipleEnvironments ? { onEnvironmentChange } : {})}
                                availableEnvironments={logicalProjectEnvironments}
                                composerControlsHostRef={setRestingComposerControlsHost}
                                contextStripVisible={showComposerContextStrip}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </ComposerSurface.Shell>
                    <div
                      aria-hidden
                      className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {activeThreadRef && activePreviewMiniPlayer && previewMiniPlayerVisible ? (
              <ThreadPreviewMiniPlayer
                key={`${activeThreadKey}:${activePreviewMiniPlayer.tabId}`}
                threadRef={activeThreadRef}
                tabId={activePreviewMiniPlayer.tabId}
                bottomInset={isDraftHeroState ? 0 : composerOverlayHeight}
              />
            ) : null}

            <AlertDialog open={branchRestoreConfirmOpen} onOpenChange={setBranchRestoreConfirmOpen}>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Switch to{" "}
                    <code className="font-medium">
                      {localCheckoutBranchMismatch?.threadBranch ?? ""}
                    </code>
                    ?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    You have uncommitted changes. They'll carry over to the other branch, or block
                    the switch if they conflict.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                  <Button
                    variant="default"
                    onClick={() => {
                      setBranchRestoreConfirmOpen(false);
                      void handleSwitchCheckoutToThread();
                    }}
                  >
                    Switch branch
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>

            {pullRequestDialogState ? (
              <PullRequestThreadDialog
                key={pullRequestDialogState.key}
                open
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                cwd={activeProject?.workspaceRoot ?? null}
                initialReference={pullRequestDialogState.initialReference}
                onOpenChange={(open) => {
                  if (!open) {
                    closePullRequestDialog();
                  }
                }}
                onPrepared={handlePreparedPullRequestThread}
              />
            ) : null}
          </div>
          {/* end chat column */}
        </div>
        {/* end horizontal flex container */}

        {mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
          <PersistentThreadTerminalDrawer
            key={mountedThreadKey}
            threadRef={mountedThreadRef}
            threadId={mountedThreadRef.threadId}
            active={mountedThreadKey === activeThreadKey}
            launchContext={
              mountedThreadKey === activeThreadKey ? (activeTerminalLaunchContext ?? null) : null
            }
            focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraft}
          />
        ))}
      </div>

      {rightPanelPresent && !shouldUseRightPanelSheet && activeThreadRef ? (
        <RightPanelTabs
          mode="inline"
          open={rightPanelOpen}
          maximized={rightPanelMaximized}
          surfaces={renderedRightPanelSurfaces}
          environmentId={activeThreadRef.environmentId}
          activeSurfaceId={renderedRightPanelSurface?.id ?? null}
          pendingSurfaceIds={pendingFileSurfaceIds}
          previewSessions={activePreviewState.sessions}
          desktopByTabId={activePreviewState.desktopByTabId}
          previewRuntimeTabId={resolvePreviewRuntimeTabId}
          terminalLabelsById={activeTerminalLabelsById}
          onActivate={activateRightPanelSurface}
          onCloseSurface={closeRightPanelSurface}
          onCloseOtherSurfaces={closeOtherRightPanelSurfaces}
          onCloseSurfacesToRight={closeRightPanelSurfacesToRight}
          onCloseAllSurfaces={closeAllRightPanelSurfaces}
          onCopyFilePath={copyRightPanelFilePath}
          onAddBrowser={() => createBrowserSurface()}
          onAddBrowserInProfile={createBrowserSurface}
          onAddTerminal={addTerminalSurface}
          onAddDiff={addDiffSurface}
          onAddFiles={addFilesSurface}
          onAddMedia={openMediaPanel}
          onAddTests={openTestsPanel}
          onAddPullRequest={addPullRequestSurface}
          onAddAgents={addAgentsSurface}
          browserAvailable={browserAvailable}
          terminalAvailable={activeProject !== null}
          diffAvailable={isServerThread && isGitRepo}
          filesAvailable={activeProject !== null}
          testsAvailable={Boolean(activeProject?.workspaceRoot)}
          pullRequestAvailable={pullRequestSurfaceAvailable}
          agentsAvailable
          liveAgentCount={agentPanelModel.liveCount}
        >
          {rightPanelContent}
        </RightPanelTabs>
      ) : null}
      {rightPanelPresent && shouldUseRightPanelSheet && activeThreadRef ? (
        <RightPanelSheet
          animationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
          open={rightPanelOpen}
          underFloatingPreview={previewMiniPlayerVisible}
          onClose={closePreviewPanel}
        >
          <RightPanelTabs
            mode="sheet"
            // Same effective inset as the closed-state titlebar controls
            // (pr-3 in the tab bar plus this pixel equals the absolute
            // right inset plus mr-px), so the cluster does not creep when
            // the sheet opens.
            layoutControls={
              rightPanelOpen ? (
                <div className="mr-px flex items-center">{panelToggleControls}</div>
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
            onActivate={activateRightPanelSurface}
            onCloseSurface={closeRightPanelSurface}
            onCloseOtherSurfaces={closeOtherRightPanelSurfaces}
            onCloseSurfacesToRight={closeRightPanelSurfacesToRight}
            onCloseAllSurfaces={closeAllRightPanelSurfaces}
            onCopyFilePath={copyRightPanelFilePath}
            onAddBrowser={() => createBrowserSurface()}
            onAddBrowserInProfile={createBrowserSurface}
            onAddTerminal={addTerminalSurface}
            onAddDiff={addDiffSurface}
            onAddFiles={addFilesSurface}
            onAddMedia={openMediaPanel}
            onAddTests={openTestsPanel}
            onAddPullRequest={addPullRequestSurface}
            onAddAgents={addAgentsSurface}
            browserAvailable={browserAvailable}
            terminalAvailable={activeProject !== null}
            diffAvailable={isServerThread && isGitRepo}
            filesAvailable={activeProject !== null}
            testsAvailable={Boolean(activeProject?.workspaceRoot)}
            pullRequestAvailable={pullRequestSurfaceAvailable}
            agentsAvailable
            liveAgentCount={agentPanelModel.liveCount}
          >
            {rightPanelContent}
          </RightPanelTabs>
        </RightPanelSheet>
      ) : null}

      {expandedImage && (
        <ExpandedImageDialog
          key={expandedImageKey(expandedImage)}
          preview={expandedImage}
          onClose={closeExpandedImage}
        />
      )}
    </div>
  );
}
