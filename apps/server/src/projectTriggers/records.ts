import type {
  ProjectTriggerRecord,
  ProjectTriggerRunRecord,
  ProjectTriggerWebhookDescriptor,
} from "@t3tools/contracts";

import type {
  ProjectTriggerRow,
  ProjectTriggerRunRow,
} from "./Services/ProjectTriggerRepository.ts";

export function projectTriggerWebhookEndpointPath(publicId: string): string {
  return `/api/project-triggers/webhook/${encodeURIComponent(publicId)}`;
}

export function projectTriggerWebhookDescriptor(
  trigger: ProjectTriggerRow,
): ProjectTriggerWebhookDescriptor {
  return {
    publicId: trigger.webhookPublicId,
    configured: trigger.webhookSecretVersion > 0,
    endpointPath: projectTriggerWebhookEndpointPath(trigger.webhookPublicId),
    secretVersion: trigger.webhookSecretVersion,
  };
}

export function toProjectTriggerRunRecord(
  run: ProjectTriggerRunRow,
  trigger: Pick<ProjectTriggerRow, "projectId">,
): ProjectTriggerRunRecord {
  const failureReason = run.status === "failed" ? run.failureDetail : null;
  const cancellationReason = run.status === "cancelled" ? run.cancellationReason : null;
  return {
    id: run.runId,
    triggerId: run.triggerId,
    projectId: trigger.projectId,
    initiator: run.initiator,
    status: run.status,
    commandId: run.commandId,
    threadId: run.threadId,
    eventKind: run.eventKind,
    idempotencyKey: run.idempotencyKey,
    retryOfRunId: run.retryOfRunId,
    scheduledFor: run.fireAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failureReason,
    cancellationReason,
    error:
      failureReason !== null
        ? { message: failureReason, code: "run_failed" }
        : cancellationReason !== null
          ? { message: cancellationReason, code: "cancelled" }
          : null,
    createdAt: run.queuedAt,
    updatedAt:
      run.completedAt ?? run.startedAt ?? run.dispatchedAt ?? run.claimedAt ?? run.queuedAt,
  };
}

export function withProjectTriggerWebhook(
  trigger: Omit<ProjectTriggerRecord, "webhook">,
  row: ProjectTriggerRow,
): ProjectTriggerRecord {
  return { ...trigger, webhook: projectTriggerWebhookDescriptor(row) };
}
