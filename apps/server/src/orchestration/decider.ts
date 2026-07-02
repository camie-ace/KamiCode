import {
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkflowPlannedPayload,
  type WorkflowSubAgentPlan,
} from "@t3tools/contracts";
import { DEFAULT_TURN_DISPATCH_POLICY } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  listThreadsByProjectId,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

type InferredWorkflowAgentDraft = {
  readonly role: string;
  readonly goal: string;
  readonly prompt: string;
  readonly startsAfterRoles: ReadonlyArray<string>;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly fastMode?: boolean;
};

const DEFAULT_WORKFLOW_AGENT_MODEL = "Use lead default";
const DEFAULT_WORKFLOW_AGENT_REASONING_EFFORT = "Use lead default";
const DEFAULT_WORKFLOW_AGENT_FAST_MODE = false;

function workflowAgentId(role: string, index: number): string {
  return `workflow-agent-${index + 1}-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function finalizeWorkflowSubAgents(
  drafts: ReadonlyArray<InferredWorkflowAgentDraft>,
): ReadonlyArray<WorkflowSubAgentPlan> {
  const roleToId = new Map(
    drafts.map((draft, index) => [draft.role, workflowAgentId(draft.role, index)]),
  );
  return drafts.map((draft, index) => ({
    id: workflowAgentId(draft.role, index),
    role: draft.role,
    goal: draft.goal,
    prompt: draft.prompt,
    model: draft.model ?? DEFAULT_WORKFLOW_AGENT_MODEL,
    reasoningEffort: draft.reasoningEffort ?? DEFAULT_WORKFLOW_AGENT_REASONING_EFFORT,
    fastMode: draft.fastMode ?? DEFAULT_WORKFLOW_AGENT_FAST_MODE,
    startsAfter: draft.startsAfterRoles.flatMap((role) => {
      const dependencyId = roleToId.get(role);
      return dependencyId ? [dependencyId] : [];
    }),
  }));
}

function inferWorkflowSubAgents(text: string): ReadonlyArray<WorkflowSubAgentPlan> {
  const lower = text.toLowerCase();
  const agents: InferredWorkflowAgentDraft[] = [];
  const pushAgent = (agent: InferredWorkflowAgentDraft) => {
    if (agents.some((entry) => entry.role.toLowerCase() === agent.role.toLowerCase())) {
      return;
    }
    agents.push(agent);
  };

  pushAgent({
    role: "Planner",
    goal: "Turn the user goal into an executable workflow plan and acceptance criteria.",
    prompt:
      "Interpret the user objective, define the workflow shape, write concrete acceptance criteria, and clarify sequencing. Do not implement yet.",
    startsAfterRoles: [],
    reasoningEffort: "high",
  });

  if (/\b(research|inspect|explore|compare|investigate|analyze)\b/.test(lower)) {
    pushAgent({
      role: "Researcher",
      goal: "Gather the relevant codebase and product context before implementation decisions.",
      prompt:
        "Inspect the codebase, docs, and relevant references. Return concise findings, risks, and recommendations to the Lead.",
      startsAfterRoles: ["Planner"],
      reasoningEffort: "high",
    });
  }

  if (/\b(ui|ux|frontend|client|react|css|layout|design|responsive)\b/.test(lower)) {
    pushAgent({
      role: "UI Builder",
      goal: "Implement the user-facing interface and interaction changes.",
      prompt:
        "Build the required UI or UX changes, preserve consistency with the existing product, and prepare a handoff with changed files and known risks.",
      startsAfterRoles: agents.some((entry) => entry.role === "Researcher")
        ? ["Researcher"]
        : ["Planner"],
      fastMode: false,
    });
  }

  if (/\b(api|backend|server|route|database|db|schema|migration|storage|auth)\b/.test(lower)) {
    pushAgent({
      role: "Backend Builder",
      goal: "Implement the server, API, or data-layer changes needed for the workflow.",
      prompt:
        "Implement the required backend or data-layer work, preserve predictable behavior, and prepare a handoff with changed files, tests, and known risks.",
      startsAfterRoles: agents.some((entry) => entry.role === "Researcher")
        ? ["Researcher"]
        : ["Planner"],
      fastMode: false,
    });
  }

  if (!agents.some((entry) => /\bbuilder\b/i.test(entry.role))) {
    pushAgent({
      role: "Builder",
      goal: "Implement the approved scope.",
      prompt:
        "Implement the approved scope, preserve predictable behavior, and prepare a handoff with changed files and risks.",
      startsAfterRoles: agents.some((entry) => entry.role === "Researcher")
        ? ["Researcher"]
        : ["Planner"],
      fastMode: false,
    });
  }

  if (/\b(doc|document|readme|notes?|memory)\b/.test(lower)) {
    pushAgent({
      role: "Documenter",
      goal: "Update durable documentation or project notes where the workflow outcome requires it.",
      prompt:
        "Update durable notes or documentation only where the workflow outcome requires it, then hand the changes back to the Lead.",
      startsAfterRoles: agents
        .filter((entry) => /\bbuilder\b/i.test(entry.role))
        .map((entry) => entry.role),
    });
  }

  if (/\b(red[- ]?team|critic|critique|risk|security|review)\b/.test(lower)) {
    pushAgent({
      role: "Critic",
      goal: "Review the plan and result for hidden risks, weak assumptions, and safety concerns.",
      prompt:
        "Review the workflow plan and outputs for hidden risks, weak assumptions, and safety concerns. Raise explicit objections or alternatives to the Lead.",
      startsAfterRoles: agents
        .filter((entry) => /\bbuilder\b/i.test(entry.role))
        .map((entry) => entry.role),
      reasoningEffort: "high",
    });
  }

  pushAgent({
    role: "Verifier",
    goal: "Verify the implementation, capture evidence, and block false completion.",
    prompt:
      "Run the agreed checks, capture pass/fail evidence, and route blocking fixes back to the Lead.",
    startsAfterRoles: agents
      .filter((entry) => /\bbuilder\b/i.test(entry.role))
      .map((entry) => entry.role),
    reasoningEffort: "high",
    fastMode: false,
  });

  return finalizeWorkflowSubAgents(agents);
}

function inferWorkflowInitialLanes(
  subAgents: ReadonlyArray<WorkflowSubAgentPlan>,
): ReadonlyArray<string> {
  return ["Lead", ...subAgents.map((agent) => agent.role)];
}

function inferWorkflowPattern(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(research|inspect|investigate)\b/.test(lower)) return "Research -> Build -> Test";
  if (/\b(compare|alternatives|options|approaches)\b/.test(lower)) return "Parallel Exploration";
  if (/\b(red[- ]?team|critic|critique|risk|security)\b/.test(lower)) return "Red Team";
  if (/\b(plan only|planning only|do not build)\b/.test(lower)) return "Planning Only";
  return "Build + Review";
}

function workflowAcceptanceCriteria(text: string): ReadonlyArray<string> {
  const lower = text.toLowerCase();
  const criteria = [
    "Implementation matches the requested outcome.",
    "Verifier records pass/fail evidence before final completion.",
    "Open objections are clearly labeled before the workflow completes.",
  ];
  if (/\b(test|verify|browser|preview|url)\b/.test(lower)) {
    criteria.push("Relevant test or browser evidence is captured.");
  }
  if (/\b(doc|document|readme|memory|notes?)\b/.test(lower)) {
    criteria.push("User-facing docs or durable notes are updated when needed.");
  }
  return criteria;
}

function inferWorkflowPlannedPayload(text: string): WorkflowPlannedPayload {
  const subAgents = inferWorkflowSubAgents(text);
  return {
    goal: text.trim() || "Workflow",
    launchStatus: "planned",
    workflowPattern: inferWorkflowPattern(text),
    initialLanes: inferWorkflowInitialLanes(subAgents),
    subAgents,
    acceptanceCriteria: workflowAcceptanceCriteria(text),
    requireVerifierApproval: true,
    addRedTeamCritique: /\b(red[- ]?team|critic|critique|risk|security|review)\b/i.test(text),
    requireTestsBeforeFinal: /\b(test|verify|browser|preview|url)\b/i.test(text),
    showMemoryAuditNotes: true,
    exploreParallelApproaches: /\b(compare|alternatives|options|approaches)\b/i.test(text),
    stopAfterPlanningForApproval: /\b(plan only|planning only|approval)\b/i.test(text),
  };
}

const WORKFLOW_RUNTIME_ACTIVITY_KINDS = new Set<string>([
  "workflow.started",
  "workflow.lane.guidance",
  "workflow.lane.stopped",
  "workflow.lane.control",
  "workflow.lane.started",
  "workflow.lane.completed",
  "workflow.lane.blocked",
  "workflow.control",
  "workflow.handoff",
  "workflow.evidence",
  "workflow.verifier.result",
  "workflow.objection",
  "workflow.route-back",
  "workflow.lead.synthesis",
  "workflow.memory.update",
  "workflow.blocked",
  "workflow.completed",
  "workflow.stopped",
]);

function normalizedWorkflowPrompt(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function threadHasWorkflowPlanOrCustomization(thread: OrchestrationThread): boolean {
  return thread.activities.some(
    (activity) => activity.kind === "workflow.planned" || activity.kind === "workflow.customized",
  );
}

function threadHasWorkflowRuntimeActivity(thread: OrchestrationThread): boolean {
  return thread.activities.some((activity) => WORKFLOW_RUNTIME_ACTIVITY_KINDS.has(activity.kind));
}

function isWorkflowRecordedFollowUpPrompt(text: string): boolean {
  const prompt = normalizedWorkflowPrompt(text);
  return /^workflow customization updated\b/.test(prompt);
}

function isWorkflowRuntimeControlPrompt(text: string): boolean {
  const prompt = normalizedWorkflowPrompt(text);
  return (
    /^start\s+(?:the\s+)?(?:approved\s+)?workflow\b/.test(prompt) ||
    /^launch\s+(?:the\s+)?(?:approved\s+)?workflow\b/.test(prompt) ||
    /^launch\s+only\s+the\s+planned\s+sub-agents\b/.test(prompt) ||
    /^workflow guidance for\b/.test(prompt) ||
    /\bre-trigger\s+(?:this\s+)?(?:sub-agent\s+)?lane\b/.test(prompt) ||
    /^stop\s+the\s+.+\s+workflow lane\b/.test(prompt) ||
    /^(?:pause|replace|freeze|collapse)\s+the\s+.+\b(?:workflow|lane)\b/.test(prompt) ||
    /^continue\s+(?:the\s+)?workflow\s+manually\b/.test(prompt) ||
    /^continue manually\b/.test(prompt) ||
    /^apply workflow control\b/.test(prompt)
  );
}

function shouldAppendWorkflowPlannedActivity({
  thread,
  messageText,
}: {
  readonly thread: OrchestrationThread;
  readonly messageText: string;
}): boolean {
  if (
    threadHasWorkflowRuntimeActivity(thread) ||
    isWorkflowRecordedFollowUpPrompt(messageText) ||
    isWorkflowRuntimeControlPrompt(messageText)
  ) {
    return false;
  }
  if (!threadHasWorkflowPlanOrCustomization(thread)) {
    return true;
  }
  return false;
}

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          testEnvironments: command.testEnvironments ?? [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          ...(command.testEnvironments !== undefined
            ? { testEnvironments: command.testEnvironments }
            : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          startedBy: command.startedBy ?? null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.queued-turn.delete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const queuedTurn = (thread.queuedTurns ?? []).find(
        (turn) =>
          (command.queueId === undefined || turn.queueId === command.queueId) &&
          turn.messageId === command.messageId,
      );
      if (!queuedTurn || queuedTurn.status !== "queued") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queued turn for message '${command.messageId}' is not queued and cannot be deleted.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.queued-turn-deleted",
        payload: {
          threadId: command.threadId,
          queueId: queuedTurn.queueId,
          messageId: command.messageId,
          deletedAt: command.createdAt,
        },
      };
    }

    case "thread.queued-turn.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const queuedTurn = (thread.queuedTurns ?? []).find(
        (turn) =>
          (command.queueId === undefined || turn.queueId === command.queueId) &&
          turn.messageId === command.messageId,
      );
      if (!queuedTurn || queuedTurn.status !== "queued") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queued turn for message '${command.messageId}' is not queued and cannot be updated.`,
        });
      }
      const message = thread.messages.find((entry) => entry.id === command.messageId);
      if (!message || message.role !== "user") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Queued turn message '${command.messageId}' is not an editable user message.`,
        });
      }
      if (command.text.trim().length === 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Queued turn message text cannot be empty.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-updated",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          text: command.text,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          dispatchPolicy: command.dispatchPolicy ?? DEFAULT_TURN_DISPATCH_POLICY,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      if (command.interactionMode !== "workflow") {
        return [userMessageEvent, turnStartRequestedEvent];
      }
      if (
        !shouldAppendWorkflowPlannedActivity({
          thread: targetThread,
          messageText: command.message.text,
        })
      ) {
        return [userMessageEvent, turnStartRequestedEvent];
      }

      const activityId = yield* Crypto.Crypto.pipe(
        Effect.flatMap((crypto) => crypto.randomUUIDv4),
        Effect.map(EventId.make),
      );
      const workflowGoal = command.message.text.trim() || command.titleSeed || "Workflow";
      const plannedWorkflow = inferWorkflowPlannedPayload(workflowGoal);
      const workflowPlannedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: turnStartRequestedEvent.eventId,
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: {
            id: activityId,
            tone: "info",
            kind: "workflow.planned",
            summary: "Workflow plan drafted",
            payload: plannedWorkflow,
            turnId: null,
            createdAt: command.createdAt,
          },
        },
      };
      return [userMessageEvent, turnStartRequestedEvent, workflowPlannedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.import": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: command.role,
          text: command.text,
          ...(command.attachments !== undefined ? { attachments: command.attachments } : {}),
          turnId: command.turnId,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "thread.workflow.record": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const activityId = yield* Crypto.Crypto.pipe(
        Effect.flatMap((crypto) => crypto.randomUUIDv4),
        Effect.map(EventId.make),
      );
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: {
            id: activityId,
            tone: "info",
            kind: command.kind,
            summary: command.summary,
            payload: command.payload,
            turnId: command.turnId ?? null,
            createdAt: command.createdAt,
          },
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
