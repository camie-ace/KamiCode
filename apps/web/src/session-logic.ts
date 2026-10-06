import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import {
  type AssetResource,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type PlanId,
  type RunId,
  type ToolActivitySurface,
  type ToolActivityIcon,
  type ToolActivitySource,
} from "@t3tools/contracts";
import { extractToolActivityPresentation } from "@t3tools/client-runtime/work-log/tool-presentation";
import {
  classifyToolActivity,
  collectToolFilePaths,
  formatReadToolLabel,
  formatSearchToolLabel,
} from "@t3tools/shared/toolActivity";
import {
  contextCompactionLabel,
  workEntryIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeHasInterruptibleRun } from "@t3tools/client-runtime/state/thread-execution";
import { turnItemIsWorkspacePreparation } from "@t3tools/client-runtime/state/turn-item-presentation";

import {
  isImageAttachment,
  type ChatAttachment,
  type ChatMessage,
  type ProposedPlan,
  type SessionPhase,
  type TurnDiffSummary,
} from "./types";
import * as DateTime from "effect/DateTime";
import * as Equal from "effect/Equal";
import { shallow } from "zustand/vanilla/shallow";

export { formatDuration } from "@t3tools/shared/orchestrationTiming";
export {
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";

export type WorkLogToolLifecycleStatus =
  | "idle"
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "stopped";

export interface WorkLogEntry {
  readonly evidenceRun?: EvidenceRunWorkEntry;
  readonly projectTrigger?: ProjectTriggerWorkEntry;
  readonly questionAnswer?: import("@t3tools/contracts").UserInputAttachmentAnswerPayload;
  readonly id: string;
  readonly createdAt: string;
  readonly runId?: RunId | null;
  readonly label: string;
  readonly detail?: string;
  readonly command?: string;
  readonly rawCommand?: string;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly tone: "thinking" | "tool" | "info" | "error";
  readonly toolTitle?: string;
  readonly toolCallId?: string;
  readonly viewedImagePath?: string;
  readonly toolSurface?: ToolActivitySurface;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
  readonly sourceActivityKind?: string;
  readonly taskId?: string;
  readonly agentRole?: string;
  readonly toolData?: unknown;
  readonly requestKind?: string;
  readonly itemType?: OrchestrationV2TurnItem["type"];
  readonly toolLifecycleStatus?: WorkLogToolLifecycleStatus;
  readonly structuredPayload?: OrchestrationV2TurnItem;
  readonly sourceItemType?: OrchestrationV2TurnItem["type"];
  readonly projectedItem?: OrchestrationV2ProjectedTurnItem;
}

export type PendingApproval = ThreadPendingApproval;
export type PendingUserInput = ThreadPendingUserInput;

export interface ActivePlanState {
  readonly createdAt: string;
  readonly runId: RunId | null;
  readonly explanation?: string | null;
  readonly steps: Array<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
    readonly durationMs?: number;
  }>;
}

export interface LatestProposedPlanState {
  readonly id: PlanId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId: RunId | null;
  readonly planMarkdown: string;
  readonly status: OrchestrationV2PlanArtifact["status"];
}

export type TimelineAttempt = Pick<
  OrchestrationV2RunAttempt,
  "id" | "runId" | "attemptOrdinal" | "rootNodeId" | "status"
>;

export type TimelineEntry = (
  | {
      readonly id: string;
      readonly kind: "message";
      readonly createdAt: string;
      readonly message: ChatMessage;
      readonly projectedItem?: OrchestrationV2ProjectedTurnItem;
    }
  | {
      readonly id: string;
      readonly kind: "proposed-plan";
      readonly createdAt: string;
      readonly proposedPlan: ProposedPlan;
    }
  | {
      readonly id: string;
      readonly kind: "work";
      readonly createdAt: string;
      readonly entry: WorkLogEntry;
    }
  | {
      readonly id: string;
      readonly kind: "event";
      readonly createdAt: string;
      readonly projectedItem: OrchestrationV2ProjectedTurnItem;
    }
) & {
  /** V2 identity resolved from the item's execution node, when locally available. */
  readonly attempt?: TimelineAttempt;
};

export function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  return (
    entry.tone === "tool" ||
    entry.tone === "thinking" ||
    entry.tone === "error" ||
    entry.command !== undefined ||
    entry.requestKind !== undefined
  );
}

/** Severe failures keep the red treatment ordinary tool failures lost: provider
 *  runtime errors mean the turn or a core side effect broke, not that a
 *  command exited nonzero. */
export function workEntrySignalsSevereFailure(entry: WorkLogEntry): boolean {
  return entry.itemType === "error";
}

export function workEntryIndicatesToolSuccess(entry: WorkLogEntry): boolean {
  if (
    !workLogEntryIsToolLike(entry) ||
    workEntryIndicatesToolFailure(entry) ||
    (entry.tone === "thinking" && entry.itemType !== "reasoning")
  ) {
    return false;
  }
  const status = entry.toolLifecycleStatus;
  return (
    status !== "failed" &&
    status !== "declined" &&
    status !== "inProgress" &&
    status !== "stopped" &&
    status !== "idle"
  );
}

/** Tool-like row with neither clear success nor failure (empty, incomplete, in progress, etc.). */
export function workEntryIndicatesToolNeutralStatus(entry: WorkLogEntry): boolean {
  return (
    workLogEntryIsToolLike(entry) &&
    !workEntryIndicatesToolFailure(entry) &&
    !workEntryIndicatesToolSuccess(entry)
  );
}

export function isLatestRunSettled(
  latestRun: Pick<ThreadRunSummary, "runId" | "startedAt" | "completedAt" | "status"> | null,
  runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId"> | null,
): boolean {
  if (latestRun === null) return false;
  if (
    latestRun.status === "preparing" ||
    latestRun.status === "queued" ||
    latestRun.status === "starting" ||
    latestRun.status === "running" ||
    latestRun.status === "waiting"
  )
    return false;
  return runtime?.activeRunId !== latestRun.runId;
}

