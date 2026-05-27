import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import type { BrowserHarnessRunInput } from "./browserHarness.ts";
import {
  createPlaywrightEvidenceRunner,
  type BrowserHarnessRunner,
  type EvidenceRunner,
  type EvidenceRunResult,
} from "./evidenceRunner.ts";

export type { BrowserHarnessRunner } from "./evidenceRunner.ts";

export const KAMI_TEST_HARNESS_TOOL_NAMESPACE = "kamicode";
export const KAMI_TEST_HARNESS_TOOL_NAME = "kami_test_harness";

const NavigateActionSchema = Schema.Struct({
  type: Schema.Literal("navigate"),
  url: Schema.String,
});

const ClickActionSchema = Schema.Struct({
  type: Schema.Literal("click"),
  selector: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
});

const TypeActionSchema = Schema.Struct({
  type: Schema.Literal("type"),
  selector: Schema.optionalKey(Schema.String),
  text: Schema.String,
});

const SelectActionSchema = Schema.Struct({
  type: Schema.Literal("select"),
  selector: Schema.optionalKey(Schema.String),
  value: Schema.String,
});

const WaitActionSchema = Schema.Struct({
  type: Schema.Literal("wait"),
  ms: Schema.optionalKey(Schema.Number),
  text: Schema.optionalKey(Schema.String),
});

const AssertActionSchema = Schema.Struct({
  type: Schema.Literal("assert"),
  description: Schema.String,
  selector: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  urlIncludes: Schema.optionalKey(Schema.String),
  titleIncludes: Schema.optionalKey(Schema.String),
});

const ScreenshotActionSchema = Schema.Struct({
  type: Schema.Literal("screenshot"),
  label: Schema.optionalKey(Schema.String),
});

const ScrollActionSchema = Schema.Struct({
  type: Schema.Literal("scroll"),
  direction: Schema.Literals(["up", "down"]),
});

const DoneActionSchema = Schema.Struct({
  type: Schema.Literal("done"),
  summary: Schema.String,
  result: Schema.Literals(["pass", "fail", "blocked"]),
});

const TestHarnessActionSchema = Schema.Union([
  NavigateActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  SelectActionSchema,
  WaitActionSchema,
  AssertActionSchema,
  ScreenshotActionSchema,
  ScrollActionSchema,
  DoneActionSchema,
]);

export const BrowserHarnessDynamicToolArgumentsSchema = Schema.Struct({
  url: Schema.String,
  goal: Schema.optionalKey(Schema.String),
  actions: Schema.Array(TestHarnessActionSchema),
  projectId: Schema.optionalKey(Schema.String),
  environmentId: Schema.optionalKey(Schema.String),
  headless: Schema.optionalKey(Schema.Boolean),
  timeoutMs: Schema.optionalKey(Schema.Number),
  lingerMs: Schema.optionalKey(Schema.Number),
});

export type BrowserHarnessDynamicToolArguments =
  typeof BrowserHarnessDynamicToolArgumentsSchema.Type;

export interface RunBrowserHarnessDynamicToolInput {
  readonly rawArguments: unknown;
  readonly cwd: string;
  readonly stateDir?: string | undefined;
  readonly runHarness?: BrowserHarnessRunner | undefined;
  readonly runner?: EvidenceRunner<BrowserHarnessRunInput> | undefined;
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

const actionInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "url"],
      properties: {
        type: { const: "navigate" },
        url: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "click" },
        selector: { type: "string" },
        text: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "text"],
      properties: {
        type: { const: "type" },
        selector: { type: "string" },
        text: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "value"],
      properties: {
        type: { const: "select" },
        selector: { type: "string" },
        value: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "wait" },
        ms: { type: "number" },
        text: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "description"],
      properties: {
        type: { const: "assert" },
        description: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        urlIncludes: { type: "string" },
        titleIncludes: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "screenshot" },
        label: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "direction"],
      properties: {
        type: { const: "scroll" },
        direction: { enum: ["up", "down"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "summary", "result"],
      properties: {
        type: { const: "done" },
        summary: { type: "string" },
        result: { enum: ["pass", "fail", "blocked"] },
      },
    },
  ],
} as const;

