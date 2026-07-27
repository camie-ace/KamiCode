import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProjectId,
  ProjectTriggerRuntimeTarget,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  ProjectTriggerId,
  ProjectTriggerRepository,
  type ProjectTriggerRow,
} from "./Services/ProjectTriggerRepository.ts";
import { ProjectTriggerService } from "./Services/ProjectTriggerService.ts";

export const PROJECT_TRIGGER_TOOL_NAMESPACE = "kamicode";
export const PROJECT_TRIGGER_TOOL_NAMES = [
  "create_trigger",
  "update_trigger",
  "set_trigger_enabled",
  "delete_trigger",
  "list_triggers",
] as const;
export type ProjectTriggerToolName = (typeof PROJECT_TRIGGER_TOOL_NAMES)[number];

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

const ScheduleInput = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literal("cron")),
  expression: Schema.String,
  timezone: Schema.optionalKey(Schema.String),
  runtime: Schema.optionalKey(ProjectTriggerRuntimeTarget),
});

const ThreadTemplateInput = Schema.Struct({
  prompt: Schema.String,
  titleSeed: Schema.optionalKey(Schema.String),
  runtimeMode: Schema.optionalKey(
    Schema.Literals(["approval-required", "auto-accept-edits", "full-access"]),
  ),
  interactionMode: Schema.optionalKey(
    Schema.Literals(["default", "plan", "test", "workflow", "trigger"]),
  ),
  branch: Schema.optionalKey(Schema.NullOr(Schema.String)),
  worktreePath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.String),
});

const PartialThreadTemplateInput = Schema.Struct({
  prompt: Schema.optionalKey(Schema.String),
  titleSeed: Schema.optionalKey(Schema.String),
  runtimeMode: Schema.optionalKey(
    Schema.Literals(["approval-required", "auto-accept-edits", "full-access"]),
  ),
  interactionMode: Schema.optionalKey(
    Schema.Literals(["default", "plan", "test", "workflow", "trigger"]),
  ),
  branch: Schema.optionalKey(Schema.NullOr(Schema.String)),
  worktreePath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.String),
});

const CreateTriggerToolInput = Schema.Struct({
  projectId: ProjectId,
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  enabled: Schema.optionalKey(Schema.Boolean),
  schedule: ScheduleInput,
  threadTemplate: ThreadTemplateInput,
});

const UpdateTriggerToolInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  enabled: Schema.optionalKey(Schema.Boolean),
  schedule: Schema.optionalKey(ScheduleInput),
  threadTemplate: Schema.optionalKey(PartialThreadTemplateInput),
});

const SetTriggerEnabledToolInput = Schema.Struct({
  triggerId: ProjectTriggerId,
  enabled: Schema.Boolean,
});

const DeleteTriggerToolInput = Schema.Struct({
  triggerId: ProjectTriggerId,
});

const ListTriggersToolInput = Schema.Struct({
  projectId: ProjectId,
});

export type ProjectTriggerDynamicToolRunner = (input: {
  readonly tool: ProjectTriggerToolName;
  readonly rawArguments: unknown;
}) => Effect.Effect<EffectCodexSchema.DynamicToolCallResponse, never>;

export interface ProjectTriggerDynamicToolRunnerOptions {
  readonly service: ProjectTriggerService["Service"];
  readonly repository: ProjectTriggerRepository["Service"];
  readonly defaultProviderInstanceId: ProviderInstanceId;
  readonly makeTriggerId: Effect.Effect<ProjectTriggerId, never>;
}

function inputTextResponse(input: {
  readonly success: boolean;
  readonly value: unknown;
}): EffectCodexSchema.DynamicToolCallResponse {
  return {
    success: input.success,
    contentItems: [
      {
        type: "inputText",
        text: `${JSON.stringify(input.value, null, 2)}\n`,
      },
    ],
  };
}

function triggerSummary(row: ProjectTriggerRow): unknown {
  return {
    id: row.triggerId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    schedule: {
      kind: row.scheduleKind,
      expression: row.scheduleCron,
      timezone: row.timezone,
      runtime: row.runtimeTarget,
    },
    threadTemplate: {
      prompt: row.prompt,
      titleSeed: row.titleSeed,
      runtimeMode: row.runtimeMode,
      interactionMode: row.interactionMode,
      branch: row.bootstrap?.createThread?.branch ?? null,
      worktreePath: row.bootstrap?.createThread?.worktreePath ?? null,
      modelSelection: row.modelSelection,
    },
    nextRunAt: row.nextFireAt,
    lastRunAt: row.lastFireAt,
    updatedAt: row.updatedAt,
    warnings:
      row.runtimeTarget === "local"
        ? ["Local runtime triggers only fire while this runtime is online."]
        : [],
  };
}

