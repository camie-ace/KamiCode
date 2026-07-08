import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProjectTriggerId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals([
  "default",
  "plan",
  "test",
  "workflow",
  "trigger",
]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
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
export const TurnDispatchPolicy = Schema.Literals(["immediate", "queue"]);
export type TurnDispatchPolicy = typeof TurnDispatchPolicy.Type;
export const DEFAULT_TURN_DISPATCH_POLICY: TurnDispatchPolicy = "immediate";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PROVIDER_SEND_TURN_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const PROVIDER_SEND_TURN_MAX_FILE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const PROVIDER_SEND_TURN_MAX_VIDEO_DATA_URL_CHARS = 35_000_000;
const PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
const MEDIA_TITLE_MAX_CHARS = 255;
const MEDIA_MIME_TYPE_MAX_CHARS = 100;
const MEDIA_EXTENSION_MAX_CHARS = 16;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

export const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

const MediaMimeType = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MEDIA_MIME_TYPE_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[^;]+)*$/i),
);

const MediaDimension = NonNegativeInt.check(Schema.isLessThanOrEqualTo(100_000));
const MediaDurationMs = NonNegativeInt.check(Schema.isLessThanOrEqualTo(24 * 60 * 60 * 1000));
const MediaTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(MEDIA_TITLE_MAX_CHARS));
const MediaExtension = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MEDIA_EXTENSION_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9]+$/i),
);

const ChatAttachmentSharedFields = {
  id: ChatAttachmentId,
  name: MediaTitle,
  mimeType: MediaMimeType,
} as const;

const UploadMediaMetadataFields = {
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
} as const;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

export const ChatGifAttachment = Schema.Struct({
  type: Schema.Literal("gif"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\/gif$/i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
});
export type ChatGifAttachment = typeof ChatGifAttachment.Type;

export const ChatVideoAttachment = Schema.Struct({
  type: Schema.Literal("video"),
  ...ChatAttachmentSharedFields,
  mimeType: MediaMimeType.check(Schema.isPattern(/^video\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_VIDEO_BYTES)),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
});
export type ChatVideoAttachment = typeof ChatVideoAttachment.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  ...ChatAttachmentSharedFields,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
});
export type ChatFileAttachment = typeof ChatFileAttachment.Type;

export const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const UploadChatGifAttachment = Schema.Struct({
  type: Schema.Literal("gif"),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^image\/gif$/i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
});
export type UploadChatGifAttachment = typeof UploadChatGifAttachment.Type;

export const UploadChatVideoAttachment = Schema.Struct({
  type: Schema.Literal("video"),
  name: MediaTitle,
  mimeType: MediaMimeType.check(Schema.isPattern(/^video\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_VIDEO_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_VIDEO_DATA_URL_CHARS),
  ),
  ...UploadMediaMetadataFields,
});
export type UploadChatVideoAttachment = typeof UploadChatVideoAttachment.Type;