export const KAMI_TEST_HARNESS_DYNAMIC_TOOL_SPEC = {
  namespace: KAMI_TEST_HARNESS_TOOL_NAMESPACE,
  name: KAMI_TEST_HARNESS_TOOL_NAME,
  description:
    "Run KamiCode's visible evidence runner for the current project and return observations, screenshots, trace/video-capable artifact paths, console errors, and network failures.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["url", "actions"],
    properties: {
      url: {
        type: "string",
        description: "Absolute target URL to open, usually the project's default test URL.",
      },
      goal: {
        type: "string",
        description: "Short natural-language goal for this test run.",
      },
      actions: {
        type: "array",
        minItems: 1,
        items: actionInputSchema,
        description:
          "Browser actions to run. Prefer small batches so observations can guide the next step.",
      },
      projectId: {
        type: "string",
        description:
          "Optional stable project id. Omit it to let KamiCode derive auth storage from the working directory.",
      },
      environmentId: {
        type: "string",
        description: "Optional environment id such as local, vps-dev, or staging.",
      },
      headless: {
        type: "boolean",
        description: "Use false or omit for visible browser testing.",
      },
      timeoutMs: {
        type: "number",
        description: "Optional per-action timeout in milliseconds.",
      },
      lingerMs: {
        type: "number",
        description: "Optional delay before closing the browser, useful when the user needs to see final state.",
      },
    },
  },
} satisfies EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function isKamiTestHarnessDynamicToolCall(input: {
  readonly tool: string;
  readonly namespace?: string | null | undefined;
}): boolean {
  return (
    input.tool === KAMI_TEST_HARNESS_TOOL_NAME &&
    (input.namespace === undefined ||
      input.namespace === null ||
      input.namespace === KAMI_TEST_HARNESS_TOOL_NAMESPACE)
  );
}

export function formatEvidenceDynamicToolResult(
  result: EvidenceRunResult,
): EffectCodexSchema.DynamicToolCallResponse {
  return inputTextResponse({
    success: result.success,
    value: {
      runner: result.runner,
      status: result.status,
      success: result.success,
      runId: result.runId,
      projectId: result.projectId,
      environmentId: result.environmentId,
      goal: result.goal,
      url: result.url,
      finalUrl: result.finalUrl,
      title: result.title,
      evidenceSummary: result.evidenceSummary,
      outputSummary: result.outputSummary ?? null,
      artifactPaths: result.artifactPaths,
      observations: result.observations,
      consoleErrors: result.consoleErrors,
      networkFailures: result.networkFailures,
      steps: result.steps,
      screenshots: result.screenshots,
      videos: result.videos,
      errorMessage: result.errorMessage ?? null,
    },
  });
}

export const formatBrowserHarnessDynamicToolResult = formatEvidenceDynamicToolResult;

export function formatBrowserHarnessDynamicToolError(input: {
  readonly message: string;
  readonly details?: unknown;
}): EffectCodexSchema.DynamicToolCallResponse {
  return inputTextResponse({
    success: false,
    value: {
      status: "error",
      success: false,
      errorMessage: input.message,
      details: input.details ?? null,
    },
  });
}

export function runBrowserHarnessDynamicTool(
  input: RunBrowserHarnessDynamicToolInput,
): Effect.Effect<EffectCodexSchema.DynamicToolCallResponse, never> {
  const decodeArguments = Schema.decodeUnknownEffect(BrowserHarnessDynamicToolArgumentsSchema);
  const runner = input.runner ?? createPlaywrightEvidenceRunner({ runHarness: input.runHarness });

  return decodeArguments(input.rawArguments).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed(
          formatBrowserHarnessDynamicToolError({
            message: `Invalid ${KAMI_TEST_HARNESS_TOOL_NAME} arguments: ${formatSchemaIssue(error.issue)}`,
            details: input.rawArguments,
          }),
        ),
      onSuccess: (args) => {
        const harnessInput: BrowserHarnessRunInput = {
          url: args.url,
          cwd: input.cwd,
          actions: args.actions,
          ...(input.stateDir ? { stateDir: input.stateDir } : {}),
          ...(args.goal ? { goal: args.goal } : {}),
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(args.environmentId ? { environmentId: args.environmentId } : {}),
          ...(args.headless !== undefined ? { headless: args.headless } : {}),
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
          ...(args.lingerMs !== undefined ? { lingerMs: args.lingerMs } : {}),
        };

        return Effect.tryPromise({
          try: () => runner.run(harnessInput),
          catch: errorMessage,
        }).pipe(
          Effect.match({
            onFailure: (message) => formatBrowserHarnessDynamicToolError({ message }),
            onSuccess: formatEvidenceDynamicToolResult,
          }),
        );
      },
    }),
  );
}
