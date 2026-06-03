// @effect-diagnostics nodeBuiltinImport:off
import * as Fs from "node:fs/promises";
import path from "node:path";

import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { deriveServerPaths, ensureServerDirectories } from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag, devUrlFlag } from "./config.ts";
import {
  formatBrowserHarnessCliOutput,
  runBrowserHarness,
  type BrowserHarnessBrowser,
  type TestHarnessAction,
} from "../testing/browserHarness.ts";

class TestCommandError extends Data.TaggedError("TestCommandError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const browserFlag = Flag.choice("browser", ["chromium", "firefox", "webkit"]).pipe(
  Flag.withDescription("Browser engine to launch."),
  Flag.withDefault("chromium"),
);

const headlessFlag = Flag.boolean("headless").pipe(
  Flag.withDescription("Run the browser headlessly. This is the default."),
  Flag.withDefault(true),
);

const visibleFlag = Flag.boolean("visible").pipe(
  Flag.withDescription("Open a visible browser window. Use only when live viewing is intended."),
  Flag.withDefault(false),
);

const noVideoFlag = Flag.boolean("no-video").pipe(
  Flag.withDescription("Disable Playwright video recording."),
  Flag.withDefault(false),
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Print the full harness result as JSON."),
  Flag.withDefault(false),
);

const browserCommandServerFlags = {
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
} as const;