export function deriveActiveWorkStartedAt(
  latestRun: Pick<
    ThreadRunSummary,
    "runId" | "startedAt" | "requestedAt" | "completedAt" | "status"
  > | null,
  runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId" | "activityStartedAt"> | null,
  sendStartedAt: string | null,
): string | null {
  const startedAt = resolveThreadWorkingStartedAt({ latestRun, runtime });
  // Local dispatch has a clock only until the server supplies the owning run.
  return startedAt ?? (runtime?.activeRunId == null ? sendStartedAt : null);
}

export function derivePendingApprovals(
  approvals: ReadonlyArray<ThreadPendingApproval>,
): ThreadPendingApproval[] {
  return [...approvals].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function derivePendingUserInputs(
  inputs: ReadonlyArray<ThreadPendingUserInput>,
): ThreadPendingUserInput[] {
  return [...inputs].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function deriveActivePlanState(
  projection: OrchestrationV2ThreadProjection | null,
  latestRunId: RunId | undefined,
): ActivePlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "todo_list");
  const plan =
    [...plans].toReversed().find((candidate) => candidate.runId === latestRunId) ??
    plans.at(-1) ??
    null;
  if (plan === null || plan.steps.length === 0) return null;
  return {
    createdAt: planItemTime(projection, plan.id),
    runId: plan.runId,
    explanation: plan.explanation ?? null,
    steps: plan.steps.map(({ text, status, durationMs }) => ({
      step: text,
      status: status === "running" ? "inProgress" : status,
      ...(durationMs === undefined ? {} : { durationMs }),
    })),
  };
}

function planItemTime(projection: OrchestrationV2ThreadProjection, planId: PlanId): string {
  const item = projection.turnItems.findLast(
    (candidate) =>
      (candidate.type === "proposed_plan" || candidate.type === "todo_list") &&
      candidate.planId === planId,
  );
  return DateTime.formatIso(item?.updatedAt ?? projection.updatedAt);
}

function toLatestProposedPlanState(
  projection: OrchestrationV2ThreadProjection,
  plan: Extract<OrchestrationV2PlanArtifact, { readonly kind: "proposed_plan" }>,
): LatestProposedPlanState {
  const updatedAt = planItemTime(projection, plan.id);
  return {
    id: plan.id,
    createdAt: updatedAt,
    updatedAt,
    runId: plan.runId,
    planMarkdown: plan.markdown,
    status: plan.status,
  };
}

export function findLatestProposedPlan(
  projection: OrchestrationV2ThreadProjection | null,
  latestRunId: RunId | string | null | undefined,
): LatestProposedPlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "proposed_plan");
  const candidates = latestRunId ? plans.filter((plan) => plan.runId === latestRunId) : plans;
  const plan = [...(candidates.length > 0 ? candidates : plans)]
    .toSorted(
      (left, right) =>
        planItemTime(projection, left.id).localeCompare(planItemTime(projection, right.id)) ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  return plan === undefined ? null : toLatestProposedPlanState(projection, plan);
}

export function hasActionableProposedPlan(plan: LatestProposedPlanState | null): boolean {
  return plan?.status === "active";
}

const STANDALONE_V2_ITEM_TYPES = new Set<OrchestrationV2ProjectedTurnItem["item"]["type"]>([
  "fork",
  "handoff",
  "run_interrupt_request",
  "run_interrupt_result",
  "subagent",
]);

const PERSISTENT_RESOURCE_V2_ITEM_TYPES = new Set<OrchestrationV2TurnItem["type"]>([
  "fork",
  "thread_created",
]);

export function timelineEntryIsPersistentResourceCard(entry: TimelineEntry): boolean {
  return (
    entry.kind === "event" && PERSISTENT_RESOURCE_V2_ITEM_TYPES.has(entry.projectedItem.item.type)
  );
}

function projectedItemCreatedAt(row: OrchestrationV2ProjectedTurnItem): string {
  return DateTime.formatIso(row.item.startedAt ?? row.item.updatedAt);
}

function projectedWorkEntryStatus(
  item: OrchestrationV2TurnItem,
): NonNullable<WorkLogEntry["toolLifecycleStatus"]> {
  switch (item.status) {
    case "pending":
    case "running":
    case "waiting":
      return "inProgress";
    case "completed":
      return "completed";
    case "idle":
      return "idle";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
  }
}

function projectedWorkEntryTone(item: OrchestrationV2TurnItem): WorkLogEntry["tone"] {
  if (item.type === "error") return "info";
  if (item.type === "reasoning") return "thinking";
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "file_search":
    case "web_search":
    case "dynamic_tool":
    case "subagent":
    case "thread_created":
    case "user_input_request":
    case "approval_request":
      return "tool";
    default:
      return "info";
  }
}

export function providerErrorPresentation(
  item: Extract<OrchestrationV2TurnItem, { readonly type: "error" }>,
): { readonly label: string; readonly detail: string } {
  if (item.retry === undefined) {
    return {
      label:
        item.failure.class === "usage_limit"
          ? "Usage limit reached"
          : item.title?.trim() || "Provider error",
      detail: item.failure.message,
    };
  }
  const progress =
    item.retry.maxAttempts === null
      ? `${item.retry.attempt}`
      : `${item.retry.attempt}/${item.retry.maxAttempts}`;
  const label =
    item.status === "running"
      ? `Retrying provider (${progress})`
      : item.status === "completed"
        ? `Provider recovered (${progress} retries)`
        : item.status === "failed"
          ? `${item.failure.class === "usage_limit" ? "Usage limit reached" : "Provider error"} after ${progress} retries`
          : `Provider retry stopped (${progress})`;
  const retryDelay =
    item.status === "running" && item.retry.retryDelayMs !== null && item.retry.retryDelayMs > 0
      ? item.retry.retryDelayMs < 1_000
        ? ` Retrying in ${item.retry.retryDelayMs}ms.`
        : ` Retrying in ${(item.retry.retryDelayMs / 1_000).toFixed(1).replace(/\.0$/u, "")}s.`
      : "";
  return {
    label,
    detail: `${item.failure.message}${retryDelay}`,
  };
}

