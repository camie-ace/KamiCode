import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-09-19T00:00:00.000Z";
const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-lock-test"),
      projectId: ProjectId.make("project-lock-test"),
      title: "Private thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      locked: false,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("thread lock decider", (it) => {
  it.effect("projects lock state through the existing metadata event", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.lock.set",
          commandId: CommandId.make("lock-command"),
          threadId: ThreadId.make("thread-lock-test"),
          locked: true,
          createdAt: NOW,
        },
        readModel,
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      expect(event.payload).toMatchObject({
        threadId: ThreadId.make("thread-lock-test"),
        locked: true,
        updatedAt: NOW,
      });
    }),
  );

  it.effect("is idempotent when the requested lock state already matches", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.lock.set",
          commandId: CommandId.make("lock-command-again"),
          threadId: ThreadId.make("thread-lock-test"),
          locked: true,
          createdAt: NOW,
        },
        readModel: {
          ...readModel,
          threads: readModel.threads.map((thread) => ({ ...thread, locked: true })),
        },
      });
      expect(result).toEqual([]);
    }),
  );
});
