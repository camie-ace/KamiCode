import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ClientOrchestrationCommand,
  MediaArtifact,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  PROVIDER_SEND_TURN_MAX_VIDEO_BYTES,
  ProjectCreateCommand,
  ThreadMetaUpdatedPayload,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFullThreadDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFullThreadDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const encodeThreadCreatedPayload = Schema.encodeEffect(ThreadCreatedPayload);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeClientOrchestrationCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeChatAttachment = Schema.decodeUnknownEffect(ChatAttachment);
const decodeMediaArtifact = Schema.decodeUnknownEffect(MediaArtifact);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("parses turn diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("parses full thread diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeFullThreadDiffInput({
      threadId: "thread-1",
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "codex");
    assert.deepStrictEqual(parsed.testEnvironments ?? [], []);
  }),
);

it.effect("decodes project test environments", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      testEnvironments: [
        {
          id: "local",
          name: "Local dev",
          kind: "local",
          baseUrl: "http://localhost:3000",
          isDefault: true,
        },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.testEnvironments, [
      {
        id: "local",
        name: "Local dev",
        kind: "local",
        baseUrl: "http://localhost:3000",
        isDefault: true,
      },
    ]);
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts test interaction mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-test",
      threadId: "thread-1",
      message: {
        messageId: "msg-test",
        role: "user",
        text: "test the last feature",
        attachments: [],
      },
      interactionMode: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.interactionMode, "test");
  }),
);

it.effect("accepts existing image chat attachment metadata", () =>
  Effect.gen(function* () {
    const image = yield* decodeChatAttachment({
      type: "image",
      id: "thread-1-image",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    });

    assert.strictEqual(image.type, "image");
    assert.strictEqual(image.name, "screenshot.png");
    assert.strictEqual(image.mimeType, "image/png");
  }),
);

it.effect("accepts non-image chat attachment metadata", () =>
  Effect.gen(function* () {
    const gif = yield* decodeChatAttachment({
      type: "gif",
      id: "thread-1-gif",
      name: "clip.gif",
      mimeType: "image/gif",
      sizeBytes: 1024,
      width: 320,
      height: 180,
    });
    const video = yield* decodeChatAttachment({
      type: "video",
      id: "thread-1-video",
      name: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      width: 1280,
      height: 720,
      durationMs: 12_000,
    });
    const file = yield* decodeChatAttachment({
      type: "file",
      id: "thread-1-file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 512,
    });

    assert.strictEqual(gif.type, "gif");
    assert.strictEqual(video.type, "video");
    if (video.type !== "video") {
      return;
    }
    assert.strictEqual(video.durationMs, 12_000);
    assert.strictEqual(file.mimeType, "text/plain");
  }),
);

it.effect("accepts durable video media artifact metadata", () =>
  Effect.gen(function* () {
    const artifact = yield* decodeMediaArtifact({
      id: "media-demo-video",
      kind: "video",
      source: "local",
      title: "demo.mp4",
      extension: "mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      width: 1280,
      height: 720,
      durationMs: 12_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      origin: "attached",
    });

    assert.strictEqual(artifact.kind, "video");
    assert.strictEqual(artifact.extension, "mp4");
    assert.strictEqual(artifact.durationMs, 12_000);
  }),
);

it.effect("rejects video attachment metadata above the video limit", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeChatAttachment({
        type: "video",
        id: "thread-1-video-too-large",
        name: "huge.mp4",
        mimeType: "video/mp4",
        sizeBytes: PROVIDER_SEND_TURN_MAX_VIDEO_BYTES + 1,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts uploaded video and file attachments in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-media",
      threadId: "thread-1",
      message: {
        messageId: "msg-media",
        role: "user",
        text: "inspect media",
        attachments: [
          {
            type: "video",
            name: "demo.mp4",
            mimeType: "video/mp4",
            sizeBytes: 12,
            dataUrl: "data:video/mp4;base64,SGVsbG8=",
            durationMs: 1000,
          },
          {
            type: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            dataUrl: "data:text/plain;base64,SGVsbG8=",
          },
        ],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "thread.turn.start");
    if (parsed.type !== "thread.turn.start") {
      return;
    }
    assert.strictEqual(parsed.message.attachments[0]?.type, "video");
    assert.strictEqual(parsed.message.attachments[1]?.type, "file");
  }),
);