function projectedWorkEntry(row: OrchestrationV2ProjectedTurnItem): WorkLogEntry {
  const { item } = row;
  const title = item.title?.trim() || null;
  const common = {
    id: item.id,
    createdAt: projectedItemCreatedAt(row),
    runId: item.runId,
    tone: projectedWorkEntryTone(item),
    itemType: item.type,
    toolLifecycleStatus: projectedWorkEntryStatus(item),
    structuredPayload: item,
    projectedItem: row,
    ...extractToolActivityPresentation(item),
  } as const;

  switch (item.type) {
    case "kami_activity": {
      const payload = asRecord(item.activity.payload);
      const evidenceRun = extractEvidenceRun(payload);
      const projectTrigger = extractProjectTriggerWorkEntry(payload);
      return {
        ...common,
        tone: item.activity.tone === "approval" ? "tool" : item.activity.tone,
        label: item.activity.summary,
        sourceActivityKind: item.activity.kind,
        toolData: item.activity.payload,
        ...(evidenceRun === null ? {} : { evidenceRun }),
        ...(projectTrigger === null ? {} : { projectTrigger }),
      };
    }
    case "thread_created":
      return {
        ...common,
        label: "Created thread",
      };
    case "compaction":
      return {
        ...common,
        label: contextCompactionLabel(item),
        sourceActivityKind: "context-compaction",
        ...(item.summary ? { detail: item.summary } : {}),
      };
    case "reasoning":
      return {
        ...common,
        label: title ?? "Thinking",
        ...(item.text ? { detail: item.text } : {}),
      };
    case "command_execution":
      return {
        ...common,
        label: title ?? "Ran command",
        command: item.input,
        rawCommand: item.input,
        toolTitle: title ?? "Command",
        toolData: item,
      };
    case "file_change": {
      return {
        ...common,
        label:
          title ??
          (item.changes !== undefined && item.changes.length > 1
            ? `Changed ${item.changes.length} files`
            : `Changed ${item.fileName}`),
        changedFiles: item.changes?.map((change) => change.path) ?? [item.fileName],
        toolTitle: title ?? "File change",
        toolData: item,
      };
    }
    case "file_search":
      return {
        ...common,
        label: title ?? formatSearchToolLabel(item) ?? "Searched files",
        ...(item.pattern ? { detail: item.pattern } : {}),
        toolTitle: title ?? "File search",
        toolData: item,
      };
    case "web_search":
      return {
        ...common,
        label: title ?? "Searched the web",
        ...(item.patterns?.length ? { detail: item.patterns.join(", ") } : {}),
        toolTitle: title ?? "Web search",
        toolData: item,
      };
    case "checkpoint":
      return {
        ...common,
        label: title ?? "Checkpoint captured",
        changedFiles: item.files.map((file) => file.path),
        toolData: item,
      };
    case "system_notice":
      return {
        ...common,
        label: item.message,
        sourceActivityKind: "runtime.warning",
      };
    case "error": {
      const presentation = providerErrorPresentation(item);
      return {
        ...common,
        ...presentation,
        ...(item.failure.class === "usage_limit" && item.status !== "completed"
          ? { sourceActivityKind: "runtime.warning" }
          : item.retry === undefined
            ? { sourceActivityKind: "runtime.error" }
            : {}),
        toolData: item,
      };
    }
    case "dynamic_tool": {
      const payload = { data: { toolName: item.toolName, input: item.input, result: item.output } };
      const evidenceRun = extractEvidenceRun(payload);
      const projectTrigger = extractProjectTriggerWorkEntry(payload);
      const classified = classifyToolActivity({
        itemType: "dynamic_tool_call",
        data: { toolName: item.toolName ?? undefined, input: item.input },
      });
      const [readPath] = collectToolFilePaths({ input: item.input });
      return {
        ...common,
        label:
          title ??
          (classified === "read"
            ? formatReadToolLabel(readPath ?? "")
            : classified === "search"
              ? (formatSearchToolLabel({ input: item.input }) ?? item.toolName ?? "Tool call")
              : (item.toolName ?? "Tool call")),
        toolTitle: title ?? item.toolName ?? "Tool",
        toolData: { input: item.input, output: item.output },
        ...(evidenceRun === null ? {} : { evidenceRun }),
        ...(projectTrigger === null ? {} : { projectTrigger }),
      };
    }
    case "approval_request":
      return {
        ...common,
        label: title ?? "Approval requested",
        detail: item.prompt ?? item.requestKind,
        toolData: item,
      };
    case "user_input_request":
      return {
        ...common,
        label: title ?? (item.questionAnswer ? "Answered questions" : "Input requested"),
        ...(item.questionAnswer ? { questionAnswer: item.questionAnswer } : {}),
        toolData: item,
      };
    default:
      return {
        ...common,
        label: title ?? item.type.replaceAll("_", " "),
        toolData: item,
      };
  }
}

/**
 * Builds the web timeline in the exact order committed by `visibleTurnItems`.
 * Committed rows are presented directly from their projected item. Queued
 * input is absent by construction until dispatch creates its user turn item.
 * Persistent client-owned messages are inserted by timestamp without sorting
 * the canonical sequence. True optimistic sends remain appended afterward.
 */