interface BrowserCommandFlags {
  readonly url: string;
  readonly baseDir: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly browser: string;
  readonly headless: boolean;
  readonly visible: boolean;
  readonly noVideo: boolean;
  readonly json: boolean;
  readonly goal: Option.Option<string>;
  readonly script: Option.Option<string>;
  readonly actions: Option.Option<string>;
  readonly artifactsDir: Option.Option<string>;
  readonly storageState: Option.Option<string>;
  readonly projectId: Option.Option<string>;
  readonly environmentId: Option.Option<string>;
  readonly auth: Option.Option<string>;
  readonly authCredential: Option.Option<string>;
  readonly authExpectation: Option.Option<"unknown" | "anonymous" | "authenticated">;
  readonly timeoutMs: number;
  readonly lingerMs: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

function resolveFromCwd(cwd: string, pathname: string): string {
  return path.isAbsolute(pathname) ? path.normalize(pathname) : path.resolve(cwd, pathname);
}

function parseOptionalUrl(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseHarnessActions(raw: string, sourcePath: string): ReadonlyArray<TestHarnessAction> {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Harness actions file '${sourcePath}' must contain a JSON array.`);
  }

  const allowedTypes = new Set([
    "navigate",
    "click",
    "type",
    "select",
    "wait",
    "assert",
    "screenshot",
    "scroll",
    "done",
  ]);
  for (const [index, action] of parsed.entries()) {
    if (!isRecord(action) || typeof action.type !== "string" || !allowedTypes.has(action.type)) {
      throw new Error(`Harness action ${index + 1} in '${sourcePath}' has an invalid type.`);
    }
  }
  return parsed as ReadonlyArray<TestHarnessAction>;
}

const readHarnessActions = (actionsPath: string, cwd: string) =>
  Effect.tryPromise({
    try: async () => {
      const resolvedPath = resolveFromCwd(cwd, actionsPath);
      const raw = await Fs.readFile(resolvedPath, "utf8");
      return parseHarnessActions(raw, resolvedPath);
    },
    catch: (cause) => new TestCommandError({ message: errorMessage(cause), cause }),
  });

const runBrowserCommand = (flags: BrowserCommandFlags) =>
  Effect.gen(function* () {
    const baseDir = yield* resolveBaseDir(
      Option.getOrUndefined(flags.baseDir) ?? process.env.T3CODE_HOME,
    );
    const devUrl =
      Option.getOrUndefined(flags.devUrl) ?? parseOptionalUrl(process.env.VITE_DEV_SERVER_URL);
    const paths = yield* deriveServerPaths(baseDir, devUrl);
    yield* ensureServerDirectories(paths);
    const cwd = process.cwd();
    const actions = Option.isSome(flags.actions)
      ? yield* readHarnessActions(flags.actions.value, cwd)
      : undefined;
    const auth =
      Option.isSome(flags.auth) && flags.auth.value === "kamicode-pairing"
        ? {
            type: "kamicode-pairing" as const,
            credential: Option.getOrUndefined(flags.authCredential) ?? "",
          }
        : undefined;
    if (Option.isSome(flags.auth) && !auth?.credential) {
      return yield* new TestCommandError({
        message: "--auth-credential is required when --auth kamicode-pairing is used.",
      });
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        runBrowserHarness({
          url: flags.url,
          cwd,
          stateDir: paths.stateDir,
          browser: flags.browser as BrowserHarnessBrowser,
          headless: flags.visible ? false : flags.headless,
          recordVideo: !flags.noVideo,
          timeoutMs: flags.timeoutMs,
          lingerMs: flags.lingerMs,
          viewport: {
            width: flags.viewportWidth,
            height: flags.viewportHeight,
          },
          ...(Option.isSome(flags.goal) ? { goal: flags.goal.value } : {}),
          ...(Option.isSome(flags.script) ? { scriptPath: flags.script.value } : {}),
          ...(actions ? { actions } : {}),
          ...(Option.isSome(flags.artifactsDir) ? { artifactsDir: flags.artifactsDir.value } : {}),
          ...(Option.isSome(flags.storageState)
            ? { storageStatePath: flags.storageState.value }
            : {}),
          ...(Option.isSome(flags.projectId) ? { projectId: flags.projectId.value } : {}),
          ...(Option.isSome(flags.environmentId)
            ? { environmentId: flags.environmentId.value }
            : {}),
          ...(Option.isSome(flags.authExpectation)
            ? { authExpectation: flags.authExpectation.value }
            : {}),
          ...(auth ? { auth } : {}),
        }),
      catch: (cause) => new TestCommandError({ message: errorMessage(cause), cause }),
    });

    yield* Console.log(
      // @effect-diagnostics-next-line preferSchemaOverJson:off - This is human-facing CLI output.
      flags.json ? JSON.stringify(result, null, 2) : formatBrowserHarnessCliOutput(result),
    );
    if (!result.success) {
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }
    return result;
  });

const browserCommand = Command.make("browser", {
  ...browserCommandServerFlags,
  url: Argument.string("url").pipe(Argument.withDescription("URL to open and test.")),
  browser: browserFlag,
  headless: headlessFlag,
  visible: visibleFlag,
  noVideo: noVideoFlag,
  json: jsonFlag,
  goal: Flag.string("goal").pipe(Flag.withDescription("Human-readable test goal."), Flag.optional),
  script: Flag.string("script").pipe(
    Flag.withDescription(
      "Optional JS/MJS script exporting default async ({ page, context, step, screenshot }) => {}.",
    ),
    Flag.optional,
  ),
  actions: Flag.string("actions").pipe(
    Flag.withDescription("Optional JSON file containing ordered TestHarnessAction objects."),
    Flag.optional,
  ),
  artifactsDir: Flag.string("artifacts-dir").pipe(
    Flag.withDescription("Artifact root directory. Defaults to KamiCode app data."),
    Flag.optional,
  ),
  storageState: Flag.string("storage-state").pipe(
    Flag.withDescription(
      "Path to Playwright storage state. Defaults to KamiCode app data per project.",
    ),
    Flag.optional,
  ),
  projectId: Flag.string("project-id").pipe(
    Flag.withDescription("Stable project key for storage state and artifacts."),
    Flag.optional,
  ),
  environmentId: Flag.string("environment-id").pipe(
    Flag.withDescription("Project test environment id. Defaults to default."),
    Flag.optional,
  ),
  auth: Flag.choice("auth", ["kamicode-pairing"]).pipe(
    Flag.withDescription("Optional auth flow to run before testing, for example kamicode-pairing."),
    Flag.optional,
  ),
  authCredential: Flag.string("auth-credential").pipe(
    Flag.withDescription("Credential for the selected auth flow. Avoid committing or logging it."),
    Flag.optional,
  ),
  authExpectation: Flag.choice("auth-expectation", ["unknown", "anonymous", "authenticated"]).pipe(
    Flag.withDescription(
      "Expected auth state for the target. Authenticated runs that land on login/auth are blocked.",
    ),
    Flag.optional,
  ),
  timeoutMs: Flag.integer("timeout-ms").pipe(
    Flag.withDescription("Default Playwright timeout in milliseconds."),
    Flag.withDefault(30_000),
  ),
  lingerMs: Flag.integer("linger-ms").pipe(
    Flag.withDescription("Keep the browser open after the run for this many milliseconds."),
    Flag.withDefault(0),
  ),
  viewportWidth: Flag.integer("viewport-width").pipe(
    Flag.withDescription("Browser viewport width."),
    Flag.withDefault(1440),
  ),
  viewportHeight: Flag.integer("viewport-height").pipe(
    Flag.withDescription("Browser viewport height."),
    Flag.withDefault(960),
  ),
}).pipe(
  Command.withDescription(
    "Run a headless recorded Playwright browser test harness and write artifacts.",
  ),
  Command.withHandler((flags) => runBrowserCommand(flags)),
);

export const testCommand = Command.make("test").pipe(
  Command.withDescription("Run KamiCode testing harness tools."),
  Command.withSubcommands([browserCommand]),
);
