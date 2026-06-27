import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThreadActivity,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type DecidedTestEvent = Omit<OrchestrationEvent, "sequence">;
type DecidedTestResult = DecidedTestEvent | ReadonlyArray<DecidedTestEvent>;
type DecidedThreadActivityAppendedEvent = DecidedTestEvent & {
  readonly type: "thread.activity-appended";
  readonly payload: {
    readonly activity: OrchestrationThreadActivity;
  };
};

function decidedEvents(result: DecidedTestResult): ReadonlyArray<DecidedTestEvent> {
  return Array.isArray(result) ? result : [result as DecidedTestEvent];
}

function isThreadActivityAppendedEvent(
  event: DecidedTestEvent,
): event is DecidedThreadActivityAppendedEvent {
  return event.type === "thread.activity-appended";
}

function isWorkflowPlannedEvent(
  event: DecidedTestEvent,
): event is DecidedThreadActivityAppendedEvent {
  if (!isThreadActivityAppendedEvent(event)) return false;
  return (event as DecidedThreadActivityAppendedEvent).payload.activity.kind === "workflow.planned";
}

function workflowPlannedActivities(readModel: OrchestrationReadModel, threadId: ThreadId) {
  return (
    readModel.threads
      .find((thread) => thread.id === threadId)
      ?.activities.filter((activity) => activity.kind === "workflow.planned") ?? []
  );
}

