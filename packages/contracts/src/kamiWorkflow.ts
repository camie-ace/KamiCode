import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

export const WorkflowLaunchStatus = Schema.Literals(["planned", "started"]);
export type WorkflowLaunchStatus = typeof WorkflowLaunchStatus.Type;

export const WorkflowSubAgentPlan = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: TrimmedNonEmptyString,
  goal: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  reasoningEffort: TrimmedNonEmptyString,
  fastMode: Schema.Boolean,
  startsAfter: Schema.Array(TrimmedNonEmptyString),
});
export type WorkflowSubAgentPlan = typeof WorkflowSubAgentPlan.Type;

const WorkflowSubAgentPlans = Schema.Array(WorkflowSubAgentPlan).check(
  Schema.makeFilter(
    (input) => {
      if (input.length === 0) {
        return new SchemaIssue.InvalidValue({
          message: "workflow plans must include at least one sub-agent",
        });
      }

      const ids = new Set<string>();
      for (const agent of input) {
        if (ids.has(agent.id)) {
          return new SchemaIssue.InvalidValue({
            message: "workflow sub-agent ids must be unique",
          });
        }
        ids.add(agent.id);
      }

      for (const agent of input) {
        for (const dependencyId of agent.startsAfter) {
          if (dependencyId === agent.id) {
            return new SchemaIssue.InvalidValue({
              message: "workflow sub-agents cannot start after themselves",
            });
          }
          if (!ids.has(dependencyId)) {
            return new SchemaIssue.InvalidValue({
              message: "workflow sub-agent startsAfter dependencies must reference planned ids",
            });
          }
        }
      }

      return true;
    },
    { identifier: "WorkflowSubAgentPlans" },
  ),
);

const WorkflowPlanSharedFields = {
  goal: TrimmedNonEmptyString,
  workflowPattern: TrimmedNonEmptyString,
  initialLanes: Schema.Array(TrimmedNonEmptyString),
  subAgents: WorkflowSubAgentPlans,
  acceptanceCriteria: Schema.Array(TrimmedNonEmptyString),
  requireVerifierApproval: Schema.Boolean,
  addRedTeamCritique: Schema.Boolean,
  requireTestsBeforeFinal: Schema.Boolean,
  showMemoryAuditNotes: Schema.Boolean,
  exploreParallelApproaches: Schema.Boolean,
  stopAfterPlanningForApproval: Schema.Boolean,
} as const;

export const WorkflowPlannedPayload = Schema.Struct({
  ...WorkflowPlanSharedFields,
  launchStatus: Schema.Literal("planned"),
});
export type WorkflowPlannedPayload = typeof WorkflowPlannedPayload.Type;

export const WorkflowStartedPayload = Schema.Struct({
  goal: TrimmedNonEmptyString,
  launchStatus: Schema.Literal("started"),
  workflowPattern: Schema.optional(TrimmedNonEmptyString),
  initialLanes: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  lanes: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  subAgents: WorkflowSubAgentPlans,
  acceptanceCriteria: Schema.Array(TrimmedNonEmptyString),
  requireVerifierApproval: Schema.optional(Schema.Boolean),
  addRedTeamCritique: Schema.optional(Schema.Boolean),
  requireTestsBeforeFinal: Schema.optional(Schema.Boolean),
  showMemoryAuditNotes: Schema.optional(Schema.Boolean),
  exploreParallelApproaches: Schema.optional(Schema.Boolean),
  stopAfterPlanningForApproval: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  reasoningEffort: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  fastMode: Schema.optional(Schema.Boolean),
  startedFromActivityId: Schema.optional(Schema.NullOr(EventId)),
});
export type WorkflowStartedPayload = typeof WorkflowStartedPayload.Type;

export const WorkflowCustomizedPayload = Schema.Struct({
  acceptanceCriteria: Schema.Array(TrimmedNonEmptyString),
  lanes: Schema.Array(TrimmedNonEmptyString),
  requireVerifierApproval: Schema.Boolean,
  addRedTeamCritique: Schema.Boolean,
  requireTestsBeforeFinal: Schema.Boolean,
  showMemoryAuditNotes: Schema.Boolean,
  exploreParallelApproaches: Schema.Boolean,
  stopAfterPlanningForApproval: Schema.Boolean,
  model: Schema.NullOr(TrimmedNonEmptyString),
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
  fastMode: Schema.Boolean,
  subAgents: WorkflowSubAgentPlans,
});
export type WorkflowCustomizedPayload = typeof WorkflowCustomizedPayload.Type;

