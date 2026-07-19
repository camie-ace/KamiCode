import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  MessageId,
  ThreadId,
  type ProjectTriggerRunInitiator,
  type ProjectTriggerWebhookEventInput,
  type TriggerEventKind,
} from "@t3tools/contracts";

import {
  ProjectTriggerRunId,
  type ProjectTriggerRow,
  type ProjectTriggerRunRow,
  type ProjectTriggerTurnStartCommand,
} from "./Services/ProjectTriggerRepository.ts";
import { formatProjectTriggerPrompt } from "./eventPayload.ts";

export interface ProjectTriggerRunIds {
  readonly runId: ProjectTriggerRunId;
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}

export function makeProjectTriggerRunIds(
  triggerId: ProjectTriggerRow["triggerId"],
  fireAt: string,
  runKey = fireAt,
): ProjectTriggerRunIds {
  const key = NodeCrypto.createHash("sha256")
    .update(`${triggerId}\0${runKey}`, "utf8")
    .digest("base64url");
  return {
    runId: ProjectTriggerRunId.make(`project-trigger-run:${key}`),
    commandId: CommandId.make(`project-trigger:${key}:thread-turn-start`),
    threadId: ThreadId.make(`project-trigger:${key}:thread`),
    messageId: MessageId.make(`project-trigger:${key}:message`),
  };
}

export function makeProjectTriggerRunCommand(input: {
  readonly trigger: ProjectTriggerRow;
  readonly fireAt: string;
  readonly ids: ProjectTriggerRunIds;
  readonly eventKind: TriggerEventKind;
  readonly event: ProjectTriggerWebhookEventInput | null;
}): ProjectTriggerTurnStartCommand {
  const createThreadTemplate = input.trigger.bootstrap?.createThread;
  const bootstrap = {
    createThread: {
      projectId: createThreadTemplate?.projectId ?? input.trigger.projectId,
      title: createThreadTemplate?.title ?? input.trigger.name,
      modelSelection: createThreadTemplate?.modelSelection ?? input.trigger.modelSelection,
      runtimeMode: createThreadTemplate?.runtimeMode ?? input.trigger.runtimeMode,
      interactionMode: createThreadTemplate?.interactionMode ?? input.trigger.interactionMode,
      branch: createThreadTemplate?.branch ?? null,
      worktreePath: createThreadTemplate?.worktreePath ?? null,
      startedBy: {
        kind: "trigger",
        triggerId: input.trigger.triggerId,
        triggerName: input.trigger.name,
        eventKind: input.eventKind,
        firedAt: input.fireAt,
      } as const,
      createdAt: input.fireAt,
    },
    ...(input.trigger.bootstrap?.prepareWorktree !== undefined
      ? { prepareWorktree: input.trigger.bootstrap.prepareWorktree }
      : {}),
    ...(input.trigger.bootstrap?.runSetupScript !== undefined
      ? { runSetupScript: input.trigger.bootstrap.runSetupScript }
      : {}),
  };

  return {
    type: "thread.turn.start",
    commandId: input.ids.commandId,
    threadId: input.ids.threadId,
    message: {
      messageId: input.ids.messageId,
      role: "user",
      text: formatProjectTriggerPrompt(input.trigger.prompt, input.event),
      attachments: input.trigger.attachments,
    },
    modelSelection: input.trigger.modelSelection,
    runtimeMode: input.trigger.runtimeMode,
    interactionMode: input.trigger.interactionMode,
    ...(input.trigger.dispatchPolicy !== null
      ? { dispatchPolicy: input.trigger.dispatchPolicy }
      : {}),
    ...(input.trigger.titleSeed !== null ? { titleSeed: input.trigger.titleSeed } : {}),
    bootstrap,
    createdAt: input.fireAt,
  };
}

export function makeProjectTriggerRunRow(input: {
  readonly trigger: ProjectTriggerRow;
  readonly fireAt: string;
  readonly queuedAt: string;
  readonly initiator?: ProjectTriggerRunInitiator;
  readonly eventKind?: TriggerEventKind;
  readonly event?: ProjectTriggerWebhookEventInput | null;
  readonly idempotencyKey?: string | null;
  readonly requestDigest?: string | null;
  readonly retryOfRunId?: ProjectTriggerRunId | null;
  readonly runKey?: string;
}): ProjectTriggerRunRow {
  const initiator = input.initiator ?? "cron";
  const eventKind =
    input.eventKind ??
    (initiator === "cron" ? "cron" : initiator === "manual" ? "manual" : "webhook");
  const event = input.event ?? null;
  const ids = makeProjectTriggerRunIds(input.trigger.triggerId, input.fireAt, input.runKey);
  const command = makeProjectTriggerRunCommand({
    trigger: input.trigger,
    fireAt: input.fireAt,
    ids,
    eventKind,
    event,
  });

  return {
    runId: ids.runId,
    triggerId: input.trigger.triggerId,
    initiator,
    status: "queued",
    eventKind,
    eventPayload: event?.payload ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    requestDigest: input.requestDigest ?? null,
    retryOfRunId: input.retryOfRunId ?? null,
    fireAt: input.fireAt,
    queuedAt: input.queuedAt,
    claimedAt: null,
    claimExpiresAt: null,
    dispatchedAt: null,
    startedAt: null,
    completedAt: null,
    commandId: ids.commandId,
    threadId: ids.threadId,
    messageId: ids.messageId,
    command,
    resultSequence: null,
    failureDetail: null,
    cancellationReason: null,
  };
}
