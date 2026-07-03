import {
  ChatAttachment as ChatAttachmentSchema,
  CheckpointRef,
  CommandId,
  EventId,
  ImportSharedThreadResult,
  MessageId,
  ModelSelection as ModelSelectionSchema,
  OrchestrationCheckpointFile as OrchestrationCheckpointFileSchema,
  OrchestrationProposedPlan as OrchestrationProposedPlanSchema,
  ProviderInteractionMode as ProviderInteractionModeSchema,
  RuntimeMode as RuntimeModeSchema,
  ThreadId,
  TurnId,
  type ChatAttachment,
  type ImportSharedThreadInput,
  type ModelSelection,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointStatus,
  type OrchestrationCommand,
  type OrchestrationProposedPlan,
  type OrchestrationThreadActivityTone,
  type ProviderInteractionMode,
  type RuntimeMode,
  type SharedSessionSnapshot,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  prepareSharedThreadImportBranch,
  sharedImportStashLabel,
  sharedSessionBranchName,
} from "./importSharedThreadGit.ts";
import { SharedProjectsError } from "./Services/SharedProjects.ts";

const IMPORTED_SHARED_SESSION_TITLE_PREFIX = "Imported: ";
const { randomUUID } = NodeCrypto;

const decodeChatAttachment = Schema.decodeUnknownSync(ChatAttachmentSchema);
const decodeModelSelection = Schema.decodeUnknownSync(ModelSelectionSchema);
const decodeProviderInteractionMode = Schema.decodeUnknownSync(ProviderInteractionModeSchema);
const decodeRuntimeMode = Schema.decodeUnknownSync(RuntimeModeSchema);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownSync(OrchestrationProposedPlanSchema);
const decodeOrchestrationCheckpointFile = Schema.decodeUnknownSync(
  OrchestrationCheckpointFileSchema,
);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function decodeUnknownOrNull<T>(decode: (value: unknown) => T, value: unknown): T | null {
  try {
    return decode(value);
  } catch {
    return null;
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function newCommandId(scope: string): CommandId {
  return CommandId.make(`shared-import:${scope}:${randomUUID()}`);
}

function newLocalThreadId(): ThreadId {
  return ThreadId.make(randomUUID());
}

function newLocalMessageId(): MessageId {
  return MessageId.make(randomUUID());
}

function newLocalEventId(): EventId {
  return EventId.make(randomUUID());
}

function importThreadTitle(title: string): string {
  const trimmed = title.trim();
  return `${IMPORTED_SHARED_SESSION_TITLE_PREFIX}${trimmed.length > 0 ? trimmed : "shared session"}`;
}

function runtimeModeOrDefault(value: unknown): RuntimeMode {
  return decodeUnknownOrNull(decodeRuntimeMode, value) ?? "full-access";
}

function interactionModeOrDefault(value: unknown): ProviderInteractionMode {
  return decodeUnknownOrNull(decodeProviderInteractionMode, value) ?? "default";
}

function activityToneOrDefault(value: string): OrchestrationThreadActivityTone {
  return value === "info" || value === "tool" || value === "approval" || value === "error"
    ? value
    : "info";
}

function checkpointStatusOrDefault(value: string): OrchestrationCheckpointStatus {
  return value === "ready" || value === "missing" || value === "error" ? value : "missing";
}

function nonNegativeNumber(value: unknown): OrchestrationCheckpointFile["additions"] {
  return (
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  ) as OrchestrationCheckpointFile["additions"];
}

function normalizeCheckpointFile(value: unknown): OrchestrationCheckpointFile | null {
  const decoded = decodeUnknownOrNull(decodeOrchestrationCheckpointFile, value);
  if (decoded) {
    return decoded;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (path.length === 0) {
    return null;
  }
  const kind =
    typeof record.kind === "string" && record.kind.trim().length > 0
      ? record.kind.trim()
      : "modified";
  return {
    path,
    kind,
    additions: nonNegativeNumber(record.additions),
    deletions: nonNegativeNumber(record.deletions),
  };
}

function normalizeMessageAttachment(value: unknown): ChatAttachment | null {
  return decodeUnknownOrNull(decodeChatAttachment, value);
}

function decodeImportedProposedPlan(value: unknown): OrchestrationProposedPlan | null {
  const decoded = decodeUnknownOrNull(decodeOrchestrationProposedPlan, value);
  if (!decoded) {
    return null;
  }
  return {
    ...decoded,
    id: newId("imported_plan"),
    implementationThreadId: null,
  };
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
  OrchestrationEngineService | ProcessRunner.ProcessRunner
> =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const modelSelection = yield* Effect.try({
      try: (): ModelSelection => decodeModelSelection(input.snapshot.modelSelection),
      catch: (cause) =>
        new SharedProjectsError({
          message: "Shared session snapshot has an invalid model selection.",
          status: 400,
          cause,
        }),
    });
    const importedAt = yield* nowIso;
    const importedThreadId = newLocalThreadId();
    const importedTitle = importThreadTitle(input.snapshot.title || input.title);
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
    const messageIdBySource = new Map<string, MessageId>();
    const commands: OrchestrationCommand[] = [
      {
        type: "thread.create",
        commandId: newCommandId("thread-create"),
        threadId: importedThreadId,
        projectId: input.request.targetProjectId,
        title: importedTitle,
        modelSelection,
        runtimeMode: runtimeModeOrDefault(input.snapshot.runtimeMode),
        interactionMode: interactionModeOrDefault(input.snapshot.interactionMode),
        branch: preparedBranch.branch as never,
        worktreePath: null,
        createdAt: importedAt,
      },
    ];

    for (const message of input.snapshot.messages) {
      const localMessageId = newLocalMessageId();
      const attachments = message.attachments
        .map(normalizeMessageAttachment)
        .filter((attachment): attachment is ChatAttachment => attachment !== null);
      messageIdBySource.set(message.id, localMessageId);
      commands.push({
        type: "thread.message.import",
        commandId: newCommandId("message"),
        threadId: importedThreadId,
        messageId: localMessageId,
        role: message.role,
        text: message.text,
        ...(attachments.length > 0 ? { attachments } : {}),
        turnId: message.turnId === null ? null : TurnId.make(message.turnId),
        createdAt: message.createdAt,
        updatedAt: message.completedAt ?? message.createdAt,
      });
    }

    for (const rawPlan of input.snapshot.proposedPlans) {
      const proposedPlan = decodeImportedProposedPlan(rawPlan);
      if (!proposedPlan) {
        continue;
      }
      commands.push({
        type: "thread.proposed-plan.upsert",
        commandId: newCommandId("proposed-plan"),
        threadId: importedThreadId,
        proposedPlan,
        createdAt: proposedPlan.createdAt,
      });
    }

    for (const activity of input.snapshot.activities) {
      commands.push({
        type: "thread.activity.append",
        commandId: newCommandId("activity"),
        threadId: importedThreadId,
        activity: {
          id: newLocalEventId(),
          tone: activityToneOrDefault(activity.tone),
          kind: activity.kind,
          summary: activity.summary.trim().length > 0 ? activity.summary : activity.kind,
          payload: activity.payload,
          turnId: activity.turnId === null ? null : TurnId.make(activity.turnId),
          ...(activity.sequence !== undefined && activity.sequence >= 0
            ? { sequence: Math.floor(activity.sequence) as never }
            : {}),
          createdAt: activity.createdAt,
        },
        createdAt: activity.createdAt,
      });
    }

    for (const checkpoint of input.snapshot.checkpoints) {
      const files = checkpoint.files
        .map(normalizeCheckpointFile)
        .filter((file): file is OrchestrationCheckpointFile => file !== null);
      commands.push({
        type: "thread.turn.diff.complete",
        commandId: newCommandId("checkpoint"),
        threadId: importedThreadId,
        turnId: TurnId.make(checkpoint.turnId),
        completedAt: checkpoint.completedAt ?? importedAt,
        checkpointRef:
          checkpoint.checkpointRef && checkpoint.checkpointRef.trim().length > 0
            ? CheckpointRef.make(checkpoint.checkpointRef)
            : CheckpointRef.make(`shared-import:${randomUUID()}`),
        status: checkpointStatusOrDefault(checkpoint.status),
        files,
        ...(checkpoint.assistantMessageId
          ? { assistantMessageId: messageIdBySource.get(checkpoint.assistantMessageId) }
          : {}),
        checkpointTurnCount:
          checkpoint.checkpointTurnCount >= 0
            ? (Math.floor(checkpoint.checkpointTurnCount) as never)
            : 0,
        createdAt: checkpoint.completedAt ?? importedAt,
      });
    }

    commands.push({
      type: "thread.meta.update",
      commandId: newCommandId("touch"),
      threadId: importedThreadId,
      title: importedTitle,
    });

    yield* Effect.forEach(
      commands,
      (command) =>
        orchestrationEngine.dispatch(command).pipe(
          Effect.mapError(
            (cause) =>
              new SharedProjectsError({
                message: "Failed to import shared session into the local project.",
                status: 500,
                cause,
              }),
          ),
        ),
      { concurrency: 1 },
    );

    return {
      projectId: input.request.targetProjectId,
      threadId: importedThreadId,
      sourceSharedThreadId: input.request.threadId,
      branch: preparedBranch.branch as never,
      stashedChanges: preparedBranch.stashedChanges,
      stashName: preparedBranch.stashName as never,
    } satisfies ImportSharedThreadResult;
  });