function makeUnavailableResponse(
  tool: ProjectTriggerToolName,
): EffectCodexSchema.DynamicToolCallResponse {
  return inputTextResponse({
    success: false,
    value: {
      tool,
      error: {
        code: "project_trigger_tools_unavailable",
        message: "Project trigger tools are not available in this runtime.",
      },
    },
  });
}

export function formatProjectTriggerDynamicToolUnavailable(input: {
  readonly tool: ProjectTriggerToolName;
}): EffectCodexSchema.DynamicToolCallResponse {
  return makeUnavailableResponse(input.tool);
}

function makeToolFailureResponse(input: {
  readonly tool: ProjectTriggerToolName;
  readonly cause: Cause.Cause<unknown>;
}): EffectCodexSchema.DynamicToolCallResponse {
  return inputTextResponse({
    success: false,
    value: {
      tool: input.tool,
      error: {
        code: "project_trigger_tool_failed",
        message: Cause.pretty(input.cause),
      },
    },
  });
}

function decodeCreateTriggerInput(rawArguments: unknown) {
  return Schema.decodeUnknownEffect(CreateTriggerToolInput)(rawArguments).pipe(
    Effect.mapError((error) => formatSchemaIssue(error.issue)),
  );
}

function decodeUpdateTriggerInput(rawArguments: unknown) {
  return Schema.decodeUnknownEffect(UpdateTriggerToolInput)(rawArguments).pipe(
    Effect.mapError((error) => formatSchemaIssue(error.issue)),
  );
}

function decodeSetTriggerEnabledInput(rawArguments: unknown) {
  return Schema.decodeUnknownEffect(SetTriggerEnabledToolInput)(rawArguments).pipe(
    Effect.mapError((error) => formatSchemaIssue(error.issue)),
  );
}

function decodeDeleteTriggerInput(rawArguments: unknown) {
  return Schema.decodeUnknownEffect(DeleteTriggerToolInput)(rawArguments).pipe(
    Effect.mapError((error) => formatSchemaIssue(error.issue)),
  );
}

function decodeListTriggersInput(rawArguments: unknown) {
  return Schema.decodeUnknownEffect(ListTriggersToolInput)(rawArguments).pipe(
    Effect.mapError((error) => formatSchemaIssue(error.issue)),
  );
}

function normalizeTemplate(input: {
  readonly row: ProjectTriggerRow | undefined;
  readonly template?: typeof ThreadTemplateInput.Type | undefined;
  readonly defaultProviderInstanceId: ProviderInstanceId;
}) {
  const row = input.row;
  const template = input.template;
  const modelSelection =
    template?.model !== undefined
      ? createModelSelection(input.defaultProviderInstanceId, template.model)
      : (row?.modelSelection ??
        createModelSelection(input.defaultProviderInstanceId, DEFAULT_MODEL));
  return {
    prompt: template?.prompt ?? row?.prompt ?? "",
    titleSeed: template?.titleSeed ?? row?.titleSeed ?? null,
    runtimeMode: template?.runtimeMode ?? row?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode:
      template?.interactionMode ?? row?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: template?.branch ?? row?.bootstrap?.createThread?.branch ?? null,
    worktreePath: template?.worktreePath ?? row?.bootstrap?.createThread?.worktreePath ?? null,
    modelSelection,
  };
}

function requireExistingTrigger(
  repository: ProjectTriggerRepository["Service"],
  triggerId: ProjectTriggerId,
) {
  return repository.getTriggerById({ triggerId }).pipe(
    Effect.flatMap((row) =>
      Option.match(row, {
        onNone: () => Effect.fail(`Project trigger not found: ${triggerId}`),
        onSome: Effect.succeed,
      }),
    ),
  );
}