export interface TimelineEntriesInput {
  readonly visibleTurnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly optimisticMessages: ReadonlyArray<ChatMessage>;
  readonly anchoredMessages?: ReadonlyArray<ChatMessage>;
  readonly attachmentUrlById?: ReadonlyMap<string, string>;
  readonly attempts?: ReadonlyArray<OrchestrationV2RunAttempt>;
  readonly nodes?: ReadonlyArray<OrchestrationV2ExecutionNode>;
  readonly plans?: ReadonlyArray<OrchestrationV2PlanArtifact>;
}

export interface TimelineEntriesProjection {
  readonly input: TimelineEntriesInput;
  readonly entries: TimelineEntry[];
}

export function deriveTimelineEntriesFromVisibleTurnItems(
  input: TimelineEntriesInput,
): TimelineEntry[] {
  const committedMessageIds = new Set<string>();
  const entries: TimelineEntry[] = [];
  const attemptByRootNodeId = new Map(
    (input.attempts ?? []).map((attempt) => [attempt.rootNodeId, attempt] as const),
  );
  const nodeById = new Map((input.nodes ?? []).map((node) => [node.id, node] as const));
  const planById = new Map((input.plans ?? []).map((plan) => [plan.id, plan] as const));

  const resolveAttempt = (item: OrchestrationV2TurnItem): TimelineAttempt | undefined => {
    if (item.nodeId === null || item.runId === null) return undefined;
    let nodeId: OrchestrationV2ExecutionNode["id"] | null = item.nodeId;
    const visited = new Set<OrchestrationV2ExecutionNode["id"]>();
    while (nodeId !== null && !visited.has(nodeId)) {
      visited.add(nodeId);
      const directAttempt = attemptByRootNodeId.get(nodeId);
      if (directAttempt?.runId === item.runId) return directAttempt;
      const node = nodeById.get(nodeId);
      if (node === undefined) return undefined;
      const rootAttempt = attemptByRootNodeId.get(node.rootNodeId);
      if (rootAttempt?.runId === item.runId) return rootAttempt;
      nodeId = node.parentNodeId;
    }
    return undefined;
  };

  const foldedAnswerMessageIds = new Set(
    input.visibleTurnItems.flatMap(({ item }) =>
      item.type === "user_input_request" && item.questionAnswer
        ? [`async-answer:${item.questionAnswer.requestId}`]
        : [],
    ),
  );
  for (const row of input.visibleTurnItems) {
    const { item } = row;
    if (turnItemIsWorkspacePreparation(item)) continue;
    // Task progress belongs in the composer, not between conversation entries.
    if (item.type === "todo_list" || item.type === "checkpoint") continue;
    if (item.type === "user_message" && foldedAnswerMessageIds.has(item.messageId)) continue;
    const createdAt = projectedItemCreatedAt(row);
    const attempt = resolveAttempt(item);
    const attemptMetadata = attempt === undefined ? {} : { attempt };
    if (item.type === "notification") {
      entries.push({
        id: item.id,
        kind: "work",
        createdAt,
        entry: {
          id: item.id,
          createdAt,
          runId: item.runId,
          label: item.summary,
          tone: "info",
          itemType: item.type,
          structuredPayload: item,
          projectedItem: row,
        },
        ...attemptMetadata,
      });
      continue;
    }
    if (item.type === "user_message" || item.type === "assistant_message") {
      const message: ChatMessage = {
        id: item.messageId,
        role: item.type === "user_message" ? "user" : "assistant",
        text: item.text,
        ...(item.type === "user_message" && item.context ? { context: item.context } : {}),
        ...((item.attachments?.length ?? 0) > 0
          ? {
              attachments: (item.attachments ?? []).map((attachment) => {
                const previewUrl = input.attachmentUrlById?.get(attachment.id);
                return previewUrl ? { ...attachment, previewUrl } : attachment;
              }),
            }
          : {}),
        runId: item.runId,
        streaming: item.type === "assistant_message" && item.streaming,
        ...(item.type === "user_message"
          ? {
              createdBy: item.createdBy,
              creationSource: item.creationSource,
              ...(item.senderThreadId !== undefined ? { senderThreadId: item.senderThreadId } : {}),
              ...(item.scheduledTaskId !== undefined
                ? { scheduledTaskId: item.scheduledTaskId }
                : {}),
            }
          : {}),
        createdAt,
        updatedAt: DateTime.formatIso(item.updatedAt),
        ...(item.type === "user_message" ? { inputIntent: item.inputIntent } : {}),
      };
      committedMessageIds.add(message.id);
      entries.push({
        id: message.id,
        kind: "message",
        createdAt,
        message,
        projectedItem: row,
        ...attemptMetadata,
      });
      continue;
    }

    if (item.type === "proposed_plan") {
      const plan = planById.get(item.planId);
      const proposedPlan = {
        id: item.planId,
        runId: item.runId,
        planMarkdown: item.markdown,
        status: plan?.kind === "proposed_plan" ? plan.status : ("active" as const),
        createdAt,
        updatedAt: DateTime.formatIso(item.updatedAt),
      };
      entries.push({
        id: item.id,
        kind: "proposed-plan",
        createdAt,
        proposedPlan,
        ...attemptMetadata,
      });
      continue;
    }

    if (STANDALONE_V2_ITEM_TYPES.has(item.type)) {
      entries.push({
        id: item.id,
        kind: "event",
        createdAt,
        projectedItem: row,
        ...attemptMetadata,
      });
      continue;
    }

    entries.push({
      id: item.id,
      kind: "work",
      createdAt,
      entry: projectedWorkEntry(row),
      ...attemptMetadata,
    });
  }

  const retainedMessageIds = new Set([...committedMessageIds, ...foldedAnswerMessageIds]);
  for (const message of input.anchoredMessages ?? []) {
    if (retainedMessageIds.has(message.id)) continue;
    retainedMessageIds.add(message.id);
    const entry: TimelineEntry = {
      id: message.id,
      kind: "message",
      createdAt: message.createdAt,
      message,
    };
    const insertionIndex = entries.findIndex(
      (candidate) => candidate.createdAt > message.createdAt,
    );
    if (insertionIndex === -1) {
      entries.push(entry);
    } else {
      entries.splice(insertionIndex, 0, entry);
    }
  }

  for (const message of input.optimisticMessages) {
    if (message.inputIntent !== "queued_turn" && !retainedMessageIds.has(message.id)) {
      retainedMessageIds.add(message.id);
      entries.push({
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      });
    }
  }

  return entries;
}

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;
const EMPTY_IMAGE_RESOURCES = Object.freeze<ReadonlyArray<AttachmentResource>>([]);