it.effect("accepts client-dispatched thread activity append commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.activity.append",
      commandId: "cmd-workflow-activity",
      threadId: "thread-workflow",
      activity: {
        id: "activity-workflow-guidance",
        tone: "info",
        kind: "workflow.lane.guidance",
        summary: "Guidance added to Builder",
        payload: {
          laneId: "workflow-agent-2-builder",
          laneRole: "Builder",
          guidance: "Use the existing API boundary.",
        },
        turnId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.activity.append");
    if (parsed.type !== "thread.activity.append") {
      return;
    }
    assert.strictEqual(parsed.activity.kind, "workflow.lane.guidance");
  }),
);

it.effect("accepts client-dispatched workflow record commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-record",
      threadId: "thread-workflow",
      kind: "workflow.lane.control",
      summary: "Pause requested for Builder",
      payload: {
        laneId: "workflow-agent-2-builder",
        laneRole: "Builder",
        action: "pause",
        preserved: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.workflow.record");
    if (parsed.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(parsed.kind, "workflow.lane.control");
  }),
);

it.effect("requires explicit launch config on planned workflow sub-agents", () =>
  Effect.gen(function* () {
    const plannedPayload = {
      goal: "Build the billing UI",
      launchStatus: "planned",
      workflowPattern: "Build + Review",
      initialLanes: ["Lead", "Builder", "Verifier"],
      subAgents: [
        {
          id: "workflow-agent-1-builder",
          role: "Builder",
          goal: "Implement the approved UI scope.",
          prompt: "Build the UI and hand changed files back to the Lead.",
          model: "Use lead default",
          reasoningEffort: "Use lead default",
          fastMode: false,
          startsAfter: [],
        },
        {
          id: "workflow-agent-2-verifier",
          role: "Verifier",
          goal: "Verify the builder output.",
          prompt: "Run checks and report pass/fail evidence.",
          model: "Use lead default",
          reasoningEffort: "high",
          fastMode: false,
          startsAfter: ["workflow-agent-1-builder"],
        },
      ],
      acceptanceCriteria: ["The UI matches the request."],
      requireVerifierApproval: true,
      addRedTeamCritique: false,
      requireTestsBeforeFinal: true,
      showMemoryAuditNotes: true,
      exploreParallelApproaches: false,
      stopAfterPlanningForApproval: false,
    } as const;

    const accepted = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-planned",
      threadId: "thread-workflow",
      kind: "workflow.planned",
      summary: "Workflow plan drafted",
      payload: plannedPayload,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(accepted.type, "thread.workflow.record");
    if (accepted.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(accepted.kind, "workflow.planned");

    const missingModel = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-planned-missing-model",
        threadId: "thread-workflow",
        kind: "workflow.planned",
        summary: "Workflow plan missing model config",
        payload: {
          ...plannedPayload,
          subAgents: [
            {
              id: "workflow-agent-1-builder",
              role: "Builder",
              goal: "Implement the approved UI scope.",
              prompt: "Build the UI and hand changed files back to the Lead.",
              reasoningEffort: "Use lead default",
              fastMode: false,
              startsAfter: [],
            },
          ],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(missingModel._tag, "Failure");

    const missingDependency = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-planned-missing-dependency",
        threadId: "thread-workflow",
        kind: "workflow.planned",
        summary: "Workflow plan has an unknown dependency",
        payload: {
          ...plannedPayload,
          subAgents: [
            {
              ...plannedPayload.subAgents[0],
              startsAfter: ["workflow-agent-missing"],
            },
          ],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(missingDependency._tag, "Failure");
  }),
);

it.effect("requires workflow starts to carry approved sub-agent plans", () =>
  Effect.gen(function* () {
    const accepted = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-started",
      threadId: "thread-workflow",
      kind: "workflow.started",
      summary: "Workflow started",
      payload: {
        goal: "Build the billing UI",
        launchStatus: "started",
        subAgents: [
          {
            id: "workflow-agent-1-builder",
            role: "Builder",
            goal: "Implement the approved UI scope.",
            prompt: "Build the UI and hand changed files back to the Lead.",
            model: "Use lead default",
            reasoningEffort: "Use lead default",
            fastMode: false,
            startsAfter: [],
          },
        ],
        acceptanceCriteria: ["The UI matches the request."],
        startedFromActivityId: "event-workflow-planned",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(accepted.type, "thread.workflow.record");
    if (accepted.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(accepted.kind, "workflow.started");

    const rejected = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-started-missing-subagents",
        threadId: "thread-workflow",
        kind: "workflow.started",
        summary: "Workflow started without the approved plan",
        payload: {
          goal: "Build the billing UI",
          launchStatus: "started",
          acceptanceCriteria: ["The UI matches the request."],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(rejected._tag, "Failure");
  }),
);

it.effect("requires lane starts to link child threads and decodes lifecycle metadata", () =>
  Effect.gen(function* () {
    const started = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-lane-started",
      threadId: "thread-workflow",
      kind: "workflow.lane.started",
      summary: "UI Builder launched",
      payload: {
        laneId: "workflow-agent-ui-builder",
        laneRole: "UI Builder",
        childThreadId: "thread-workflow-child-builder",
        childTurnMessageId: "msg-workflow-child-builder",
        childTurnRequestedAt: "2026-01-01T00:00:01.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(started.type, "thread.workflow.record");
    if (started.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(started.kind, "workflow.lane.started");
    if (started.kind !== "workflow.lane.started") {
      return;
    }
    assert.strictEqual(started.payload.childThreadId, "thread-workflow-child-builder");
    assert.strictEqual(started.payload.childTurnMessageId, "msg-workflow-child-builder");
    assert.strictEqual(started.payload.childTurnRequestedAt, "2026-01-01T00:00:01.000Z");

    const fakeStarted = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-lane-started-fake",
        threadId: "thread-workflow",
        kind: "workflow.lane.started",
        summary: "Fake UI Builder launched",
        payload: {
          laneId: "workflow-agent-ui-builder",
          laneRole: "UI Builder",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(fakeStarted._tag, "Failure");

    const missingTurnMessageId = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-lane-started-missing-message",
        threadId: "thread-workflow",
        kind: "workflow.lane.started",
        summary: "UI Builder launched without turn message metadata",
        payload: {
          laneId: "workflow-agent-ui-builder",
          laneRole: "UI Builder",
          childThreadId: "thread-workflow-child-builder",
          childTurnRequestedAt: "2026-01-01T00:00:01.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(missingTurnMessageId._tag, "Failure");

    const missingTurnRequestedAt = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-lane-started-missing-requested-at",
        threadId: "thread-workflow",
        kind: "workflow.lane.started",
        summary: "UI Builder launched without turn request metadata",
        payload: {
          laneId: "workflow-agent-ui-builder",
          laneRole: "UI Builder",
          childThreadId: "thread-workflow-child-builder",
          childTurnMessageId: "msg-workflow-child-builder",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(missingTurnRequestedAt._tag, "Failure");

    const completed = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-lane-completed",
      threadId: "thread-workflow",
      kind: "workflow.lane.completed",
      summary: "UI Builder completed",
      payload: {
        laneId: "workflow-agent-ui-builder",
        laneRole: "UI Builder",
        childThreadId: "thread-workflow-child-builder",
        childTurnId: "turn-workflow-child-builder",
        sourceStartedActivityId: "event-workflow-lane-started",
        filesTouched: ["apps/web/src/components/PlanSidebar.tsx"],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(completed.type, "thread.workflow.record");
    if (completed.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(completed.kind, "workflow.lane.completed");
    if (completed.kind !== "workflow.lane.completed") {
      return;
    }
    assert.strictEqual(completed.payload.childThreadId, "thread-workflow-child-builder");
    assert.strictEqual(completed.payload.childTurnId, "turn-workflow-child-builder");
    assert.strictEqual(completed.payload.sourceStartedActivityId, "event-workflow-lane-started");

    const handoff = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-handoff",
      threadId: "thread-workflow",
      kind: "workflow.handoff",
      summary: "UI Builder handed off to Verifier",
      payload: {
        laneId: "workflow-agent-ui-builder",
        laneRole: "UI Builder",
        childThreadId: "thread-workflow-child-builder",
        childTurnId: "turn-workflow-child-builder",
        sourceStartedActivityId: "event-workflow-lane-started",
        filesTouched: ["apps/web/src/components/PlanSidebar.tsx"],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(handoff.type, "thread.workflow.record");
    if (handoff.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(handoff.kind, "workflow.handoff");
    if (handoff.kind !== "workflow.handoff") {
      return;
    }
    assert.strictEqual(handoff.payload.childThreadId, "thread-workflow-child-builder");
    assert.strictEqual(handoff.payload.childTurnId, "turn-workflow-child-builder");
    assert.strictEqual(handoff.payload.sourceStartedActivityId, "event-workflow-lane-started");

    const nonChildCompleted = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-lane-completed-non-child",
      threadId: "thread-workflow",
      kind: "workflow.lane.completed",
      summary: "Research lane completed",
      payload: {
        laneId: "workflow-agent-research",
        laneRole: "Research",
        filesTouched: ["docs/workflows/Workflow.md"],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(nonChildCompleted.type, "thread.workflow.record");
    if (nonChildCompleted.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(nonChildCompleted.kind, "workflow.lane.completed");

    const nonChildHandoff = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-handoff-non-child",
      threadId: "thread-workflow",
      kind: "workflow.handoff",
      summary: "Research lane handed off",
      payload: {
        laneId: "workflow-agent-research",
        laneRole: "Research",
        knownRisks: ["No child-thread session was launched for this lane."],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(nonChildHandoff.type, "thread.workflow.record");
    if (nonChildHandoff.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(nonChildHandoff.kind, "workflow.handoff");

    const blocked = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-lane-blocked",
      threadId: "thread-workflow",
      kind: "workflow.lane.blocked",
      summary: "Verifier blocked on missing evidence",
      payload: {
        laneId: "workflow-agent-verifier",
        laneRole: "Verifier",
        reason: "Waiting for shared test evidence.",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(blocked.type, "thread.workflow.record");
    if (blocked.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(blocked.kind, "workflow.lane.blocked");
  }),
);

it.effect("requires laneId for workflow verifier results", () =>
  Effect.gen(function* () {
    const accepted = yield* decodeClientOrchestrationCommand({
      type: "thread.workflow.record",
      commandId: "cmd-workflow-verifier-result",
      threadId: "thread-workflow",
      kind: "workflow.verifier.result",
      summary: "Verifier accepted the builder output",
      payload: {
        laneId: "workflow-agent-verifier",
        laneRole: "Verifier",
        status: "passed",
        passed: ["Responsive checks passed."],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(accepted.type, "thread.workflow.record");
    if (accepted.type !== "thread.workflow.record") {
      return;
    }
    assert.strictEqual(accepted.kind, "workflow.verifier.result");

    const rejected = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.workflow.record",
        commandId: "cmd-workflow-verifier-result-missing-lane",
        threadId: "thread-workflow",
        kind: "workflow.verifier.result",
        summary: "Verifier result missing lane targeting",
        payload: {
          status: "failed",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(rejected._tag, "Failure");
  }),
);

it.effect("accepts workflow interaction mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-workflow",
      threadId: "thread-1",
      message: {
        messageId: "msg-workflow",
        role: "user",
        text: "coordinate implementation and verification",
        attachments: [],
      },
      interactionMode: "workflow",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.interactionMode, "workflow");
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
          startFromOrigin: true,
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.startFromOrigin, true);
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.instanceId, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    if (archived.type !== "thread.archived") {
      assert.fail(`Expected thread.archived event, received ${archived.type}.`);
    }
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "reasoningEffort"), "high");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "fastMode"), true);
  }),
);

it.effect("normalizes legacy object-shaped modelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Legacy options thread",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,
          // Falsy/garbage entries are dropped, matching migration 026.
          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      },
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.modelSelection.instanceId, ProviderInstanceId.make("claudeAgent"));
    assert.deepStrictEqual(parsed.modelSelection.options, [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ]);
  }),
);

it.effect("normalizes legacy object-shaped defaultModelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Legacy default project",
      workspaceRoot: "/tmp/legacy",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
        options: { reasoningEffort: "low" },
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(parsed.defaultModelSelection?.options, [
      { id: "reasoningEffort", value: "low" },
    ]);
  }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeThreadCreatedPayload({
        threadId: "thread-1",
        projectId: "project-1",
        title: "Round trip thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: true },
        },
        branch: null,
        worktreePath: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const encoded = yield* encodeThreadCreatedPayload(decoded);
      assert.deepStrictEqual(encoded.modelSelection.options, [{ id: "fastMode", value: true }]);
    }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

// ── ModelSelection: instance-keyed wire shape + legacy decoder ────────
//
// `ModelSelection` is routing-keyed on `instanceId` — never a driver kind.
// Persisted and in-flight payloads from pre-instance builds carry a
// `provider` field whose value was a driver kind; those payloads are migrated
// at the wire boundary by
// promoting `provider` to the default instance id for that driver
// (built-in drivers use the driver kind slug as their default instance id, so
// the migration is a 1:1 rename).
//
// These tests pin the rollback/fork tolerance invariant: legacy payloads
// decode cleanly for fork-provided drivers, and the decoded form uses
// `instanceId` uniformly regardless of origin.

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection accepts an explicit instanceId routing key", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect("ModelSelection encodes to the canonical instanceId wire form", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeModelSelection({
      provider: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
    const encoded = yield* encodeModelSelection(decoded);
    assert.deepStrictEqual(encoded, {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
  }),
);

it.effect("ModelSelection rejects malformed instance ids", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeModelSelection({
        instanceId: "1invalid", // must start with a letter
        model: "x",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
