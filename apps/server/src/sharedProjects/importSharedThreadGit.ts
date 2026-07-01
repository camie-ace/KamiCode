import * as Effect from "effect/Effect";

import { ProcessRunner } from "../processRunner.ts";
import { SharedProjectsError } from "./Services/SharedProjects.ts";

function sanitizeBranchSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 36);
}

export function sharedSessionBranchName(input: {
  readonly title: string;
  readonly sourceSharedThreadId: string;
  readonly suggestedBranch: string | null;
}): string {
  if (input.suggestedBranch && input.suggestedBranch.trim().length > 0) {
    return input.suggestedBranch.trim();
  }
  const titlePart = sanitizeBranchSegment(input.title) || "shared-session";
  const idPart = input.sourceSharedThreadId
    .replace(/[^a-zA-Z0-9]/gu, "")
    .slice(-8)
    .toLowerCase();
  return `shared/${titlePart}-${idPart || "import"}`;
}

async function runGit(
  processRunner: ProcessRunner,
  cwd: string,
  args: ReadonlyArray<string>,
): Promise<string> {
  const result = await Effect.runPromise(
    processRunner.run({
      command: "git",
      args,
      cwd,
      timeout: "30 seconds",
      outputMode: "truncate",
    }),
  );
  if (result.code !== 0) {
    throw new SharedProjectsError({
      message: `Git ${args.join(" ")} failed while preparing the imported shared session branch.`,
      status: 500,
      cause: result.stderr || result.stdout,
    });
  }
  return result.stdout.trim();
}

export const prepareSharedThreadImportBranch = (input: {
  readonly cwd: string;
  readonly branchName: string;
  readonly stashLabel: string;
}): Effect.Effect<
  {
    readonly branch: string;
    readonly stashedChanges: boolean;
    readonly stashName: string | null;
  },
  SharedProjectsError,
  ProcessRunner
> =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner;
    const statusResult = yield* processRunner
      .run({
        command: "git",
        args: ["status", "--porcelain"],
        cwd: input.cwd,
        timeout: "30 seconds",
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SharedProjectsError({
              message: "Failed to inspect git status before importing the shared session.",
              status: 500,
              cause,
            }),
        ),
      );
    if (statusResult.code !== 0) {
      return yield* new SharedProjectsError({
        message: "The target project is not a valid git checkout.",
        status: 400,
      });
    }

    let stashName: string | null = null;
    const hasDirtyChanges = statusResult.stdout.trim().length > 0;
    if (hasDirtyChanges) {
      stashName = input.stashLabel;
      yield* Effect.tryPromise({
        try: () =>
          runGit(processRunner, input.cwd, [
            "stash",
            "push",
            "--include-untracked",
            "--message",
            stashName,
          ]),
        catch: (cause) =>
          cause instanceof SharedProjectsError
            ? cause
            : new SharedProjectsError({
                message: "Failed to stash local changes before importing the shared session.",
                status: 500,
                cause,
              }),
      });
    }

    const branchExistsResult = yield* processRunner
      .run({
        command: "git",
        args: ["rev-parse", "--verify", input.branchName],
        cwd: input.cwd,
        timeout: "30 seconds",
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SharedProjectsError({
              message: "Failed to inspect target branch before importing the shared session.",
              status: 500,
              cause,
            }),
        ),
      );

    yield* Effect.tryPromise({
      try: () =>
        branchExistsResult.code === 0
          ? runGit(processRunner, input.cwd, ["switch", input.branchName])
          : runGit(processRunner, input.cwd, ["switch", "-c", input.branchName]),
      catch: (cause) =>
        cause instanceof SharedProjectsError
          ? cause
          : new SharedProjectsError({
              message: "Failed to switch to the imported shared session branch.",
              status: 500,
              cause,
            }),
    });

    return {
      branch: input.branchName,
      stashedChanges: hasDirtyChanges,
      stashName,
    } as const;
  });

export async function sharedImportStashLabel(title: string): Promise<string> {
  return `kamicode-shared-import:${sanitizeBranchSegment(title) || "session"}:${new Date().toISOString()}`;
}