function saveFromTool(input: {
  readonly service: ProjectTriggerService["Service"];
  readonly defaultProviderInstanceId: ProviderInstanceId;
  readonly triggerId: ProjectTriggerId;
  readonly existing?: ProjectTriggerRow | undefined;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description: string | null | undefined;
  readonly enabled: boolean;
  readonly schedule: typeof ScheduleInput.Type;
  readonly threadTemplate?: typeof ThreadTemplateInput.Type | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}) {
  const template = normalizeTemplate({
    row: input.existing,
    template: input.threadTemplate,
    defaultProviderInstanceId: input.defaultProviderInstanceId,
  });
  const bootstrap =
    template.branch !== null || template.worktreePath !== null
      ? {
          createThread: {
            projectId: input.projectId,
            title: template.titleSeed ?? input.name,
            modelSelection: template.modelSelection,
            runtimeMode: template.runtimeMode,
            interactionMode: template.interactionMode,
            branch: template.branch,
            worktreePath: template.worktreePath,
            createdAt: input.createdAt,
          },
        }
      : null;
  return input.service.saveTrigger({
    triggerId: input.triggerId,
    projectId: input.projectId,
    name: input.name,
    description: input.description ?? null,
    enabled: input.enabled,
    scheduleKind: "cron",
    scheduleCron: input.schedule.expression,
    scheduleOnceAt: null,
    timezone: input.schedule.timezone ?? input.existing?.timezone ?? "UTC",
    runtimeTarget: input.schedule.runtime ?? input.existing?.runtimeTarget ?? "local",
    ...(input.existing === undefined
      ? {}
      : {
          webhookPublicId: input.existing.webhookPublicId,
          webhookSecretVersion: input.existing.webhookSecretVersion,
        }),
    prompt: template.prompt,
    modelSelection: template.modelSelection,
    runtimeMode: template.runtimeMode,
    interactionMode: template.interactionMode,
    titleSeed: template.titleSeed,
    bootstrap,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

function runTool(
  options: ProjectTriggerDynamicToolRunnerOptions,
  input: {
    readonly tool: ProjectTriggerToolName;
    readonly rawArguments: unknown;
  },
) {
  return Effect.gen(function* () {
    const now = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));

    switch (input.tool) {
      case "create_trigger": {
        const decoded = yield* decodeCreateTriggerInput(input.rawArguments);
        const triggerId = yield* options.makeTriggerId;
        const row = yield* saveFromTool({
          service: options.service,
          defaultProviderInstanceId: options.defaultProviderInstanceId,
          triggerId,
          projectId: decoded.projectId,
          name: decoded.name,
          description: decoded.description,
          enabled: decoded.enabled ?? true,
          schedule: decoded.schedule,
          threadTemplate: decoded.threadTemplate,
          createdAt: now,
          updatedAt: now,
        });
        return inputTextResponse({
          success: true,
          value: { tool: input.tool, trigger: triggerSummary(row) },
        });
      }
      case "update_trigger": {
        const decoded = yield* decodeUpdateTriggerInput(input.rawArguments);
        const existing = yield* requireExistingTrigger(options.repository, decoded.triggerId);
        const row = yield* saveFromTool({
          service: options.service,
          defaultProviderInstanceId: options.defaultProviderInstanceId,
          triggerId: existing.triggerId,
          existing,
          projectId: existing.projectId,
          name: decoded.name ?? existing.name,
          description:
            decoded.description !== undefined ? decoded.description : existing.description,
          enabled: decoded.enabled ?? existing.enabled,
          schedule: decoded.schedule ?? {
            expression: existing.scheduleCron ?? "",
            timezone: existing.timezone,
            runtime: existing.runtimeTarget,
          },
          threadTemplate: decoded.threadTemplate
            ? {
                prompt: decoded.threadTemplate.prompt ?? existing.prompt,
                ...(decoded.threadTemplate.titleSeed !== undefined
                  ? { titleSeed: decoded.threadTemplate.titleSeed }
                  : existing.titleSeed !== null
                    ? { titleSeed: existing.titleSeed }
                    : {}),
                runtimeMode: decoded.threadTemplate.runtimeMode ?? existing.runtimeMode,
                interactionMode: decoded.threadTemplate.interactionMode ?? existing.interactionMode,
                branch:
                  decoded.threadTemplate.branch ?? existing.bootstrap?.createThread?.branch ?? null,
                worktreePath:
                  decoded.threadTemplate.worktreePath ??
                  existing.bootstrap?.createThread?.worktreePath ??
                  null,
              }
            : undefined,
          createdAt: existing.createdAt,
          updatedAt: now,
        });
        return inputTextResponse({
          success: true,
          value: { tool: input.tool, trigger: triggerSummary(row) },
        });
      }
      case "set_trigger_enabled": {
        const decoded = yield* decodeSetTriggerEnabledInput(input.rawArguments);
        const existing = yield* requireExistingTrigger(options.repository, decoded.triggerId);
        const row = yield* saveFromTool({
          service: options.service,
          defaultProviderInstanceId: options.defaultProviderInstanceId,
          triggerId: existing.triggerId,
          existing,
          projectId: existing.projectId,
          name: existing.name,
          description: existing.description,
          enabled: decoded.enabled,
          schedule: {
            expression: existing.scheduleCron ?? "",
            timezone: existing.timezone,
            runtime: existing.runtimeTarget,
          },
          createdAt: existing.createdAt,
          updatedAt: now,
        });
        return inputTextResponse({
          success: true,
          value: { tool: input.tool, trigger: triggerSummary(row) },
        });
      }
      case "delete_trigger": {
        const decoded = yield* decodeDeleteTriggerInput(input.rawArguments);
        const deleted = yield* options.service.deleteTrigger({
          triggerId: decoded.triggerId,
          deletedAt: now,
        });
        return inputTextResponse({
          success: deleted,
          value: { tool: input.tool, triggerId: decoded.triggerId, deleted, deletedAt: now },
        });
      }
      case "list_triggers": {
        const decoded = yield* decodeListTriggersInput(input.rawArguments);
        const triggers = yield* options.service.listProjectTriggers({
          projectId: decoded.projectId,
        });
        return inputTextResponse({
          success: true,
          value: {
            tool: input.tool,
            projectId: decoded.projectId,
            triggers: triggers.map(triggerSummary),
          },
        });
      }
    }
  });
}

export function createProjectTriggerDynamicToolRunner(
  options: ProjectTriggerDynamicToolRunnerOptions,
): ProjectTriggerDynamicToolRunner {
  return (input) =>
    runTool(options, input).pipe(
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.succeed(makeToolFailureResponse({ tool: input.tool, cause })),
      ),
    );
}

