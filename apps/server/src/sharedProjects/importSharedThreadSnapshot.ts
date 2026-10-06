import {
  ChatAttachment,
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  ModelSelection,
  NodeId,
  PlanId,
  ThreadId,
  TurnItemId,
  IsoDateTime,
  ProviderInteractionMode,
  RuntimeMode,
  type ImportSharedThreadInput,
  type ImportSharedThreadResult,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type SharedSessionSnapshot,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The synchronous snapshot event builder generates IDs before its atomic event append.
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  prepareSharedThreadImportBranch,
  sharedImportStashLabel,
  sharedSessionBranchName,
} from "./importSharedThreadGit.ts";
import { SharedProjectsError } from "./Services/SharedProjects.ts";

const SharedSnapshotPlan = Schema.Struct({
  planMarkdown: Schema.String,
  createdAt: IsoDateTime,
  implementedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});

/** A shared snapshot is inert history: importing never resumes another user's queued work. */
export function sharedSnapshotEvents(input: {
  snapshot: SharedSessionSnapshot;
  threadId: ThreadId;
  projectId: ImportSharedThreadInput["targetProjectId"];
  title: string;
  branch: string;
  cwd?: string | undefined;
  now: DateTime.Utc;
}): OrchestrationV2DomainEvent[] {
  const { snapshot, threadId, now } = input;
  const modelSelection = Schema.decodeUnknownSync(ModelSelection)(snapshot.modelSelection);
  const runtimeMode = Schema.decodeUnknownOption(RuntimeMode)(snapshot.runtimeMode);
  const interactionMode = Schema.decodeUnknownOption(ProviderInteractionMode)(
    snapshot.interactionMode,
  );
  const events: OrchestrationV2DomainEvent[] = [
    {
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "thread.created",
      threadId,
      occurredAt: now,
      payload: {
        createdBy: "user",
        creationSource: "server",
        id: threadId,
        projectId: input.projectId,
        title: input.title,
        providerInstanceId: modelSelection.instanceId,
        modelSelection,
        runtimeMode: runtimeMode._tag === "Some" ? runtimeMode.value : "full-access",
        interactionMode: interactionMode._tag === "Some" ? interactionMode.value : "default",
        branch: input.branch,
        worktreePath: null,
        activeProviderThreadId: null,
        historyOrigin: "v1_import",
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    },
  ];
  const timeline: Array<{ at: DateTime.Utc; item: OrchestrationV2TurnItem }> = [];
  const base = (at: DateTime.Utc) => ({
    id: TurnItemId.make(NodeCrypto.randomUUID()),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  });
  for (const message of snapshot.messages) {
    const id = MessageId.make(NodeCrypto.randomUUID());
    const at = DateTime.makeUnsafe(message.createdAt);
    const updatedAt = DateTime.makeUnsafe(message.completedAt ?? message.createdAt);
    const attachments = message.attachments.flatMap((attachment) => {
      const decoded = Schema.decodeUnknownOption(ChatAttachment)(attachment);
      return decoded._tag === "Some" ? [decoded.value] : [];
    });
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "message.updated",
      threadId,
      occurredAt: updatedAt,
      payload: {
        createdBy: message.role === "user" ? "user" : "agent",
        creationSource: "server",
        id,
        threadId,
        runId: null,
        nodeId: null,
        role: message.role,
        text: message.text,
        attachments,
        streaming: false,
        createdAt: at,
        updatedAt,
      },
    });
    if (message.role === "system") {
      timeline.push({
        at,
        item: {
          ...base(at),
          type: "kami_activity",
          activity: {
            id: EventId.make(NodeCrypto.randomUUID()),
            tone: "info",
            kind: "shared.system_message",
            summary: message.text.trim() || "System message",
            payload: { text: message.text },
            turnId: null,
            createdAt: message.createdAt,
          },
        },
      });
    } else {
      timeline.push({
        at,
        item:
          message.role === "user"
            ? {
                ...base(at),
                type: "user_message",
                createdBy: "user",
                creationSource: "server",
                messageId: id,
                inputIntent: "turn_start",
                text: message.text,
                attachments,
              }
            : {
                ...base(at),
                type: "assistant_message",
                messageId: id,
                text: message.text,
                attachments,
                streaming: false,
              },
      });
    }
  }
  for (const activity of snapshot.activities) {
    const at = DateTime.makeUnsafe(activity.createdAt);
    timeline.push({
      at,
      item: {
        ...base(at),
        type: "kami_activity",
        activity: {
          id: EventId.make(NodeCrypto.randomUUID()),
          tone: ["info", "tool", "approval", "error"].includes(activity.tone)
            ? (activity.tone as "info" | "tool" | "approval" | "error")
            : "info",
          kind: activity.kind,
          summary: activity.summary.trim() || activity.kind,
          payload: activity.payload,
          turnId: null,
          createdAt: activity.createdAt,
          ...(activity.sequence === undefined ? {} : { sequence: activity.sequence }),
        },
      },
    });
  }
  // Historical nodes carry no provider handles, active requests, or runnable work.
  const historyNode = (kind: "plan" | "system", at: DateTime.Utc) => {
    const nodeId = NodeId.make(NodeCrypto.randomUUID());
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "node.updated",
      threadId,
      occurredAt: at,
      payload: {
        id: nodeId,
        threadId,
        runId: null,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind,
        status: "completed",
        countsForRun: false,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: null,
        startedAt: at,
        completedAt: at,
      },
    });
    return nodeId;
  };
  for (const rawPlan of snapshot.proposedPlans) {
    const decoded = Schema.decodeUnknownOption(SharedSnapshotPlan)(rawPlan);
    if (decoded._tag === "None") continue;
    const plan = decoded.value;
    const at = DateTime.makeUnsafe(plan.createdAt);
    const planId = PlanId.make(NodeCrypto.randomUUID());
    const nodeId = historyNode("plan", at);
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "plan.updated",
      threadId,
      occurredAt: at,
      payload: {
        id: planId,
        threadId,
        runId: null,
        nodeId,
        kind: "proposed_plan",
        status: plan.implementedAt ? "completed" : "draft",
        markdown: plan.planMarkdown,
      },
    });
    timeline.push({
      at,
      item: {
        ...base(at),
        nodeId,
        type: "proposed_plan",
        planId,
        markdown: plan.planMarkdown,
        streaming: false,
      },
    });
  }
  for (const checkpoint of snapshot.checkpoints) {
    const at = DateTime.makeUnsafe(checkpoint.completedAt ?? snapshot.capturedAt);
    const nodeId = historyNode("system", at);
    const scopeId = CheckpointScopeId.make(NodeCrypto.randomUUID());
    const checkpointId = CheckpointId.make(NodeCrypto.randomUUID());
    const files = checkpoint.files.flatMap((file) => {
      if (
        typeof file !== "object" ||
        file === null ||
        !("path" in file) ||
        typeof file.path !== "string" ||
        !file.path.trim()
      )
        return [];
      const field = (key: string) =>
        key in file ? (file as Record<string, unknown>)[key] : undefined;
      const count = (key: string) => {
        const value = field(key);
        return typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, Math.floor(value))
          : 0;
      };
      return [
        {
          path: file.path,
          kind: typeof field("kind") === "string" ? String(field("kind")) : "modified",
          additions: count("additions"),
          deletions: count("deletions"),
        },
      ];
    });
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "checkpoint-scope.created",
      threadId,
      occurredAt: at,
      payload: {
        id: scopeId,
        threadId,
        runId: null,
        nodeId,
        parentScopeId: null,
        providerThreadId: null,
        kind: "manual",
        ordinalWithinParent: 0,
        advancesAppRunCount: false,
        cwd: input.cwd ?? ".",
        createdAt: at,
      },
    });
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "checkpoint.captured",
      threadId,
      occurredAt: at,
      payload: {
        id: checkpointId,
        threadId,
        scopeId,
        runId: null,
        nodeId,
        parentCheckpointId: null,
        ordinalWithinScope: 0,
        appRunOrdinal: null,
        ref: CheckpointRef.make(`shared-import:${checkpointId}`),
        // The shared snapshot contains summaries, not the source machine's git checkpoint objects.
        status: "missing",
        files,
        capturedAt: at,
      },
    });
    timeline.push({
      at,
      item: { ...base(at), nodeId, type: "checkpoint", checkpointId, scopeId, files },
    });
  }
  timeline.sort((a, b) => DateTime.toEpochMillis(a.at) - DateTime.toEpochMillis(b.at));
  for (const [index, { at, item }] of timeline.entries()) {
    events.push({
      id: EventId.make(NodeCrypto.randomUUID()),
      type: "turn-item.updated",
      threadId,
      occurredAt: at,
      payload: { ...item, ordinal: index + 1 },
    });
  }
  return events;
}

