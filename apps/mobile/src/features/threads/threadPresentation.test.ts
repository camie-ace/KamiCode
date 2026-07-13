import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProjectTriggerId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadStatus } from "./threadPresentation";

function makeThread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Triggered thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "trigger",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("resolveThreadStatus", () => {
  it("keeps trigger provenance visible after the run settles", () => {
    expect(
      resolveThreadStatus(
        makeThread({
          startedBy: {
            kind: "trigger",
            triggerId: ProjectTriggerId.make("trigger-1"),
            triggerName: "Morning check",
            eventKind: "cron",
            firedAt: "2026-07-13T00:00:00.000Z",
          },
        }),
      ),
    ).toMatchObject({ kind: "triggered", label: "Triggered", pulse: false });
  });

  it("keeps actionable states above provenance", () => {
    expect(
      resolveThreadStatus(
        makeThread({
          hasPendingApprovals: true,
          startedBy: {
            kind: "trigger",
            triggerId: ProjectTriggerId.make("trigger-1"),
            triggerName: "Morning check",
            eventKind: "cron",
            firedAt: "2026-07-13T00:00:00.000Z",
          },
        }),
      )?.kind,
    ).toBe("pending-approval");
  });
});