export function isProjectTriggerDynamicToolCall(input: {
  readonly tool: string;
  readonly namespace?: string | null | undefined;
}): input is { readonly tool: ProjectTriggerToolName; readonly namespace?: string | null } {
  return (
    PROJECT_TRIGGER_TOOL_NAMES.includes(input.tool as ProjectTriggerToolName) &&
    (input.namespace === undefined ||
      input.namespace === null ||
      input.namespace === PROJECT_TRIGGER_TOOL_NAMESPACE)
  );
}

const cronScheduleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["expression"],
  properties: {
    kind: { const: "cron" },
    expression: { type: "string", description: "Cron expression such as 0 9 * * 1-5." },
    timezone: { type: "string", description: "IANA timezone. Defaults to UTC." },
    runtime: { enum: ["local", "remote"], description: "Runtime that owns scheduling." },
  },
} as const;

const threadTemplateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: { type: "string", description: "Prompt to send when the trigger fires." },
    titleSeed: { type: "string", description: "Optional title seed for fired threads." },
    runtimeMode: { enum: ["approval-required", "auto-accept-edits", "full-access"] },
    interactionMode: { enum: ["default", "plan", "test", "workflow", "trigger"] },
    branch: { type: ["string", "null"] },
    worktreePath: { type: ["string", "null"] },
    model: { type: "string", description: "Optional model slug; defaults to the runtime default." },
  },
} as const;

const updateThreadTemplateSchema = {
  ...threadTemplateSchema,
  required: [],
} as const;

export const PROJECT_TRIGGER_DYNAMIC_TOOL_SPECS = [
  {
    namespace: PROJECT_TRIGGER_TOOL_NAMESPACE,
    name: "create_trigger",
    description: "Create a project trigger that starts a new KamiCode thread from a cron schedule.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId", "name", "schedule", "threadTemplate"],
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: ["string", "null"] },
        enabled: { type: "boolean" },
        schedule: cronScheduleSchema,
        threadTemplate: threadTemplateSchema,
      },
    },
  },
  {
    namespace: PROJECT_TRIGGER_TOOL_NAMESPACE,
    name: "update_trigger",
    description: "Update an existing project trigger by id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["triggerId"],
      properties: {
        triggerId: { type: "string" },
        name: { type: "string" },
        description: { type: ["string", "null"] },
        enabled: { type: "boolean" },
        schedule: cronScheduleSchema,
        threadTemplate: updateThreadTemplateSchema,
      },
    },
  },
  {
    namespace: PROJECT_TRIGGER_TOOL_NAMESPACE,
    name: "set_trigger_enabled",
    description: "Enable or disable an existing project trigger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["triggerId", "enabled"],
      properties: {
        triggerId: { type: "string" },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    namespace: PROJECT_TRIGGER_TOOL_NAMESPACE,
    name: "delete_trigger",
    description: "Delete an existing project trigger by id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["triggerId"],
      properties: {
        triggerId: { type: "string" },
      },
    },
  },
  {
    namespace: PROJECT_TRIGGER_TOOL_NAMESPACE,
    name: "list_triggers",
    description: "List project triggers for a project.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId"],
      properties: {
        projectId: { type: "string" },
      },
    },
  },
] satisfies ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec>;