/** A mounted row requests its stored images. Local previews keep their existing URLs. */
export function selectMessageImageResources(
  attachments: ChatMessage["attachments"],
): ReadonlyArray<AttachmentResource> {
  const attachmentIds = new Set<string>();
  for (const attachment of attachments ?? []) {
    if (!isImageAttachment(attachment)) continue;
    const previewUrl = attachment.previewUrl;
    if (previewUrl?.startsWith("blob:") || previewUrl?.startsWith("data:")) continue;
    attachmentIds.add(attachment.id);
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => ({ _tag: "attachment", attachmentId }));
}

/** Handoffs need server URLs even while their message rows are unmounted. */
export function selectHandoffImageResources(
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "role" | "attachments">> | undefined,
  handoffs: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<AttachmentResource> {
  if (Object.keys(handoffs).length === 0) return EMPTY_IMAGE_RESOURCES;
  const attachmentIds = new Set<string>();
  for (const message of messages ?? []) {
    if (message.role !== "user" || !handoffs[message.id]?.length) continue;
    for (const attachment of message.attachments ?? []) {
      if (isImageAttachment(attachment)) attachmentIds.add(attachment.id);
    }
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => ({ _tag: "attachment", attachmentId }));
}

/** Own one mapper per preview stage. Immutable messages retain unchanged preview objects. */
export function createMessageAttachmentPreviewProjector() {
  const attachmentsBySource = new WeakMap<
    ReadonlyArray<ChatAttachment>,
    ReadonlyArray<ChatAttachment>
  >();
  const messagesBySource = new WeakMap<ChatMessage, ChatMessage>();
  return (
    message: ChatMessage,
    previewUrlFor: (attachment: ChatAttachment) => string | undefined,
  ): ChatMessage => {
    const source = message.attachments;
    if (!source || source.length === 0) return message;
    const previous = attachmentsBySource.get(source) ?? source;
    let changed: ChatAttachment[] | undefined;
    let hasOverrides = false;
    for (const [index, attachment] of source.entries()) {
      const previewUrl = previewUrlFor(attachment);
      const sourceUrl = "previewUrl" in attachment ? attachment.previewUrl : undefined;
      const previousAttachment = previous[index]!;
      const previousUrl =
        "previewUrl" in previousAttachment ? previousAttachment.previewUrl : undefined;
      const next =
        !previewUrl || previewUrl === sourceUrl
          ? attachment
          : previewUrl === previousUrl
            ? previousAttachment
            : { ...attachment, previewUrl };
      hasOverrides ||= next !== attachment;
      if (next !== previousAttachment) {
        changed ??= previous.slice();
        changed[index] = next;
      }
    }
    const attachments = hasOverrides ? (changed ?? previous) : source;
    attachmentsBySource.set(source, attachments);
    if (attachments === source) {
      messagesBySource.delete(message);
      return message;
    }
    const previousMessage = messagesBySource.get(message);
    if (previousMessage?.attachments === attachments) return previousMessage;
    const result = { ...message, attachments };
    messagesBySource.set(message, result);
    return result;
  };
}

/** Text and update time do not change a streaming assistant message's row structure. */
export function isStreamingMessageTextUpdate(previous: ChatMessage, next: ChatMessage): boolean {
  if (
    previous.role !== "assistant" ||
    next.role !== "assistant" ||
    !previous.streaming ||
    !next.streaming
  ) {
    return false;
  }
  const { text: _previousText, updatedAt: _previousUpdatedAt, ...previousMetadata } = previous;
  const { text: _nextText, updatedAt: _nextUpdatedAt, ...nextMetadata } = next;
  return shallow(previousMetadata, nextMetadata);
}

/** Keep provenance and execution metadata in the rebuild boundary, including inspector data. */
export function isStreamingTurnItemTextUpdate(
  previous: OrchestrationV2ProjectedTurnItem,
  next: OrchestrationV2ProjectedTurnItem,
): boolean {
  const { item: previousItem, ...previousSource } = previous;
  const { item: nextItem, ...nextSource } = next;
  if (
    previousItem.type !== "assistant_message" ||
    nextItem.type !== "assistant_message" ||
    !previousItem.streaming ||
    !nextItem.streaming ||
    !shallow(previousSource, nextSource) ||
    projectedItemCreatedAt(previous) !== projectedItemCreatedAt(next)
  ) {
    return false;
  }
  const { text: _previousText, updatedAt: _previousUpdatedAt, ...previousMetadata } = previousItem;
  const { text: _nextText, updatedAt: _nextUpdatedAt, ...nextMetadata } = nextItem;
  // Wire decoding can recreate timestamps and attachments on each update.
  // Compare only the changed item's metadata, never the entire transcript.
  return Equal.equals(previousMetadata, nextMetadata);
}

function reuseTimelineEntries(
  input: TimelineEntriesInput,
  previous: TimelineEntriesProjection,
): TimelineEntry[] | null {
  const before = previous.input;
  if (
    input.visibleTurnItems.length < before.visibleTurnItems.length ||
    !shallow(input.optimisticMessages, before.optimisticMessages) ||
    !shallow(input.anchoredMessages, before.anchoredMessages) ||
    !shallow(input.attachmentUrlById, before.attachmentUrlById) ||
    !shallow(input.attempts, before.attempts) ||
    !shallow(input.nodes, before.nodes) ||
    !shallow(input.plans, before.plans)
  ) {
    return null;
  }
  const appended = input.visibleTurnItems.length > before.visibleTurnItems.length;
  // Anchored and optimistic messages need to be interleaved/deduplicated when
  // committed items arrive. Keep the full projection for that transition.
  if (
    appended &&
    (input.optimisticMessages.length > 0 || (input.anchoredMessages?.length ?? 0) > 0)
  ) {
    return null;
  }
  // Answer rows can replace a message already present in the retained prefix.
  if (
    appended &&
    input.visibleTurnItems
      .slice(before.visibleTurnItems.length)
      .some(
        ({ item }) =>
          (item.type === "user_input_request" && item.questionAnswer !== undefined) ||
          (item.type === "user_message" && item.messageId.startsWith("async-answer:")),
      )
  )
    return null;
  const replacements = new Map<
    OrchestrationV2ProjectedTurnItem,
    OrchestrationV2ProjectedTurnItem
  >();
  for (const [index, previousItem] of before.visibleTurnItems.entries()) {
    const item = input.visibleTurnItems[index]!;
    if (item === previousItem) continue;
    if (!isStreamingTurnItemTextUpdate(previousItem, item)) return null;
    replacements.set(previousItem, item);
  }
  if (replacements.size === 0 && !appended) return previous.entries;
  const entries = previous.entries.map((entry): TimelineEntry => {
    const row =
      entry.kind === "message" && entry.projectedItem !== undefined
        ? replacements.get(entry.projectedItem)
        : undefined;
    if (entry.kind !== "message" || row?.item.type !== "assistant_message") return entry;
    return {
      ...entry,
      projectedItem: row,
      message: {
        ...entry.message,
        text: row.item.text,
        updatedAt: DateTime.formatIso(row.item.updatedAt),
      },
    };
  });
  if (appended) {
    entries.push(
      ...deriveTimelineEntriesFromVisibleTurnItems({
        ...input,
        visibleTurnItems: input.visibleTurnItems.slice(before.visibleTurnItems.length),
      }),
    );
  }
  return entries;
}

/** Reuse immutable entries during streaming without reordering the canonical v2 sequence. */
export function deriveTimelineEntriesFromVisibleTurnItemsWithState(
  input: TimelineEntriesInput,
  previous: TimelineEntriesProjection | null = null,
): TimelineEntriesProjection {
  const reused = previous === null ? null : reuseTimelineEntries(input, previous);
  if (reused !== null) return { input, entries: reused };
  const entries = deriveTimelineEntriesFromVisibleTurnItems(input);
  if (previous === null || !shallow(input.attachmentUrlById, previous.input.attachmentUrlById)) {
    return { input, entries };
  }
  // Tool output and lifecycle changes rebuild grouping, but unchanged message
  // objects and previews still let memoized history rows stay mounted.
  const previousMessages = new Map(
    previous.entries.flatMap((entry) =>
      entry.kind === "message" ? [[entry.id, entry] as const] : [],
    ),
  );
  return {
    input,
    entries: entries.map((entry) => {
      if (entry.kind !== "message" || entry.projectedItem === undefined) return entry;
      const before = previousMessages.get(entry.id);
      if (before?.projectedItem !== entry.projectedItem) return entry;
      return before.attempt === entry.attempt ? before : { ...entry, message: before.message };
    }),
  };
}

export function inferCheckpointTurnCountByRunId(
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
): Record<string, number> {
  return Object.fromEntries(
    summaries.flatMap((summary) =>
      summary.runId === null ? [] : [[summary.runId, summary.checkpointTurnCount] as const],
    ),
  );
}

export function deriveRevertTurnCountByUserMessageId(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly checkpoints: ReadonlyArray<ThreadCheckpointSummary>;
}): Map<ChatMessage["id"], number> {
  const readyCheckpointByRunId = new Map<RunId, ThreadCheckpointSummary>();
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.status === "ready") {
      readyCheckpointByRunId.set(checkpoint.runId, checkpoint);
    }
  }
  const byUserMessageId = new Map<ChatMessage["id"], number>();
  for (const entry of input.timelineEntries) {
    if (entry.kind !== "message" || entry.message.role !== "user") continue;
    if (entry.message.inputIntent !== "turn_start" && entry.message.inputIntent !== "queued_turn") {
      continue;
    }
    if (entry.message.runId === null) continue;
    const checkpoint = readyCheckpointByRunId.get(entry.message.runId);
    if (checkpoint === undefined) continue;
    byUserMessageId.set(entry.message.id, Math.max(0, checkpoint.checkpointTurnCount - 1));
  }
  return byUserMessageId;
}