export const UploadChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  name: MediaTitle,
  mimeType: MediaMimeType,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS),
  ),
});
export type UploadChatFileAttachment = typeof UploadChatFileAttachment.Type;

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatGifAttachment,
  ChatVideoAttachment,
  ChatFileAttachment,
]);
export type ChatAttachment = typeof ChatAttachment.Type;
export const UploadChatAttachment = Schema.Union([
  UploadChatImageAttachment,
  UploadChatGifAttachment,
  UploadChatVideoAttachment,
  UploadChatFileAttachment,
]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const MediaArtifactKind = Schema.Literals(["image", "gif", "video", "file", "unknown"]);
export type MediaArtifactKind = typeof MediaArtifactKind.Type;
export const MediaArtifactSource = Schema.Literals(["generated", "local", "project", "web"]);
export type MediaArtifactSource = typeof MediaArtifactSource.Type;
export const MediaArtifactOrigin = Schema.Literals(["attached", "found", "generated"]);
export type MediaArtifactOrigin = typeof MediaArtifactOrigin.Type;

export const MediaArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: MediaArtifactKind,
  source: MediaArtifactSource,
  title: MediaTitle,
  extension: MediaExtension,
  path: Schema.optional(TrimmedNonEmptyString),
  url: Schema.optional(TrimmedNonEmptyString),
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  mimeType: Schema.optional(MediaMimeType),
  sizeBytes: Schema.optional(NonNegativeInt),
  width: Schema.optional(MediaDimension),
  height: Schema.optional(MediaDimension),
  durationMs: Schema.optional(MediaDurationMs),
  modifiedAt: Schema.optional(IsoDateTime),
  createdAt: Schema.optional(IsoDateTime),
  messageId: Schema.optional(MessageId),
  origin: Schema.optional(MediaArtifactOrigin),
});
export type MediaArtifact = typeof MediaArtifact.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  /**
   * URL to open in the in-app browser preview when this script runs (or
   * when the user explicitly requests a preview). Optional; only honored on
   * the desktop build.
   */
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  /**
   * When true, automatically open the preview panel pointed at `previewUrl`
   * the moment this script starts. Ignored without `previewUrl` or on web.
   */
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectTestEnvironment = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: Schema.Literals(["local", "remote"]),
  baseUrl: TrimmedNonEmptyString,
  isDefault: Schema.Boolean,
});
export type ProjectTestEnvironment = typeof ProjectTestEnvironment.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  testEnvironments: Schema.optionalKey(Schema.Array(ProjectTestEnvironment)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

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
        return new SchemaIssue.InvalidValue(Option.some(input), {
          message: "workflow plans must include at least one sub-agent",
        });
      }

      const ids = new Set<string>();
      for (const agent of input) {
        if (ids.has(agent.id)) {
          return new SchemaIssue.InvalidValue(Option.some(agent.id), {
            message: "workflow sub-agent ids must be unique",
          });
        }
        ids.add(agent.id);
      }

      for (const agent of input) {
        for (const dependencyId of agent.startsAfter) {
          if (dependencyId === agent.id) {
            return new SchemaIssue.InvalidValue(Option.some(agent.id), {
              message: "workflow sub-agents cannot start after themselves",
            });
          }
          if (!ids.has(dependencyId)) {
            return new SchemaIssue.InvalidValue(Option.some(dependencyId), {
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

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationQueuedTurnStatus = Schema.Literals([
  "queued",
  "dispatching",
  "started",
  "failed",
  "cancelled",
]);
export type OrchestrationQueuedTurnStatus = typeof OrchestrationQueuedTurnStatus.Type;

export const OrchestrationQueuedTurn = Schema.Struct({
  queueId: TrimmedNonEmptyString,
  threadId: ThreadId,
  messageId: MessageId,
  status: OrchestrationQueuedTurnStatus,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  turnId: Schema.NullOr(TurnId),
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
});
export type OrchestrationQueuedTurn = typeof OrchestrationQueuedTurn.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  queuedTurns: Schema.optional(Schema.Array(OrchestrationQueuedTurn)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  testEnvironments: Schema.optionalKey(Schema.Array(ProjectTestEnvironment)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  queuedTurnCount: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({
  /**
   * When provided, the server skips the initial full shell snapshot and instead
   * replays shell events after this sequence before streaming live events.
   * Clients that already hold a cached (or HTTP-loaded) shell snapshot pass its
   * sequence here so the subscription resumes without re-sending the entire
   * projects/threads list (overlapping events are deduped by sequence on the
   * client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
});
export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  /**
   * When provided, the server skips the initial snapshot frame and instead
   * replays events after this sequence before streaming live events. Clients
   * that load the snapshot over HTTP pass the snapshot's sequence here so the
   * live subscription resumes without a gap (overlapping events are deduped by
   * sequence on the client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  testEnvironments: Schema.optional(Schema.Array(ProjectTestEnvironment)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  testEnvironments: Schema.optional(Schema.Array(ProjectTestEnvironment)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadQueuedTurnDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.queued-turn.delete"),
  commandId: CommandId,
  threadId: ThreadId,
  queueId: Schema.optional(TrimmedNonEmptyString),
  messageId: MessageId,
  createdAt: IsoDateTime,
});

const ThreadQueuedTurnUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.queued-turn.update"),
  commandId: CommandId,
  threadId: ThreadId,
  queueId: Schema.optional(TrimmedNonEmptyString),
  messageId: MessageId,
  text: Schema.String,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  dispatchPolicy: Schema.optional(TurnDispatchPolicy),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

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

const ThreadWorkflowRecordCommandBase = {
  type: Schema.Literal("thread.workflow.record"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(Schema.NullOr(TurnId)),
  summary: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;

const ThreadWorkflowRecordCommand = Schema.Union([
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

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  dispatchPolicy: Schema.optional(TurnDispatchPolicy),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadQueuedTurnDeleteCommand,
  ThreadQueuedTurnUpdateCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadWorkflowRecordCommand,
  ThreadActivityAppendCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadQueuedTurnDeleteCommand,
  ThreadQueuedTurnUpdateCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadWorkflowRecordCommand,
  ThreadActivityAppendCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageImportCommand = Schema.Struct({
  type: Schema.Literal("thread.message.import"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadMessageImportCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.message-updated",
  "thread.turn-start-requested",
  "thread.queued-turn-deleted",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  testEnvironments: Schema.optionalKey(Schema.Array(ProjectTestEnvironment)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  testEnvironments: Schema.optional(Schema.Array(ProjectTestEnvironment)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  startedBy: Schema.optionalKey(Schema.NullOr(ThreadStartedBy)),
  workflowParentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  workflowLaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workflowLaneRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadMessageUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  text: Schema.String,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  dispatchPolicy: TurnDispatchPolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TURN_DISPATCH_POLICY)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadQueuedTurnDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  queueId: TrimmedNonEmptyString,
  messageId: MessageId,
  deletedAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-updated"),
    payload: ThreadMessageUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.queued-turn-deleted"),
    payload: ThreadQueuedTurnDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