function createWorkflowThreadReadModel({
  now,
  projectId,
  threadId,
}: {
  readonly now: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  return Effect.gen(function* () {
    const initial = createEmptyReadModel(now);
    const withProject = yield* projectEvent(initial, {
      sequence: 1,
      eventId: asEventId(`evt-project-create-${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.make(`cmd-project-create-${projectId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-project-create-${projectId}`),
      metadata: {},
      payload: {
        projectId,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    return yield* projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId(`evt-thread-create-${threadId}`),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.make(`cmd-thread-create-${threadId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-thread-create-${threadId}`),
      metadata: {},
      payload: {
        threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: "workflow",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  });
}

function projectDecidedEvents(readModel: OrchestrationReadModel, result: DecidedTestResult) {
  return Effect.gen(function* () {
    let nextReadModel = readModel;
    let nextSequence = readModel.snapshotSequence;
    for (const event of decidedEvents(result)) {
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...event,
        sequence: nextSequence,
      } as OrchestrationEvent);
    }
    return nextReadModel;
  });
}

it.layer(NodeServices.layer)("decider project scripts", (it) => {
  it.effect("emits empty scripts on project.create", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const readModel = createEmptyReadModel(now);

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.make("cmd-project-create-scripts"),
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          createdAt: now,
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.created");
      expect((event.payload as { scripts: unknown[] }).scripts).toEqual([]);
    }),
  );

  it.effect("propagates scripts in project.meta.update payload", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const readModel = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-scripts"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-scripts"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create-scripts"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create-scripts"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const scripts = [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ] as const;

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-update-scripts"),
          projectId: asProjectId("project-scripts"),
          scripts: Array.from(scripts),
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.meta-updated");
      expect((event.payload as { scripts?: unknown[] }).scripts).toEqual(scripts);
    }),
  );

  it.effect("emits user message and turn-start-requested events for thread.turn.start", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: true },
          ]),
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("thread.message-sent");
      const turnStartEvent = events[1];
      expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
      expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
      if (turnStartEvent?.type !== "thread.turn-start-requested") {
        return;
      }
      expect(turnStartEvent.payload).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("message-user-1"),
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ]),
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      });
    }),
  );

  it.effect("uses the submitted interaction mode when starting a turn", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-workflow"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("message-user-workflow"),
            role: "user",
            text: "coordinate this",
            attachments: [],
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModel,
      });

      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(3);
      const turnStartEvent = events.find((event) => event.type === "thread.turn-start-requested");
      expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
      if (turnStartEvent?.type !== "thread.turn-start-requested") {
        return;
      }
      expect(turnStartEvent.payload.interactionMode).toBe("workflow");
      expect(turnStartEvent.payload.runtimeMode).toBe("full-access");
      const workflowPlannedEvent = events.find(
        (event) => event.type === "thread.activity-appended",
      );
      expect(workflowPlannedEvent?.type).toBe("thread.activity-appended");
      if (workflowPlannedEvent?.type !== "thread.activity-appended") {
        return;
      }
      expect(workflowPlannedEvent.causationEventId).toBe(turnStartEvent.eventId);
      expect(workflowPlannedEvent.payload.activity.kind).toBe("workflow.planned");
      expect(workflowPlannedEvent.payload.activity.summary).toBe("Workflow plan drafted");
      expect(workflowPlannedEvent.payload.activity.payload).toMatchObject({
        goal: "coordinate this",
        launchStatus: "planned",
        workflowPattern: "Build + Review",
        initialLanes: ["Lead", "Planner", "Builder", "Verifier"],
        subAgents: expect.arrayContaining([
          expect.objectContaining({
            id: "workflow-agent-2-builder",
            role: "Builder",
            goal: "Implement the approved scope.",
            prompt:
              "Implement the approved scope, preserve predictable behavior, and prepare a handoff with changed files and risks.",
            model: "Use lead default",
            reasoningEffort: "Use lead default",
            fastMode: false,
          }),
          expect.objectContaining({
            id: "workflow-agent-3-verifier",
            role: "Verifier",
            goal: "Verify the implementation, capture evidence, and block false completion.",
            prompt:
              "Run the agreed checks, capture pass/fail evidence, and route blocking fixes back to the Lead.",
            model: "Use lead default",
            reasoningEffort: "high",
            fastMode: false,
            startsAfter: ["workflow-agent-2-builder"],
          }),
        ]),
        requireVerifierApproval: true,
        showMemoryAuditNotes: true,
      });
    }),
  );

  it.effect("does not append workflow.planned for runtime workflow follow-up prompts", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = asProjectId("project-workflow-runtime-prompts");
      const threadId = asThreadId("thread-workflow-runtime-prompts");
      const readModel = yield* createWorkflowThreadReadModel({
        now,
        projectId,
        threadId,
      });

      const initialResult = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-workflow-runtime-initial"),
          threadId,
          message: {
            messageId: asMessageId("message-workflow-runtime-initial"),
            role: "user",
            text: "Build the billing UI, wire the backend API, and verify it.",
            attachments: [],
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModel,
      });
      const initialEvents = decidedEvents(initialResult);
      expect(initialEvents.filter(isWorkflowPlannedEvent)).toHaveLength(1);
      const initialPlanEvent = initialEvents.find(isWorkflowPlannedEvent);
      expect(initialPlanEvent?.type).toBe("thread.activity-appended");
      const plannedReadModel = yield* projectDecidedEvents(readModel, initialResult);

      const runtimePrompts = [
        {
          commandId: "cmd-workflow-runtime-start",
          messageId: "message-workflow-runtime-start",
          text: [
            "Start the approved workflow now.",
            "Use Workflow.md as the Lead operating contract and inject sub-agents.md only into sub-agent sessions as they are launched, not before.",
          ].join("\n\n"),
        },
        {
          commandId: "cmd-workflow-runtime-guidance",
          messageId: "message-workflow-runtime-guidance",
          text: [
            "Workflow guidance for Builder. Re-trigger this sub-agent lane with the new instruction:",
            "Use the existing billing components before adding new primitives.",
          ].join("\n"),
        },
        {
          commandId: "cmd-workflow-runtime-control",
          messageId: "message-workflow-runtime-control",
          text: [
            "Pause the Builder lane at the next safe point. Preserve current state, findings, artifacts, and open questions.",
            "Keep the instruction Lead-visible, preserve the lane history, and update the workflow panel with the result.",
          ].join("\n"),
        },
      ] as const;

      for (const runtimePrompt of runtimePrompts) {
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make(runtimePrompt.commandId),
            threadId,
            message: {
              messageId: asMessageId(runtimePrompt.messageId),
              role: "user",
              text: runtimePrompt.text,
              attachments: [],
            },
            interactionMode: "workflow",
            runtimeMode: "full-access",
            createdAt: now,
          },
          readModel: plannedReadModel,
        });

        const events = decidedEvents(result);
        expect(events).toHaveLength(2);
        expect(events.map((event) => event.type)).toEqual([
          "thread.message-sent",
          "thread.turn-start-requested",
        ]);
        expect(events.filter(isWorkflowPlannedEvent)).toHaveLength(0);

        const afterRuntimeReadModel = yield* projectDecidedEvents(plannedReadModel, result);
        const plannedActivities = workflowPlannedActivities(afterRuntimeReadModel, threadId);
        expect(plannedActivities).toHaveLength(1);
        expect(plannedActivities[0]?.id).toBe(
          initialPlanEvent?.type === "thread.activity-appended"
            ? initialPlanEvent.payload.activity.id
            : undefined,
        );
      }
    }),
  );

  it.effect(
    "does not append workflow.planned for main-chat customization after a draft exists",
    () =>
      Effect.gen(function* () {
        const now = "2026-01-01T00:00:00.000Z";
        const projectId = asProjectId("project-workflow-customization-follow-up");
        const threadId = asThreadId("thread-workflow-customization-follow-up");
        const readModel = yield* createWorkflowThreadReadModel({
          now,
          projectId,
          threadId,
        });

        const initialResult = yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-workflow-customization-initial"),
            threadId,
            message: {
              messageId: asMessageId("message-workflow-customization-initial"),
              role: "user",
              text: "Build the billing UI, wire the backend API, and verify it.",
              attachments: [],
            },
            interactionMode: "workflow",
            runtimeMode: "full-access",
            createdAt: now,
          },
          readModel,
        });
        const initialPlanEvent = decidedEvents(initialResult).find(isWorkflowPlannedEvent);
        expect(initialPlanEvent?.type).toBe("thread.activity-appended");
        const plannedReadModel = yield* projectDecidedEvents(readModel, initialResult);

        const customizationResult = yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-workflow-customization-follow-up"),
            threadId,
            message: {
              messageId: asMessageId("message-workflow-customization-follow-up"),
              role: "user",
              text: "Before launch, add a Critic lane with high reasoning and make Verifier start after Critic.",
              attachments: [],
            },
            interactionMode: "workflow",
            runtimeMode: "full-access",
            createdAt: now,
          },
          readModel: plannedReadModel,
        });

        const events = decidedEvents(customizationResult);
        expect(events).toHaveLength(2);
        expect(events.filter(isWorkflowPlannedEvent)).toHaveLength(0);

        const afterCustomizationReadModel = yield* projectDecidedEvents(
          plannedReadModel,
          customizationResult,
        );
        const plannedActivities = workflowPlannedActivities(afterCustomizationReadModel, threadId);
        expect(plannedActivities).toHaveLength(1);
        expect(plannedActivities[0]?.id).toBe(
          initialPlanEvent?.type === "thread.activity-appended"
            ? initialPlanEvent.payload.activity.id
            : undefined,
        );
      }),
  );

  it.effect(
    "does not synthesize workflow.planned for runtime workflow prompts without a draft",
    () =>
      Effect.gen(function* () {
        const now = "2026-01-01T00:00:00.000Z";
        const projectId = asProjectId("project-workflow-runtime-no-draft");
        const threadId = asThreadId("thread-workflow-runtime-no-draft");
        const readModel = yield* createWorkflowThreadReadModel({
          now,
          projectId,
          threadId,
        });

        const runtimePrompts = [
          {
            commandId: "cmd-workflow-no-draft-start",
            messageId: "message-workflow-no-draft-start",
            text: "Start the approved workflow now.",
          },
          {
            commandId: "cmd-workflow-no-draft-launch",
            messageId: "message-workflow-no-draft-launch",
            text: "Launch the approved workflow now.",
          },
          {
            commandId: "cmd-workflow-no-draft-guidance",
            messageId: "message-workflow-no-draft-guidance",
            text: "Workflow guidance for Builder. Re-trigger this sub-agent lane with the new instruction:\nUse the existing billing components.",
          },
          {
            commandId: "cmd-workflow-no-draft-control",
            messageId: "message-workflow-no-draft-control",
            text: "Apply workflow control: pause the workflow and preserve current state.",
          },
          {
            commandId: "cmd-workflow-no-draft-recorded-follow-up",
            messageId: "message-workflow-no-draft-recorded-follow-up",
            text: "Workflow customization updated from the workflow panel.",
          },
        ] as const;

        for (const runtimePrompt of runtimePrompts) {
          const result = yield* decideOrchestrationCommand({
            command: {
              type: "thread.turn.start",
              commandId: CommandId.make(runtimePrompt.commandId),
              threadId,
              message: {
                messageId: asMessageId(runtimePrompt.messageId),
                role: "user",
                text: runtimePrompt.text,
                attachments: [],
              },
              interactionMode: "workflow",
              runtimeMode: "full-access",
              createdAt: now,
            },
            readModel,
          });

          const events = decidedEvents(result);
          expect(events).toHaveLength(2);
          expect(events.filter(isWorkflowPlannedEvent)).toHaveLength(0);
        }
      }),
  );

  it.effect("does not append workflow.planned after workflow launch activity exists", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = asProjectId("project-workflow-launched");
      const threadId = asThreadId("thread-workflow-launched");
      const readModel = yield* createWorkflowThreadReadModel({
        now,
        projectId,
        threadId,
      });

      const initialResult = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-workflow-launched-initial"),
          threadId,
          message: {
            messageId: asMessageId("message-workflow-launched-initial"),
            role: "user",
            text: "Build the billing UI, wire the backend API, and verify it.",
            attachments: [],
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModel,
      });
      const initialPlanEvent = decidedEvents(initialResult).find(isWorkflowPlannedEvent);
      expect(initialPlanEvent?.type).toBe("thread.activity-appended");
      const plannedReadModel = yield* projectDecidedEvents(readModel, initialResult);
      const launchedReadModel = yield* projectEvent(plannedReadModel, {
        sequence: plannedReadModel.snapshotSequence + 1,
        eventId: asEventId("evt-workflow-launched"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.activity-appended",
        occurredAt: now,
        commandId: CommandId.make("cmd-workflow-launched"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-workflow-launched"),
        metadata: {},
        payload: {
          threadId,
          activity: {
            id: asEventId("activity-workflow-launched"),
            tone: "info",
            kind: "workflow.started",
            summary: "Workflow started",
            payload: {},
            turnId: null,
            createdAt: now,
          },
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-workflow-launched-continue"),
          threadId,
          message: {
            messageId: asMessageId("message-workflow-launched-continue"),
            role: "user",
            text: "Continue coordinating the remaining implementation lanes.",
            attachments: [],
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModel: launchedReadModel,
      });

      const events = decidedEvents(result);
      expect(events).toHaveLength(2);
      expect(events.filter(isWorkflowPlannedEvent)).toHaveLength(0);

      const afterPostLaunchTurnReadModel = yield* projectDecidedEvents(launchedReadModel, result);
      const plannedActivities = workflowPlannedActivities(afterPostLaunchTurnReadModel, threadId);
      expect(plannedActivities).toHaveLength(1);
      expect(plannedActivities[0]?.id).toBe(
        initialPlanEvent?.type === "thread.activity-appended"
          ? initialPlanEvent.payload.activity.id
          : undefined,
      );
      expect(plannedActivities[0]?.payload).toEqual(
        initialPlanEvent?.type === "thread.activity-appended"
          ? initialPlanEvent.payload.activity.payload
          : undefined,
      );
    }),
  );

  it.effect("plans dynamic workflow agents from the requested work shape", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-dynamic"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-dynamic"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create-dynamic"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create-dynamic"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-dynamic"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-dynamic"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-dynamic"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create-dynamic"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create-dynamic"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-dynamic"),
          projectId: asProjectId("project-dynamic"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-workflow-dynamic"),
          threadId: ThreadId.make("thread-dynamic"),
          message: {
            messageId: asMessageId("message-user-workflow-dynamic"),
            role: "user",
            text: "Build the billing UI, wire the API, and verify responsive behavior.",
            attachments: [],
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModel,
      });

      const events = Array.isArray(result) ? result : [result];
      const workflowPlannedEvent = events.find(
        (event) => event.type === "thread.activity-appended",
      );
      expect(workflowPlannedEvent?.type).toBe("thread.activity-appended");
      if (workflowPlannedEvent?.type !== "thread.activity-appended") {
        return;
      }
      const payload = workflowPlannedEvent.payload.activity.payload as {
        initialLanes: string[];
        subAgents: Array<{
          id: string;
          role: string;
          goal: string;
          prompt: string;
          model: string;
          reasoningEffort: string;
          fastMode: boolean;
          startsAfter: string[];
        }>;
      };
      expect(payload.initialLanes).toEqual([
        "Lead",
        "Planner",
        "UI Builder",
        "Backend Builder",
        "Verifier",
      ]);
      expect(payload.subAgents.map((agent) => agent.role)).toEqual([
        "Planner",
        "UI Builder",
        "Backend Builder",
        "Verifier",
      ]);
      expect(payload.subAgents.some((agent) => agent.role === "Builder")).toBe(false);
      expect(
        payload.subAgents.every(
          (agent) =>
            agent.id.startsWith("workflow-agent-") &&
            agent.goal.length > 0 &&
            agent.prompt.length > 0 &&
            agent.model.length > 0 &&
            agent.reasoningEffort.length > 0 &&
            typeof agent.fastMode === "boolean" &&
            agent.startsAfter.every((dependencyId) =>
              payload.subAgents.some((entry) => entry.id === dependencyId),
            ),
        ),
      ).toBe(true);
      const planner = payload.subAgents.find((agent) => agent.role === "Planner");
      const uiBuilder = payload.subAgents.find((agent) => agent.role === "UI Builder");
      const backendBuilder = payload.subAgents.find((agent) => agent.role === "Backend Builder");
      const verifier = payload.subAgents.find((agent) => agent.role === "Verifier");

      expect(planner).toMatchObject({
        id: "workflow-agent-1-planner",
        goal: "Turn the user goal into an executable workflow plan and acceptance criteria.",
        model: "Use lead default",
        reasoningEffort: "high",
        fastMode: false,
        startsAfter: [],
      });
      expect(uiBuilder).toMatchObject({
        id: "workflow-agent-2-ui-builder",
        goal: expect.stringContaining("user-facing"),
        model: "Use lead default",
        reasoningEffort: "Use lead default",
        fastMode: false,
        startsAfter: ["workflow-agent-1-planner"],
      });
      expect(backendBuilder).toMatchObject({
        id: "workflow-agent-3-backend-builder",
        goal: expect.stringContaining("server"),
        model: "Use lead default",
        reasoningEffort: "Use lead default",
        fastMode: false,
        startsAfter: ["workflow-agent-1-planner"],
      });
      expect(verifier).toMatchObject({
        id: "workflow-agent-4-verifier",
        goal: expect.stringContaining("Verify"),
        model: "Use lead default",
        reasoningEffort: "high",
        fastMode: false,
        startsAfter: expect.arrayContaining([
          "workflow-agent-2-ui-builder",
          "workflow-agent-3-backend-builder",
        ]),
      });
    }),
  );

  it.effect("records workflow lifecycle commands as durable thread activities", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "workflow",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.workflow.record",
          commandId: CommandId.make("cmd-workflow-record"),
          threadId: ThreadId.make("thread-1"),
          kind: "workflow.lane.control",
          summary: "Pause requested for Builder",
          payload: {
            laneId: "workflow-agent-2-builder",
            laneRole: "Builder",
            action: "pause",
            preserved: true,
          },
          createdAt: now,
        },
        readModel,
      });

      const events = Array.isArray(result) ? result : [result];
      if (events.length !== 1) {
        throw new Error("Expected a single workflow activity event.");
      }
      const event = events[0];
      expect(event?.type).toBe("thread.activity-appended");
      if (event?.type !== "thread.activity-appended") {
        return;
      }
      expect(event.payload.activity.kind).toBe("workflow.lane.control");
      expect(event.payload.activity.summary).toBe("Pause requested for Builder");
      expect(event.payload.activity.payload).toMatchObject({
        laneId: "workflow-agent-2-builder",
        laneRole: "Builder",
        action: "pause",
        preserved: true,
      });
    }),
  );

  it.effect("emits thread.runtime-mode-set from thread.runtime-mode.set", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.runtime-mode.set",
          commandId: CommandId.make("cmd-runtime-mode-set"),
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      });

      const singleResult = Array.isArray(result) ? null : result;
      if (singleResult === null) {
        throw new Error("Expected a single runtime-mode-set event.");
      }
      expect(singleResult).toMatchObject({
        type: "thread.runtime-mode-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "approval-required",
        },
      });
    }),
  );

  it.effect("emits thread.interaction-mode-set from thread.interaction-mode.set", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("cmd-interaction-mode-set"),
          threadId: ThreadId.make("thread-1"),
          interactionMode: "plan",
          createdAt: now,
        },
        readModel,
      });

      const singleResult = Array.isArray(result) ? null : result;
      if (singleResult === null) {
        throw new Error("Expected a single interaction-mode-set event.");
      }
      expect(singleResult).toMatchObject({
        type: "thread.interaction-mode-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          interactionMode: "plan",
        },
      });
    }),
  );
});