export function derivePhase(runtime: ThreadRuntimeSummary | null): SessionPhase {
  if (runtime === null) return "disconnected";
  if (
    runtime.status === "preparing" ||
    runtime.status === "starting" ||
    runtime.status === "queued"
  )
    return "connecting";
  if (runtime.status === "running" || runtime.status === "waiting") return "running";
  return "ready";
}

/**
 * Whether web and desktop offer Stop for the active thread. The server settles
 * a preparing or starting run on `run.interrupt` (Orchestrator.dispatchRunInterrupt),
 * so Stop must not wait for the phase to reach "running". A queued thread offers
 * Stop only while an earlier run is still interruptible; Stop targets that run.
 */
export function deriveCanInterruptRunningThread(
  hasActiveThread: boolean,
  runtime: ThreadRuntimeSummary | null,
): boolean {
  return (
    hasActiveThread &&
    (derivePhase(runtime) === "running" || threadRuntimeHasInterruptibleRun(runtime))
  );
}

export type { TurnDiffSummary };

export interface EvidenceRunWorkEntry {
  runId: string;
  runner: string;
  status: "pass" | "fail" | "blocked" | "error";
  success: boolean;
  goal?: string;
  finalUrl?: string;
  title?: string;
  evidenceSummary?: string;
  outputSummary?: string;
  tracePath?: string;
  summaryPath?: string;
  markdownPath?: string;
  durationMs?: number;
  screenshots: ReadonlyArray<{
    label: string;
    path: string;
  }>;
  videos: ReadonlyArray<{
    label: string;
    path: string;
  }>;
  consoleErrors: ReadonlyArray<string>;
  networkFailures: ReadonlyArray<string>;
}

