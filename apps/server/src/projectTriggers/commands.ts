import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";

import {
  ProjectTriggerRunId,
  type ProjectTriggerRow,
  type ProjectTriggerRunRow,
  type ProjectTriggerTurnStartCommand,
} from "./Services/ProjectTriggerRepository.ts";

export interface ProjectTriggerRunIds {
  readonly runId: ProjectTriggerRunId;
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}

export function makeProjectTriggerRunIds(
  triggerId: ProjectTriggerRow["triggerId"],
  fireAt: string,
): ProjectTriggerRunIds {
  const key = `${triggerId}:${fireAt}`;
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
      text: input.trigger.prompt,
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
}): ProjectTriggerRunRow {
  const ids = makeProjectTriggerRunIds(input.trigger.triggerId, input.fireAt);
  const command = makeProjectTriggerRunCommand({
    trigger: input.trigger,
    fireAt: input.fireAt,
    ids,
  });

  return {
    runId: ids.runId,
    triggerId: input.trigger.triggerId,
    status: "queued",
    fireAt: input.fireAt,
    queuedAt: input.queuedAt,
    claimedAt: null,
    claimExpiresAt: null,
    dispatchedAt: null,
    completedAt: null,
    commandId: ids.commandId,
    threadId: ids.threadId,
    messageId: ids.messageId,
    command,
    resultSequence: null,
    failureDetail: null,
    skipReason: null,
  };
}