const WorkflowStringList = Schema.Array(TrimmedNonEmptyString);

const WorkflowLaneTarget = Schema.Struct({
  laneId: TrimmedNonEmptyString,
  laneRole: Schema.optional(TrimmedNonEmptyString),
});

const WorkflowRuntimePayloadBase = {
  turnId: Schema.optional(TurnId),
  cardType: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  detail: Schema.optional(TrimmedNonEmptyString),
} as const;

const WorkflowLaneStartedChildThreadFields = {
  childThreadId: ThreadId,
  childTurnMessageId: MessageId,
  childTurnRequestedAt: IsoDateTime,
} as const;

const WorkflowChildThreadResultFields = {
  childThreadId: Schema.optional(ThreadId),
  childTurnId: Schema.optional(TurnId),
  sourceStartedActivityId: Schema.optional(EventId),
} as const;

export const WorkflowLaneGuidancePayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  guidance: TrimmedNonEmptyString,
  retrigger: Schema.optional(Schema.Boolean),
});
export type WorkflowLaneGuidancePayload = typeof WorkflowLaneGuidancePayload.Type;

export const WorkflowLaneStoppedPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  preserved: Schema.Boolean,
});
export type WorkflowLaneStoppedPayload = typeof WorkflowLaneStoppedPayload.Type;

export const WorkflowLaneControlPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  action: TrimmedNonEmptyString,
  preserved: Schema.optional(Schema.Boolean),
});
export type WorkflowLaneControlPayload = typeof WorkflowLaneControlPayload.Type;

export const WorkflowLaneStartedPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  ...WorkflowLaneStartedChildThreadFields,
});
export type WorkflowLaneStartedPayload = typeof WorkflowLaneStartedPayload.Type;

export const WorkflowLaneCompletedPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  ...WorkflowChildThreadResultFields,
  filesTouched: Schema.optional(WorkflowStringList),
  testsRun: Schema.optional(WorkflowStringList),
  knownRisks: Schema.optional(WorkflowStringList),
});
export type WorkflowLaneCompletedPayload = typeof WorkflowLaneCompletedPayload.Type;

export const WorkflowLaneBlockedPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  reason: Schema.optional(TrimmedNonEmptyString),
  requiredFix: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowLaneBlockedPayload = typeof WorkflowLaneBlockedPayload.Type;

export const WorkflowControlPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  action: TrimmedNonEmptyString,
  preserved: Schema.optional(Schema.Boolean),
});
export type WorkflowControlPayload = typeof WorkflowControlPayload.Type;

export const WorkflowHandoffPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  ...WorkflowChildThreadResultFields,
  filesTouched: Schema.optional(WorkflowStringList),
  testsRun: Schema.optional(WorkflowStringList),
  knownRisks: Schema.optional(WorkflowStringList),
});
export type WorkflowHandoffPayload = typeof WorkflowHandoffPayload.Type;

export const WorkflowEvidencePayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  status: Schema.optional(TrimmedNonEmptyString),
  checksRun: Schema.optional(WorkflowStringList),
  artifacts: Schema.optional(WorkflowStringList),
  result: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowEvidencePayload = typeof WorkflowEvidencePayload.Type;

export const WorkflowVerifierResultPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  turnId: Schema.optional(TurnId),
  ...WorkflowLaneTarget.fields,
  status: TrimmedNonEmptyString,
  passed: Schema.optional(WorkflowStringList),
  failed: Schema.optional(WorkflowStringList),
  requiredFix: Schema.optional(Schema.String),
});
export type WorkflowVerifierResultPayload = typeof WorkflowVerifierResultPayload.Type;

export const WorkflowObjectionPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  severity: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowObjectionPayload = typeof WorkflowObjectionPayload.Type;

export const WorkflowRouteBackPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  ...WorkflowLaneTarget.fields,
  requiredFix: Schema.optional(TrimmedNonEmptyString),
  filesTouched: Schema.optional(WorkflowStringList),
  testsRun: Schema.optional(WorkflowStringList),
  knownRisks: Schema.optional(WorkflowStringList),
});
export type WorkflowRouteBackPayload = typeof WorkflowRouteBackPayload.Type;

export const WorkflowLeadSynthesisPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  decision: Schema.optional(TrimmedNonEmptyString),
  concerns: Schema.optional(WorkflowStringList),
  alternatives: Schema.optional(WorkflowStringList),
  overrides: Schema.optional(WorkflowStringList),
});
export type WorkflowLeadSynthesisPayload = typeof WorkflowLeadSynthesisPayload.Type;

export const WorkflowMemoryUpdatePayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  turnId: Schema.optional(TurnId),
  laneId: Schema.optional(TrimmedNonEmptyString),
  laneRole: Schema.optional(TrimmedNonEmptyString),
  memoryText: TrimmedNonEmptyString,
});
export type WorkflowMemoryUpdatePayload = typeof WorkflowMemoryUpdatePayload.Type;

export const WorkflowStatusPayload = Schema.Struct({
  ...WorkflowRuntimePayloadBase,
  status: TrimmedNonEmptyString,
  implementationStatus: Schema.optional(TrimmedNonEmptyString),
  verificationStatus: Schema.optional(TrimmedNonEmptyString),
  openObjections: Schema.optional(NonNegativeInt),
  memoryUpdates: Schema.optional(NonNegativeInt),
  requiredFix: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowStatusPayload = typeof WorkflowStatusPayload.Type;

export const WorkflowRecordPayload = Schema.Union([
  WorkflowPlannedPayload,
  WorkflowStartedPayload,
  WorkflowCustomizedPayload,
  WorkflowLaneGuidancePayload,
  WorkflowLaneStoppedPayload,
  WorkflowLaneControlPayload,
  WorkflowLaneStartedPayload,
  WorkflowLaneCompletedPayload,
  WorkflowLaneBlockedPayload,
  WorkflowControlPayload,
  WorkflowHandoffPayload,
  WorkflowEvidencePayload,
  WorkflowVerifierResultPayload,
  WorkflowObjectionPayload,
  WorkflowRouteBackPayload,
  WorkflowLeadSynthesisPayload,
  WorkflowMemoryUpdatePayload,
  WorkflowStatusPayload,
]);
export type WorkflowRecordPayload = typeof WorkflowRecordPayload.Type;

export const WorkflowRecordKind = Schema.Literals([
  "workflow.planned",
  "workflow.started",
  "workflow.customized",
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
export type WorkflowRecordKind = typeof WorkflowRecordKind.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const ThreadWorkflowRecordCommandBase = {
  type: Schema.Literal("thread.workflow.record"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(Schema.NullOr(TurnId)),
  summary: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;

export const ThreadWorkflowRecordCommand = Schema.Union([
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.planned"),
    payload: WorkflowPlannedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.started"),
    payload: WorkflowStartedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.customized"),
    payload: WorkflowCustomizedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.guidance"),
    payload: WorkflowLaneGuidancePayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.stopped"),
    payload: WorkflowLaneStoppedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.control"),
    payload: WorkflowLaneControlPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.started"),
    payload: WorkflowLaneStartedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.completed"),
    payload: WorkflowLaneCompletedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lane.blocked"),
    payload: WorkflowLaneBlockedPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.control"),
    payload: WorkflowControlPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.handoff"),
    payload: WorkflowHandoffPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.evidence"),
    payload: WorkflowEvidencePayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.verifier.result"),
    payload: WorkflowVerifierResultPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.objection"),
    payload: WorkflowObjectionPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.route-back"),
    payload: WorkflowRouteBackPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.lead.synthesis"),
    payload: WorkflowLeadSynthesisPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.memory.update"),
    payload: WorkflowMemoryUpdatePayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.blocked"),
    payload: WorkflowStatusPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.completed"),
    payload: WorkflowStatusPayload,
  }),
  Schema.Struct({
    ...ThreadWorkflowRecordCommandBase,
    kind: Schema.Literal("workflow.stopped"),
    payload: WorkflowStatusPayload,
  }),
]);

export type ThreadWorkflowRecordCommand = typeof ThreadWorkflowRecordCommand.Type;

export const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});