export type ProjectTriggerWorkToolName =
  | "create_trigger"
  | "update_trigger"
  | "set_trigger_enabled"
  | "delete_trigger"
  | "list_triggers";

export interface ProjectTriggerWorkSummary {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  schedule: {
    kind?: string | undefined;
    expression?: string | undefined;
    timezone?: string | undefined;
    runtime?: string | undefined;
  };
  threadTemplate?: {
    prompt?: string | undefined;
    titleSeed?: string | null | undefined;
    runtimeMode?: string | undefined;
    interactionMode?: string | undefined;
    branch?: string | null | undefined;
    worktreePath?: string | null | undefined;
    modelSelection?: unknown;
  };
  nextRunAt?: string | null | undefined;
  lastRunAt?: string | null | undefined;
  updatedAt?: string | undefined;
  warnings: ReadonlyArray<string>;
}

export interface ProjectTriggerWorkEntry {
  tool: ProjectTriggerWorkToolName;
  success: boolean;
  trigger?: ProjectTriggerWorkSummary | undefined;
  triggers?: ReadonlyArray<ProjectTriggerWorkSummary> | undefined;
  projectId?: string | undefined;
  triggerId?: string | undefined;
  deleted?: boolean | undefined;
  deletedAt?: string | undefined;
  error?: {
    code?: string | undefined;
    message: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function isEvidenceStatus(value: unknown): value is EvidenceRunWorkEntry["status"] {
  return value === "pass" || value === "fail" || value === "blocked" || value === "error";
}

function extractDynamicToolInputTextResult(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const data = asRecord(payload?.data);
  const result = asRecord(data?.result);
  for (const content of [
    data?.contentItems,
    result?.contentItems,
    result?.content,
    data?.content,
  ]) {
    const parsed = extractJsonRecordFromToolContent(content);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function extractJsonRecordFromToolContent(value: unknown): Record<string, unknown> | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return parseJsonRecord(direct);
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (const contentItem of value) {
    const text = asTrimmedString(contentItem);
    if (text) {
      const parsed = parseJsonRecord(text);
      if (parsed) {
        return parsed;
      }
      continue;
    }

    const record = asRecord(contentItem);
    if (record?.type !== "inputText" && record?.type !== "text") {
      continue;
    }
    const itemText = asTrimmedString(record.text);
    if (!itemText) {
      continue;
    }
    const parsed = parseJsonRecord(itemText);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function extractLabeledArtifacts(value: unknown): ReadonlyArray<{ label: string; path: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          label: `artifact-${index + 1}`,
          path: entry,
        };
      }
      const record = asRecord(entry);
      const path = asTrimmedString(record?.path);
      if (!path) {
        return null;
      }
      return {
        label: asTrimmedString(record?.label) ?? `artifact-${index + 1}`,
        path,
      };
    })
    .filter((entry): entry is { label: string; path: string } => entry !== null);
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
}

function extractEvidenceRun(payload: Record<string, unknown> | null): EvidenceRunWorkEntry | null {
  if (payload?.itemType !== "dynamic_tool_call") {
    return null;
  }

  const result = extractDynamicToolInputTextResult(payload);
  if (!result) {
    return null;
  }

  const runId = asTrimmedString(result.runId);
  const runner = asTrimmedString(result.runner);
  const status = result.status;
  if (!runId || !runner || !isEvidenceStatus(status)) {
    return null;
  }

  const artifactPaths = asRecord(result.artifactPaths);
  const screenshots = extractLabeledArtifacts(result.screenshots);
  const fallbackScreenshots = extractLabeledArtifacts(artifactPaths?.screenshots);
  const videos = extractLabeledArtifacts(result.videos);
  const fallbackVideoPath = asTrimmedString(artifactPaths?.video);
  const normalizedVideos =
    videos.length > 0
      ? videos
      : fallbackVideoPath
        ? [{ label: "video", path: fallbackVideoPath }]
        : [];

  const entry: EvidenceRunWorkEntry = {
    runId,
    runner,
    status,
    success: asBoolean(result.success) ?? status === "pass",
    screenshots: screenshots.length > 0 ? screenshots : fallbackScreenshots,
    videos: normalizedVideos,
    consoleErrors: extractStringArray(result.consoleErrors),
    networkFailures: extractStringArray(result.networkFailures),
  };

  const goal = asTrimmedString(result.goal);
  const finalUrl = asTrimmedString(result.finalUrl);
  const title = asTrimmedString(result.title);
  const evidenceSummary = asTrimmedString(result.evidenceSummary);
  const outputSummary = asTrimmedString(result.outputSummary);
  const tracePath = asTrimmedString(artifactPaths?.trace);
  const summaryPath = asTrimmedString(artifactPaths?.summary);
  const markdownPath = asTrimmedString(artifactPaths?.markdown);
  const durationMs = asNumber(result.durationMs);

  if (goal) entry.goal = goal;
  if (finalUrl) entry.finalUrl = finalUrl;
  if (title) entry.title = title;
  if (evidenceSummary) entry.evidenceSummary = evidenceSummary;
  if (outputSummary) entry.outputSummary = outputSummary;
  if (tracePath) entry.tracePath = tracePath;
  if (summaryPath) entry.summaryPath = summaryPath;
  if (markdownPath) entry.markdownPath = markdownPath;
  if (durationMs !== null) entry.durationMs = durationMs;

  return entry;
}

const PROJECT_TRIGGER_WORK_TOOL_NAMES: ReadonlySet<ProjectTriggerWorkToolName> = new Set([
  "create_trigger",
  "update_trigger",
  "set_trigger_enabled",
  "delete_trigger",
  "list_triggers",
]);

function isProjectTriggerWorkToolName(value: unknown): value is ProjectTriggerWorkToolName {
  return (
    typeof value === "string" &&
    PROJECT_TRIGGER_WORK_TOOL_NAMES.has(value as ProjectTriggerWorkToolName)
  );
}

function toolNameFromMcpName(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith("mcp__kamicode__")) {
    return value.slice("mcp__kamicode__".length);
  }
  if (value.startsWith("kamicode.")) {
    return value.slice("kamicode.".length);
  }
  return value;
}

function asNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return asTrimmedString(value) ?? undefined;
}

function extractProjectTriggerThreadTemplate(
  value: unknown,
): ProjectTriggerWorkSummary["threadTemplate"] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const prompt = asTrimmedString(record.prompt);
  const titleSeed = asNullableTrimmedString(record.titleSeed);
  const runtimeMode = asTrimmedString(record.runtimeMode);
  const interactionMode = asTrimmedString(record.interactionMode);
  const branch = asNullableTrimmedString(record.branch);
  const worktreePath = asNullableTrimmedString(record.worktreePath);
  const template: NonNullable<ProjectTriggerWorkSummary["threadTemplate"]> = {};
  if (prompt) template.prompt = prompt;
  if (titleSeed !== undefined) template.titleSeed = titleSeed;
  if (runtimeMode) template.runtimeMode = runtimeMode;
  if (interactionMode) template.interactionMode = interactionMode;
  if (branch !== undefined) template.branch = branch;
  if (worktreePath !== undefined) template.worktreePath = worktreePath;
  if (record.modelSelection !== undefined) template.modelSelection = record.modelSelection;
  return Object.keys(template).length > 0 ? template : undefined;
}

function extractProjectTriggerSummary(value: unknown): ProjectTriggerWorkSummary | null {
  const record = asRecord(value);
  const scheduleRecord = asRecord(record?.schedule);
  if (!record || !scheduleRecord) {
    return null;
  }

  const id = asTrimmedString(record.id);
  const projectId = asTrimmedString(record.projectId);
  const name = asTrimmedString(record.name);
  const enabled = asBoolean(record.enabled);
  if (!id || !projectId || !name || enabled === null) {
    return null;
  }

  const kind = asTrimmedString(scheduleRecord.kind);
  const expression = asTrimmedString(scheduleRecord.expression);
  const timezone = asTrimmedString(scheduleRecord.timezone);
  const runtime = asTrimmedString(scheduleRecord.runtime);
  const description = asNullableTrimmedString(record.description);
  const threadTemplate = extractProjectTriggerThreadTemplate(record.threadTemplate);
  const nextRunAt = asNullableTrimmedString(record.nextRunAt);
  const lastRunAt = asNullableTrimmedString(record.lastRunAt);
  const updatedAt = asTrimmedString(record.updatedAt);

  return {
    id,
    projectId,
    name,
    enabled,
    schedule: {
      ...(kind ? { kind } : {}),
      ...(expression ? { expression } : {}),
      ...(timezone ? { timezone } : {}),
      ...(runtime ? { runtime } : {}),
    },
    warnings: extractStringArray(record.warnings),
    ...(description !== undefined ? { description } : {}),
    ...(threadTemplate ? { threadTemplate } : {}),
    ...(nextRunAt !== undefined ? { nextRunAt } : {}),
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function extractProjectTriggerSummaries(value: unknown): ReadonlyArray<ProjectTriggerWorkSummary> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(extractProjectTriggerSummary)
    .filter((trigger): trigger is ProjectTriggerWorkSummary => trigger !== null);
}

function extractProjectTriggerWorkEntry(
  payload: Record<string, unknown> | null,
): ProjectTriggerWorkEntry | null {
  if (payload?.itemType !== "dynamic_tool_call") {
    return null;
  }

  const data = asRecord(payload.data);
  const namespace = asTrimmedString(data?.namespace);
  if (namespace && namespace !== "kamicode") {
    return null;
  }

  const result = extractDynamicToolInputTextResult(payload);
  if (!result) {
    return null;
  }

  const payloadTool = toolNameFromMcpName(asTrimmedString(data?.tool ?? data?.toolName));
  const resultTool = asTrimmedString(result.tool);
  const tool = isProjectTriggerWorkToolName(resultTool)
    ? resultTool
    : isProjectTriggerWorkToolName(payloadTool)
      ? payloadTool
      : null;
  if (!tool) {
    return null;
  }

  const errorRecord = asRecord(result.error);
  const errorMessage = asTrimmedString(errorRecord?.message);
  const errorCode = asTrimmedString(errorRecord?.code);
  const success = asBoolean(data?.success) ?? !errorMessage;
  const trigger = extractProjectTriggerSummary(result.trigger);
  const triggers = extractProjectTriggerSummaries(result.triggers);
  const projectId = asTrimmedString(result.projectId);
  const triggerId = asTrimmedString(result.triggerId);
  const deleted = asBoolean(result.deleted);
  const deletedAt = asTrimmedString(result.deletedAt);

  return {
    tool,
    success,
    ...(trigger ? { trigger } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
    ...(projectId ? { projectId } : {}),
    ...(triggerId ? { triggerId } : {}),
    ...(deleted !== null ? { deleted } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(errorMessage
      ? {
          error: {
            message: errorMessage,
            ...(errorCode ? { code: errorCode } : {}),
          },
        }
      : {}),
  };
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
