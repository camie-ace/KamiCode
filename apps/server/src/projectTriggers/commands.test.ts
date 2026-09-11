import { CommandId, MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import { makeProjectTriggerRunIds, makeProjectTriggerRunRow } from "./commands.ts";
import { ProjectTriggerId, type ProjectTriggerRow } from "./Services/ProjectTriggerRepository.ts";

const fireAt = "2026-09-12T09:00:00.000Z";

const trigger: ProjectTriggerRow = {
  triggerId: ProjectTriggerId.make("trigger-thread-recurrence"),
  projectId: ProjectId.make("project-recurring"),
  name: "Daily check-in",
  description: "Recurring message",
  enabled: true,
  scheduleKind: "cron",
  scheduleCron: "0 9 * * *",
  scheduleOnceAt: null,
  timezone: "Africa/Lagos",
  runtimeTarget: "remote",
  targetThreadId: ThreadId.make("thread-recurring"),
  createdBy: null,
  disabledReason: null,
  nextFireAt: fireAt,
  lastFireAt: null,
  prompt: "Share a status update.",
  attachments: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6-astra",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  dispatchPolicy: "queue",
  titleSeed: null,
  bootstrap: null,
  createdAt: "2026-09-11T09:00:00.000Z",
  updatedAt: "2026-09-11T09:00:00.000Z",
  deletedAt: null,
  scheduleClaimedAt: null,
  scheduleClaimExpiresAt: null,
  failureDetail: null,
};

it("targets the existing thread and creates a normal queued turn", () => {
  const ids = makeProjectTriggerRunIds(trigger.triggerId, fireAt, trigger.targetThreadId);
  const run = makeProjectTriggerRunRow({ trigger, fireAt, queuedAt: fireAt });

  assert.strictEqual(ids.threadId, trigger.targetThreadId);
  assert.strictEqual(
    ids.commandId,
    CommandId.make(
      "project-trigger:trigger-thread-recurrence:2026-09-12T09:00:00.000Z:thread-turn-start",
    ),
  );
  assert.strictEqual(
    ids.messageId,
    MessageId.make("project-trigger:trigger-thread-recurrence:2026-09-12T09:00:00.000Z:message"),
  );
  assert.strictEqual(run.threadId, trigger.targetThreadId);
  assert.strictEqual(run.command.threadId, trigger.targetThreadId);
  assert.strictEqual(run.command.dispatchPolicy, "queue");
  assert.strictEqual("bootstrap" in run.command, false);
});