export const importSharedThreadSnapshot = (input: {
  readonly request: ImportSharedThreadInput;
  readonly title: string;
  readonly snapshot: SharedSessionSnapshot;
  readonly sourceSharedThreadId: string;
  readonly targetProjectCwd?: string | undefined;
}): Effect.Effect<
  ImportSharedThreadResult,
  SharedProjectsError,
  EventSink.EventSinkV2 | ProcessRunner.ProcessRunner
> =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const importedThreadId = ThreadId.make(NodeCrypto.randomUUID());
    const importedTitle = `Imported: ${(input.snapshot.title || input.title).trim() || "shared session"}`;
    // Validate before touching the checkout.
    yield* Schema.decodeUnknownEffect(ModelSelection)(input.snapshot.modelSelection).pipe(
      Effect.mapError(
        (cause) =>
          new SharedProjectsError({
            message: "Shared session snapshot has an invalid model selection.",
            status: 400,
            cause,
          }),
      ),
    );
    const branchName = sharedSessionBranchName({
      title: input.snapshot.title || input.title,
      sourceSharedThreadId: input.sourceSharedThreadId,
      suggestedBranch: input.snapshot.suggestedBranch,
    });
    const preparedBranch = input.targetProjectCwd
      ? yield* Effect.tryPromise({
          try: () => sharedImportStashLabel(input.title),
          catch: (cause) =>
            new SharedProjectsError({
              message: "Failed to prepare the imported shared session branch.",
              status: 500,
              cause,
            }),
        }).pipe(
          Effect.flatMap((stashLabel) =>
            prepareSharedThreadImportBranch({
              cwd: input.targetProjectCwd!,
              branchName,
              stashLabel,
            }),
          ),
        )
      : {
          branch: branchName,
          stashedChanges: false,
          stashName: null,
        };

    const events = yield* Effect.try({
      try: () =>
        sharedSnapshotEvents({
          snapshot: input.snapshot,
          threadId: importedThreadId,
          projectId: input.request.targetProjectId,
          title: importedTitle,
          branch: preparedBranch.branch,
          cwd: input.targetProjectCwd,
          now,
        }),
      catch: (cause) =>
        new SharedProjectsError({
          message: "Shared session snapshot is invalid.",
          status: 400,
          cause,
        }),
    });
    yield* eventSink.write({ events }).pipe(
      Effect.mapError(
        (cause) =>
          new SharedProjectsError({
            message: "Failed to import shared session into the local project.",
            status: 500,
            cause,
          }),
      ),
    );
    return {
      projectId: input.request.targetProjectId,
      threadId: importedThreadId,
      sourceSharedThreadId: input.request.threadId,
      branch: preparedBranch.branch,
      stashedChanges: preparedBranch.stashedChanges,
      stashName: preparedBranch.stashName,
    };
  });
