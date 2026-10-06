import {
  createSdkMcpServer,
  tool,
  type Options as ClaudeQueryOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type * as Effect from "effect/Effect";
import {
  KAMI_TEST_HARNESS_TOOL_NAMESPACE,
  KAMI_TEST_HARNESS_TOOL_NAME,
  runBrowserHarnessDynamicTool,
} from "../testing/browserHarnessDynamicTool.ts";

const ClaudeTestHarnessActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({
    type: z.literal("click"),
    selector: z.string().optional(),
    text: z.string().optional(),
  }),
  z.object({ type: z.literal("type"), selector: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("select"), selector: z.string().optional(), value: z.string() }),
  z.object({ type: z.literal("wait"), ms: z.number().optional(), text: z.string().optional() }),
  z.object({
    type: z.literal("assert"),
    description: z.string(),
    selector: z.string().optional(),
    text: z.string().optional(),
    urlIncludes: z.string().optional(),
    titleIncludes: z.string().optional(),
  }),
  z.object({ type: z.literal("screenshot"), label: z.string().optional() }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.object({
    type: z.literal("done"),
    summary: z.string(),
    result: z.enum(["pass", "fail", "blocked"]),
  }),
]);

const ClaudeTestHarnessToolInputSchema = {
  url: z.string().describe("Absolute URL to open in the headless recorded browser."),
  goal: z.string().optional().describe("Short natural-language goal for this evidence run."),
  actions: z
    .array(ClaudeTestHarnessActionSchema)
    .min(1)
    .describe(
      "Browser actions to perform. Use small batches so observations can guide next steps.",
    ),
  projectId: z.string().optional(),
  environmentId: z.string().optional(),
  headless: z
    .boolean()
    .optional()
    .describe("Defaults to true. Set false only when the user explicitly requests live viewing."),
  recordVideo: z.boolean().optional().describe("Defaults to true."),
  authExpectation: z
    .enum(["unknown", "anonymous", "authenticated"])
    .optional()
    .describe("Use authenticated for gated features and anonymous for auth/login screens."),
  timeoutMs: z.number().optional(),
  lingerMs: z.number().optional(),
  auth: z
    .object({
      type: z.literal("kamicode-pairing"),
      required: z.boolean().optional(),
    })
    .optional()
    .describe("Request short-lived KamiCode pairing auth when testing KamiCode itself."),
};

type ClaudeTestHarnessRunEffect = <A>(effect: Effect.Effect<A, never>) => Promise<A>;

function dynamicToolResponseToClaudeToolText(response: {
  readonly contentItems: ReadonlyArray<Record<string, unknown>>;
}): string {
  return response.contentItems
    .map((item) =>
      item.type === "inputText" && typeof item.text === "string" ? item.text : JSON.stringify(item),
    )
    .join("\n");
}

export function createClaudeTestHarnessMcpServer(input: {
  readonly cwd: string;
  readonly stateDir: string;
  readonly runEffect: ClaudeTestHarnessRunEffect;
  readonly issueTestHarnessPairingCredential?: (() => Effect.Effect<string, string>) | undefined;
}): NonNullable<ClaudeQueryOptions["mcpServers"]>[string] {
  return createSdkMcpServer({
    name: KAMI_TEST_HARNESS_TOOL_NAMESPACE,
    version: "0.1.0",
    tools: [
      tool(
        KAMI_TEST_HARNESS_TOOL_NAME,
        "Run KamiCode's headless recorded Playwright evidence harness and return screenshots, video, trace, console/network summaries, timings, and final browser state.",
        ClaudeTestHarnessToolInputSchema,
        async (args) => {
          const response = await input.runEffect(
            runBrowserHarnessDynamicTool({
              rawArguments: args,
              cwd: input.cwd,
              stateDir: input.stateDir,
              ...(input.issueTestHarnessPairingCredential
                ? { issueKamiCodePairingCredential: input.issueTestHarnessPairingCredential }
                : {}),
            }),
          );

          return {
            isError: !response.success,
            content: [
              {
                type: "text",
                text: dynamicToolResponseToClaudeToolText(response),
              },
            ],
          };
        },
      ),
    ],
  });
}
