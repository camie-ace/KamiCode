import * as Schema from "effect/Schema";
import { KamiUser } from "./userAuth.ts";
import { IsoDateTime, ProjectTriggerId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TriggerEventKind = Schema.Literals([
  "cron",
  "github.issue",
  "github.pull_request",
  "github.comment",
]);
export type TriggerEventKind = typeof TriggerEventKind.Type;
export const ThreadStartedByTrigger = Schema.Struct({
  kind: Schema.Literal("trigger"),
  triggerId: ProjectTriggerId,
  triggerName: TrimmedNonEmptyString,
  eventKind: TriggerEventKind,
  firedAt: IsoDateTime,
});
export type ThreadStartedByTrigger = typeof ThreadStartedByTrigger.Type;
export const ThreadStartedBy = Schema.Union([ThreadStartedByTrigger]);
export type ThreadStartedBy = typeof ThreadStartedBy.Type;

export const OrchestrationThreadCreator = Schema.Struct({
  userId: KamiUser.fields.userId,
  githubLogin: KamiUser.fields.githubLogin,
  displayName: KamiUser.fields.displayName,
  avatarUrl: KamiUser.fields.avatarUrl,
});
export type OrchestrationThreadCreator = typeof OrchestrationThreadCreator.Type;

export const KamiThreadMetadataFields = {
  // V2 createdBy records the actor role; retain GitHub attribution separately.
  createdByUser: Schema.optionalKey(Schema.NullOr(OrchestrationThreadCreator)),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  locked: Schema.optionalKey(Schema.Boolean),
};

export const TurnDispatchPolicy = Schema.Literals(["immediate", "queue"]);
export type TurnDispatchPolicy = typeof TurnDispatchPolicy.Type;
