// @effect-diagnostics nodeBuiltinImport:off - Effect FileSystem has no free-space query or directory-entry API.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  GitCommandError,
  VcsProcessExitError,
  type VcsSwitchRefInput,
  type VcsSwitchRefResult,
  type VcsCreateRefInput,
  type VcsCreateRefResult,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsResult,
  type VcsInitInput,
  type VcsListRefsInput,
  type VcsListRefsResult,
  type VcsPullResult,
  type VcsRemoveWorktreeInput,
  type VcsStatusInput,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import {
  makeGitVcsDriverCore,
  PATCH_RENDER_PREFIX_ARGS,
  splitNullSeparatedGitStdoutPaths,
} from "./GitVcsDriverCore.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

export interface ExecuteGitInput {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number | null;
  readonly maxOutputBytes?: number;
  readonly appendTruncationMarker?: boolean;
  readonly progress?: ExecuteGitProgress;
}

export interface ExecuteGitResult {
  readonly exitCode: ChildProcessSpawner.ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface GitStatusDetails {
  isRepo: boolean;
  sourceControlProvider?: VcsStatusResult["sourceControlProvider"];
  hasOriginRemote: boolean;
  isDefaultBranch: boolean;
  branch: string | null;
  upstreamRef: string | null;
  hasWorkingTreeChanges: boolean;
  workingTree: VcsStatusResult["workingTree"];
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  aheadOfDefaultCount: number;
}

export interface GitRemoteStatusDetails {
  isRepo: boolean;
  defaultBranch: string | null;
  isDefaultBranch: boolean;
  branch: string | null;
  upstreamRef: string | null;
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  aheadOfDefaultCount: number;
}

export interface GitPreparedCommitContext {
  stagedSummary: string;
  stagedPatch: string;
}

export interface ExecuteGitProgress {
  readonly onStdoutLine?: (line: string) => Effect.Effect<void, never>;
  readonly onStderrLine?: (line: string) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitProgress {
  readonly onOutputLine?: (input: {
    stream: "stdout" | "stderr";
    text: string;
  }) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitOptions {
  readonly timeoutMs?: number;
  readonly progress?: GitCommitProgress;
}

export interface GitPushResult {
  status: "pushed" | "skipped_up_to_date";
  branch: string;
  upstreamBranch?: string | undefined;
  setUpstream?: boolean | undefined;
}

const DEFAULT_CHECKPOINT_MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_CHECKPOINT_MIN_FREE_PERCENT = 15;
const NESTED_REPOSITORY_SCAN_LIMIT = 256;
const CHECKPOINT_QUARANTINE_STALE_MS = 60 * 60 * 1_000;
const CHECKPOINT_QUARANTINE_PATTERN = /^t3-checkpoint-quarantine-(\d+)-[0-9a-f-]+$/i;
const NESTED_REPOSITORY_SCAN_EXCLUDES = new Set([
  ".git",
  ".next",
  ".cache",
  "build",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

export function assessCheckpointDiskSpace(input: {
  readonly availableBytes: bigint;
  readonly totalBytes: bigint;
  readonly minFreeBytes: number;
  readonly minFreePercent: number;
}): VcsDriver.VcsCheckpointCaptureReadiness {
  const minFreeBytes = BigInt(Math.max(0, Math.trunc(input.minFreeBytes)));
  const boundedPercent = Math.min(100, Math.max(0, Math.trunc(input.minFreePercent)));
  const percentReserve = (input.totalBytes * BigInt(boundedPercent)) / 100n;
  const requiredBytes = minFreeBytes > percentReserve ? minFreeBytes : percentReserve;
  if (input.availableBytes >= requiredBytes) {
    return { status: "ready" };
  }
  return {
    status: "suppressed",
    reason: "storage-pressure",
    detail: `Automatic checkpoints require ${requiredBytes.toString()} free bytes; ${input.availableBytes.toString()} are available.`,
  };
}

async function findNestedGitMetadata(
  workspaceRoot: string,
  join: (...parts: ReadonlyArray<string>) => string,
): Promise<string | null> {
  const queue: Array<{ readonly directory: string; readonly depth: number }> = [];
  const rootEntries = await NodeFSP.readdir(workspaceRoot, { withFileTypes: true });
  for (const entry of rootEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && !NESTED_REPOSITORY_SCAN_EXCLUDES.has(entry.name)) {
      queue.push({ directory: join(workspaceRoot, entry.name), depth: 1 });
    }
  }

  let scanned = 0;
  while (queue.length > 0 && scanned < NESTED_REPOSITORY_SCAN_LIMIT) {
    const candidate = queue.shift();
    if (!candidate) break;
    scanned += 1;

    try {
      await NodeFSP.access(join(candidate.directory, ".git"));
      return candidate.directory;
    } catch {
      // This directory is not a repository root. A bounded second level lets
      // workspace containers such as `.tmp/<checkout>` be recognized without
      // walking a large untracked tree.
    }

    if (candidate.depth >= 2) continue;
    try {
      const children = await NodeFSP.readdir(candidate.directory, { withFileTypes: true });
      for (const child of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
        if (child.isDirectory() && !NESTED_REPOSITORY_SCAN_EXCLUDES.has(child.name)) {
          queue.push({
            directory: join(candidate.directory, child.name),
            depth: candidate.depth + 1,
          });
        }
      }
    } catch {
      // Permission and concurrent-removal failures are inconclusive, so they
      // must not suppress checkpoints by themselves.
    }
  }
  return null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function sweepStaleCheckpointQuarantines(
  gitCommonDir: string,
  nowMs: number,
): Promise<number> {
  const entries = await NodeFSP.readdir(gitCommonDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = CHECKPOINT_QUARANTINE_PATTERN.exec(entry.name);
    if (!match) continue;
    const ownerPid = Number(match[1]);
    if (!Number.isSafeInteger(ownerPid) || processIsAlive(ownerPid)) continue;
    const candidate = NodePath.join(gitCommonDir, entry.name);
    try {
      const stat = await NodeFSP.stat(candidate);
      if (nowMs - stat.mtimeMs < CHECKPOINT_QUARANTINE_STALE_MS) continue;
      await NodeFSP.rm(candidate, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A concurrent capture cleanup or permission boundary preserves this
      // candidate without preventing other proven-orphan sweeps.
    }
  }
  return removed;
}

export interface GitRangeContext {
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface GitRenameBranchInput {
  cwd: string;
  oldBranch: string;
  newBranch: string;
}

export interface GitRenameBranchResult {
  branch: string;
}

export interface GitFetchPullRequestBranchInput {
  cwd: string;
  prNumber: number;
  branch: string;
}

export interface GitFetchPullRequestHeadCommitInput {
  cwd: string;
  prNumber: number;
}

export interface GitResolveCommitInput {
  cwd: string;
  revision: string;
}

export interface GitResolveCommitResult {
  commitSha: string;
}

export interface GitRefreshCheckedOutBranchInput {
  cwd: string;
  targetCommit: string;
  /**
   * Commit the checkout is allowed to be hard-reset away from: the upstream commit read before
   * the fetch. HEAD sitting there means the checkout holds no work of its own.
   */
  resetWhenHeadCommit?: string | null | undefined;
}

export interface GitRefreshCheckedOutBranchResult {
  headCommit: string;
  moved: boolean;
  onTarget: boolean;
}

export interface GitEnsureRemoteInput {
  cwd: string;
  preferredName: string;
  url: string;
}

export interface GitFetchRemoteBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
  localBranch: string;
}

export interface GitFetchRemoteTrackingBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
}

export interface GitFetchRemoteInput {
  cwd: string;
  remoteName: string;
}

export interface GitRemoteExistsInput {
  cwd: string;
  remoteName: string;
}

export interface GitRemoteBranchExistsInput extends GitRemoteExistsInput {
  refName: string;
}

export interface GitResolveRemoteTrackingCommitInput {
  cwd: string;
  refName: string;
  fallbackRemoteName: string;
}

export interface GitResolveRemoteTrackingCommitResult {
  commitSha: string;
  remoteRefName: string;
}

export interface GitSetBranchUpstreamInput {
  cwd: string;
  branch: string;
  remoteName: string;
  remoteBranch: string;
}

export interface GitRemoteStatusOptions {
  readonly refreshUpstream?: boolean;
}

export class GitVcsDriver extends Context.Service<
  GitVcsDriver,
  {
    readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>;
    readonly status: (input: VcsStatusInput) => Effect.Effect<VcsStatusResult, GitCommandError>;
    readonly statusDetails: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>;
    readonly statusDetailsLocal: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>;
    readonly statusDetailsRemote: (
      cwd: string,
      options?: GitRemoteStatusOptions,
    ) => Effect.Effect<GitRemoteStatusDetails, GitCommandError>;
    readonly prepareCommitContext: (
      cwd: string,
      filePaths?: readonly string[],
    ) => Effect.Effect<GitPreparedCommitContext | null, GitCommandError>;
    readonly commit: (
      cwd: string,
      subject: string,
      body: string,
      options?: GitCommitOptions,
    ) => Effect.Effect<{ commitSha: string }, GitCommandError>;
    readonly pushCurrentBranch: (
      cwd: string,
      fallbackBranch: string | null,
      options?: { readonly remoteName?: string | null },
    ) => Effect.Effect<GitPushResult, GitCommandError>;
    readonly readRangeContext: (
      cwd: string,
      baseRef: string,
    ) => Effect.Effect<GitRangeContext, GitCommandError>;
    readonly getReviewDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, GitCommandError>;
    readonly getReviewDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, GitCommandError>;
    readonly readConfigValue: (
      cwd: string,
      key: string,
    ) => Effect.Effect<string | null, GitCommandError>;
    readonly listRefs: (
      input: VcsListRefsInput,
    ) => Effect.Effect<VcsListRefsResult, GitCommandError>;
    readonly pullCurrentBranch: (cwd: string) => Effect.Effect<VcsPullResult, GitCommandError>;
    readonly createWorktree: (
      input: VcsCreateWorktreeInput,
    ) => Effect.Effect<VcsCreateWorktreeResult, GitCommandError>;
    readonly fetchPullRequestBranch: (
      input: GitFetchPullRequestBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
    /** Fetches `refs/pull/<n>/head` without writing a branch, for heads that exist nowhere else. */
    readonly fetchPullRequestHeadCommit: (
      input: GitFetchPullRequestHeadCommitInput,
    ) => Effect.Effect<GitResolveCommitResult, GitCommandError>;
    readonly resolveCommit: (
      input: GitResolveCommitInput,
    ) => Effect.Effect<GitResolveCommitResult, GitCommandError>;
    /** Moves the branch checked out in `cwd` onto `targetCommit`, from inside that worktree. */
    readonly refreshCheckedOutBranch: (
      input: GitRefreshCheckedOutBranchInput,
    ) => Effect.Effect<GitRefreshCheckedOutBranchResult, GitCommandError>;
    readonly ensureRemote: (input: GitEnsureRemoteInput) => Effect.Effect<string, GitCommandError>;
    readonly resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>;
    readonly resolveDefaultBranchName: (
      cwd: string,
      remoteName: string,
    ) => Effect.Effect<string | null, GitCommandError>;
    readonly fetchRemote: (input: GitFetchRemoteInput) => Effect.Effect<void, GitCommandError>;
    readonly remoteExists: (input: GitRemoteExistsInput) => Effect.Effect<boolean, GitCommandError>;
    readonly remoteBranchExists: (
      input: GitRemoteBranchExistsInput,
    ) => Effect.Effect<boolean, GitCommandError>;
    readonly resolveRemoteTrackingCommit: (
      input: GitResolveRemoteTrackingCommitInput,
    ) => Effect.Effect<GitResolveRemoteTrackingCommitResult, GitCommandError>;
    readonly fetchRemoteBranch: (
      input: GitFetchRemoteBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
    readonly fetchRemoteTrackingBranch: (
      input: GitFetchRemoteTrackingBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
    readonly setBranchUpstream: (
      input: GitSetBranchUpstreamInput,
    ) => Effect.Effect<void, GitCommandError>;
    readonly removeWorktree: (
      input: VcsRemoveWorktreeInput,
    ) => Effect.Effect<void, GitCommandError>;
    /** Drops worktree admin entries whose directory is already gone (`git worktree prune`). */
    readonly pruneWorktrees: (input: {
      readonly cwd: string;
    }) => Effect.Effect<void, GitCommandError>;
    readonly renameBranch: (
      input: GitRenameBranchInput,
    ) => Effect.Effect<GitRenameBranchResult, GitCommandError>;
    readonly createRef: (
      input: VcsCreateRefInput,
    ) => Effect.Effect<VcsCreateRefResult, GitCommandError>;
    readonly switchRef: (
      input: VcsSwitchRefInput,
    ) => Effect.Effect<VcsSwitchRefResult, GitCommandError>;
    readonly initRepo: (input: VcsInitInput) => Effect.Effect<void, GitCommandError>;
    readonly listLocalBranchNames: (cwd: string) => Effect.Effect<string[], GitCommandError>;
  }
>()("t3/vcs/GitVcsDriver") {}

const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const WORKSPACE_GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

const nowFreshness = Effect.fn("GitVcsDriver.nowFreshness")(function* () {
  const now = yield* DateTime.now;
  return {
    source: "live-local" as const,
    observedAt: now,
    expiresAt: Option.none(),
  };
});

function chunkPathsForGitCheckIgnore(relativePaths: ReadonlyArray<string>): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (chunk.length > 0 && chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }

    chunk.push(relativePath);
    chunkBytes += relativePathBytes;

    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function parseGitRemoteVerboseOutput(
  output: string,
): Map<string, { url?: string; pushUrl?: string }> {
  const remotes = new Map<string, { url?: string; pushUrl?: string }>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const name = match[1];
    const url = match[2];
    const direction = match[3];
    if (!name || !url || !direction) {
      continue;
    }
    const remote = remotes.get(name) ?? {};
    if (direction === "fetch") {
      remote.url = url;
    } else {
      remote.pushUrl = url;
    }
    remotes.set(name, remote);
  }
  return remotes;
}

const gitCommand = (
  process: VcsProcess.VcsProcess["Service"],
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options?: {
    readonly stdin?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowNonZeroExit?: boolean;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly outputMode?: VcsProcess.VcsProcessInput["outputMode"];
    readonly appendTruncationMarker?: boolean;
  },
) =>
  process.run({
    operation,
    command: "git",
    args: ["-C", cwd, ...args],
    cwd,
    spawnCwd: globalThis.process.cwd(),
    ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(options?.env !== undefined ? { env: options.env } : {}),
    ...(options?.allowNonZeroExit !== undefined
      ? { allowNonZeroExit: options.allowNonZeroExit }
      : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
    ...(options?.outputMode !== undefined ? { outputMode: options.outputMode } : {}),
    ...(options?.appendTruncationMarker !== undefined
      ? { appendTruncationMarker: options.appendTruncationMarker }
      : {}),
  });

export const makeVcsDriverShape = Effect.fn("makeGitVcsDriverShape")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const serverConfig = Option.getOrUndefined(
    yield* Effect.serviceOption(ServerConfig.ServerConfig),
  );
  const checkpointLocks = new Map<string, Semaphore.Semaphore>();
  const checkpointLocksMutex = yield* Semaphore.make(1);
  const capabilities = {
    kind: "git" as const,
    supportsWorktrees: true,
    supportsBookmarks: false,
    supportsAtomicSnapshot: false,
    supportsPushDefaultRemote: true,
    ignoreClassifier: "native" as const,
  };

  const isInsideWorkTree: VcsDriver.VcsDriver["Service"]["isInsideWorkTree"] = (cwd) =>
    gitCommand(
      vcsProcess,
      "GitVcsDriver.isInsideWorkTree",
      cwd,
      ["rev-parse", "--is-inside-work-tree"],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      },
    ).pipe(Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"));

  const execute: VcsDriver.VcsDriver["Service"]["execute"] = (input) =>
    gitCommand(vcsProcess, input.operation, input.cwd, input.args, {
      ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
      ...(input.appendTruncationMarker !== undefined
        ? { appendTruncationMarker: input.appendTruncationMarker }
        : {}),
    });

  const detectRepository: VcsDriver.VcsDriver["Service"]["detectRepository"] = Effect.fn(
    "detectRepository",
  )(function* (cwd) {
    if (!(yield* isInsideWorkTree(cwd))) {
      return null;
    }

    const root = yield* gitCommand(vcsProcess, "GitVcsDriver.detectRepository.root", cwd, [
      "rev-parse",
      "--show-toplevel",
    ]);
    const gitCommonDir = yield* gitCommand(
      vcsProcess,
      "GitVcsDriver.detectRepository.commonDir",
      cwd,
      ["rev-parse", "--git-common-dir"],
    ).pipe(Effect.orElseSucceed(() => null));

    return {
      kind: "git" as const,
      rootPath: root.stdout.trim(),
      metadataPath: gitCommonDir?.stdout.trim() || null,
      freshness: yield* nowFreshness(),
    };
  });

  const listWorkspaceFiles: VcsDriver.VcsDriver["Service"]["listWorkspaceFiles"] = (cwd) =>
    gitCommand(
      vcsProcess,
      "GitVcsDriver.listWorkspaceFiles",
      cwd,
      [
        ...WORKSPACE_GIT_HARDENED_CONFIG_ARGS,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        allowNonZeroExit: true,
        timeoutMs: 20_000,
        maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
        appendTruncationMarker: true,
      },
    ).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.gen(function* () {
              const freshness = yield* nowFreshness();
              return {
                paths: splitNullSeparatedGitStdoutPaths(result),
                truncated: result.stdoutTruncated,
                freshness,
              };
            })
          : Effect.fail(
              new VcsProcessExitError({
                operation: "GitVcsDriver.listWorkspaceFiles",
                command: "git ls-files",
                cwd,
                exitCode: result.exitCode,
                detail: result.stderr.trim() || "git ls-files failed",
              }),
            ),
      ),
    );

  const listRemotes: VcsDriver.VcsDriver["Service"]["listRemotes"] = Effect.fn("listRemotes")(
    function* (cwd) {
      const result = yield* gitCommand(
        vcsProcess,
        "GitVcsDriver.listRemotes",
        cwd,
        ["remote", "-v"],
        {
          allowNonZeroExit: true,
          timeoutMs: 5_000,
          maxOutputBytes: 64 * 1024,
        },
      );

      if (result.exitCode !== 0) {
        return yield* new VcsProcessExitError({
          operation: "GitVcsDriver.listRemotes",
          command: "git remote -v",
          cwd,
          exitCode: result.exitCode,
          detail: result.stderr.trim() || "git remote -v failed",
        });
      }

      const parsed = parseGitRemoteVerboseOutput(result.stdout);
      const remotes = Array.from(parsed.entries()).flatMap(([name, remote]) => {
        if (!remote.url) {
          return [];
        }
        return [
          {
            name,
            url: remote.url,
            pushUrl: remote.pushUrl ? Option.some(remote.pushUrl) : Option.none(),
            isPrimary: name === "origin",
          },
        ];
      });

      return {
        remotes,
        freshness: yield* nowFreshness(),
      };
    },
  );

  const filterIgnoredPaths: VcsDriver.VcsDriver["Service"]["filterIgnoredPaths"] = Effect.fn(
    "filterIgnoredPaths",
  )(function* (cwd, relativePaths) {
    if (relativePaths.length === 0) {
      return relativePaths;
    }

    const ignoredPaths = new Set<string>();
    const chunks = chunkPathsForGitCheckIgnore(relativePaths);

    for (const chunk of chunks) {
      const result = yield* gitCommand(
        vcsProcess,
        "GitVcsDriver.filterIgnoredPaths",
        cwd,
        [...WORKSPACE_GIT_HARDENED_CONFIG_ARGS, "check-ignore", "--no-index", "-z", "--stdin"],
        {
          stdin: `${chunk.join("\0")}\0`,
          allowNonZeroExit: true,
          timeoutMs: 20_000,
          maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
          appendTruncationMarker: true,
        },
      );

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return yield* new VcsProcessExitError({
          operation: "GitVcsDriver.filterIgnoredPaths",
          command: "git check-ignore",
          cwd,
          exitCode: result.exitCode,
          detail: result.stderr.trim() || "git check-ignore failed",
        });
      }

      for (const ignoredPath of splitNullSeparatedGitStdoutPaths(result)) {
        ignoredPaths.add(ignoredPath);
      }
    }

    if (ignoredPaths.size === 0) {
      return relativePaths;
    }

    return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
  });

  const initRepository: VcsDriver.VcsDriver["Service"]["initRepository"] = (input) =>
    gitCommand(vcsProcess, "GitVcsDriver.initRepository", input.cwd, ["init"], {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    }).pipe(Effect.asVoid);

  const resolveHeadCommit = (cwd: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.resolveHeadCommit",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const hasHeadCommit = (cwd: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.hasHeadCommit",
      cwd,
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.exitCode === 0));

  const resolveCheckpointCommit = (cwd: string, checkpointRef: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.resolveCheckpointCommit",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const resolveGitCommonDir = (cwd: string) =>
    Effect.gen(function* () {
      const result = yield* execute({
        operation: "GitVcsDriver.checkpoints.resolveGitCommonDir",
        cwd,
        args: ["rev-parse", "--git-common-dir"],
      });
      const gitCommonDir = result.stdout.trim();
      return path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
    });

  const checkpointLockFor = (gitCommonDir: string) =>
    checkpointLocksMutex.withPermits(1)(
      Effect.gen(function* () {
        const existing = checkpointLocks.get(gitCommonDir);
        if (existing) {
          return existing;
        }
        const created = yield* Semaphore.make(1);
        checkpointLocks.set(gitCommonDir, created);
        return created;
      }),
    );

  const checkpoints: VcsDriver.VcsCheckpointOps = {
    assessCapture: Effect.fn("GitVcsDriver.checkpoints.assessCapture")(function* (input) {
      // Sweep exact, dead-owner quarantine directories before consulting the
      // disk watermark. Otherwise one interrupted large capture could consume
      // the reserve and then prevent the cleanup path from running.
      const gitCommonDir = yield* resolveGitCommonDir(input.cwd);
      const sweepNowMs = yield* Clock.currentTimeMillis;
      const sweptQuarantines = yield* Effect.tryPromise(() =>
        sweepStaleCheckpointQuarantines(gitCommonDir, sweepNowMs),
      ).pipe(Effect.orElseSucceed(() => 0));
      if (sweptQuarantines > 0) {
        yield* Effect.logInfo("Removed stale Git checkpoint quarantines.", {
          cwd: input.cwd,
          removed: sweptQuarantines,
        });
      }

      const disk = yield* Effect.tryPromise(() => NodeFSP.statfs(input.cwd, { bigint: true })).pipe(
        Effect.option,
      );
      if (Option.isSome(disk)) {
        const diskReadiness = assessCheckpointDiskSpace({
          availableBytes: disk.value.bavail * disk.value.bsize,
          totalBytes: disk.value.blocks * disk.value.bsize,
          minFreeBytes: serverConfig?.checkpointMinFreeBytes ?? DEFAULT_CHECKPOINT_MIN_FREE_BYTES,
          minFreePercent:
            serverConfig?.checkpointMinFreePercent ?? DEFAULT_CHECKPOINT_MIN_FREE_PERCENT,
        });
        if (diskReadiness.status === "suppressed") {
          return diskReadiness;
        }
      }

      // An unborn, empty outer repository containing another repository is a
      // workspace container, not a useful checkpoint boundary. Staging the
      // container recursively duplicates every nested checkout and dependency
      // cache, which is exactly the failure mode this guard prevents.
      if ((yield* resolveHeadCommit(input.cwd)) === null) {
        const tracked = yield* execute({
          operation: "GitVcsDriver.checkpoints.assessTrackedFiles",
          cwd: input.cwd,
          args: ["ls-files", "--cached", "-z"],
          allowNonZeroExit: true,
          maxOutputBytes: 1,
          appendTruncationMarker: false,
        });
        if (tracked.exitCode === 0 && tracked.stdout.length === 0) {
          const nestedRepository = yield* Effect.tryPromise(() =>
            findNestedGitMetadata(input.cwd, path.join),
          ).pipe(Effect.orElseSucceed(() => null));
          if (nestedRepository !== null) {
            return {
              status: "suppressed" as const,
              reason: "workspace-container" as const,
              detail: `Automatic checkpoints are disabled for an unborn outer repository containing nested repository ${nestedRepository}.`,
            };
          }
        }
      }

      return { status: "ready" as const };
    }),

    captureCheckpoint: Effect.fn("GitVcsDriver.checkpoints.captureCheckpoint")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.captureCheckpoint";
      const gitCommonDir = yield* resolveGitCommonDir(input.cwd);
      const checkpointLock = yield* checkpointLockFor(gitCommonDir);

      yield* checkpointLock.withPermits(1)(
        Effect.gen(function* () {
          const sweepNowMs = yield* Clock.currentTimeMillis;
          const sweptQuarantines = yield* Effect.tryPromise(() =>
            sweepStaleCheckpointQuarantines(gitCommonDir, sweepNowMs),
          ).pipe(Effect.orElseSucceed(() => 0));
          if (sweptQuarantines > 0) {
            yield* Effect.logInfo("Removed stale Git checkpoint quarantines.", {
              cwd: input.cwd,
              removed: sweptQuarantines,
            });
          }

          // Domain and provider-runtime turn-start events may both request the
          // same baseline. Recheck under the repository lock so only the first
          // request performs filesystem work.
          if ((yield* resolveCheckpointCommit(input.cwd, input.checkpointRef)) !== null) {
            return;
          }

          const quarantineDir = path.join(
            gitCommonDir,
            `t3-checkpoint-quarantine-${process.pid}-${NodeCrypto.randomUUID()}`,
          );
          const quarantineObjectDir = path.join(quarantineDir, "objects");
          const primaryObjectDir = path.join(gitCommonDir, "objects");
          const quarantineIndexPath = path.join(quarantineDir, "checkpoint.index");
          const quarantineRef = "refs/t3/quarantine/checkpoint";
          const cleanupQuarantine = fileSystem
            .remove(quarantineDir, { recursive: true, force: true })
            .pipe(Effect.ignore);

          yield* Effect.gen(function* () {
            yield* execute({
              operation: `${operation}.initializeQuarantine`,
              cwd: input.cwd,
              args: ["init", "--bare", "--quiet", quarantineDir],
            });
            // The isolated index may reuse unchanged trees/blobs from the real
            // repository. Persist the alternate for upload-pack as well as the
            // staging commands' environment so publication can traverse those
            // objects without copying them into the quarantine first.
            yield* fileSystem
              .writeFileString(
                path.join(quarantineObjectDir, "info", "alternates"),
                `${primaryObjectDir}\n`,
              )
              .pipe(
                Effect.mapError(
                  (error) =>
                    new VcsProcessExitError({
                      operation: `${operation}.configureAlternateObjects`,
                      command: "write checkpoint quarantine metadata",
                      cwd: input.cwd,
                      exitCode: 1,
                      detail: error.message,
                    }),
                ),
              );

            // Keep repository/worktree discovery on the real checkout so Git
            // still applies its local config, attributes, and clean filters.
            // Only the index and newly written objects are redirected.
            const stagingEnv: NodeJS.ProcessEnv = {
              ...process.env,
              GIT_INDEX_FILE: quarantineIndexPath,
              GIT_OBJECT_DIRECTORY: quarantineObjectDir,
              GIT_ALTERNATE_OBJECT_DIRECTORIES: primaryObjectDir,
              GIT_AUTHOR_NAME: "KamiCode",
              GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
              GIT_COMMITTER_NAME: "KamiCode",
              GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
            };

            const headCommit = yield* resolveHeadCommit(input.cwd);
            if (headCommit) {
              yield* execute({
                operation: `${operation}.seedIndex`,
                cwd: input.cwd,
                args: ["read-tree", headCommit],
                env: stagingEnv,
              });
            }

            yield* execute({
              operation: `${operation}.stageWorkspace`,
              cwd: input.cwd,
              args: ["add", "-A", "--", "."],
              env: stagingEnv,
            });

            const writeTreeResult = yield* execute({
              operation: `${operation}.writeTree`,
              cwd: input.cwd,
              args: ["write-tree"],
              env: stagingEnv,
            });
            const treeOid = writeTreeResult.stdout.trim();
            if (treeOid.length === 0) {
              return yield* new VcsProcessExitError({
                operation,
                command: "git write-tree",
                cwd: input.cwd,
                exitCode: 0,
                detail: "git write-tree returned an empty tree oid.",
              });
            }

            const message = `t3 checkpoint ref=${input.checkpointRef}`;
            const commitTreeResult = yield* execute({
              operation: `${operation}.commitTree`,
              cwd: input.cwd,
              args: ["commit-tree", treeOid, "-m", message],
              env: stagingEnv,
            });
            const commitOid = commitTreeResult.stdout.trim();
            if (commitOid.length === 0) {
              return yield* new VcsProcessExitError({
                operation,
                command: "git commit-tree",
                cwd: input.cwd,
                exitCode: 0,
                detail: "git commit-tree returned an empty commit oid.",
              });
            }

            yield* execute({
              operation: `${operation}.recordQuarantineRef`,
              cwd: input.cwd,
              args: ["update-ref", quarantineRef, commitOid],
              env: {
                ...stagingEnv,
                GIT_DIR: quarantineDir,
                GIT_WORK_TREE: input.cwd,
              },
            });

            // A file:// remote forces Git's pack protocol instead of a local
            // hard-link copy. Git receives and verifies the pack before the
            // atomic ref update, so interrupted publication cannot expose a
            // half-written checkpoint in the real object database.
            const publishResult = yield* execute({
              operation: `${operation}.publish`,
              cwd: input.cwd,
              args: [
                "fetch",
                "--quiet",
                "--atomic",
                "--no-tags",
                "--no-write-fetch-head",
                "--no-recurse-submodules",
                NodeURL.pathToFileURL(quarantineDir).href,
                `+${quarantineRef}:${input.checkpointRef}`,
              ],
              allowNonZeroExit: true,
              maxOutputBytes: 64 * 1024,
            });
            if (publishResult.exitCode !== 0) {
              return yield* new VcsProcessExitError({
                operation: `${operation}.publish`,
                command: "git fetch",
                cwd: input.cwd,
                exitCode: publishResult.exitCode,
                detail: publishResult.stderr.trim() || "git fetch could not publish checkpoint.",
              });
            }
          }).pipe(Effect.ensuring(cleanupQuarantine));
        }),
      );
    }),

    hasCheckpointRef: (input) =>
      resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
        Effect.map((commit) => commit !== null),
      ),

    restoreCheckpoint: Effect.fn("GitVcsDriver.checkpoints.restoreCheckpoint")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.restoreCheckpoint";

      let commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);

      if (!commitOid && input.fallbackToHead === true) {
        commitOid = yield* resolveHeadCommit(input.cwd);
      }

      if (!commitOid) {
        return false;
      }

      yield* execute({
        operation,
        cwd: input.cwd,
        args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
      });
      yield* execute({
        operation,
        cwd: input.cwd,
        args: ["clean", "-fd", "--", "."],
      });

      const headExists = yield* hasHeadCommit(input.cwd);
      if (headExists) {
        yield* execute({
          operation,
          cwd: input.cwd,
          args: ["reset", "--quiet", "--", "."],
        });
      }

      return true;
    }),

    diffCheckpoints: Effect.fn("GitVcsDriver.checkpoints.diffCheckpoints")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.diffCheckpoints";
      yield* Effect.annotateCurrentSpan({
        "checkpoint.cwd": input.cwd,
        "checkpoint.from_ref": input.fromCheckpointRef,
        "checkpoint.to_ref": input.toCheckpointRef,
        "checkpoint.ignore_whitespace": input.ignoreWhitespace,
        "checkpoint.format": input.format ?? "patch",
        "checkpoint.fallback_from_to_head": input.fallbackFromToHead,
      });

      let fromRevision: string = input.fromCheckpointRef;
      if (input.fallbackFromToHead === true) {
        const resolvedFromCommit = yield* resolveCheckpointCommit(
          input.cwd,
          input.fromCheckpointRef,
        );
        if (resolvedFromCommit) {
          fromRevision = resolvedFromCommit;
        } else {
          const headCommit = yield* resolveHeadCommit(input.cwd);
          if (!headCommit) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git diff",
              cwd: input.cwd,
              exitCode: 1,
              detail: "Checkpoint ref is unavailable for diff operation.",
            });
          }
          fromRevision = headCommit;
        }
      }

      const result = yield* execute({
        operation,
        cwd: input.cwd,
        args: [
          "diff",
          ...(input.format === "numstat" ? ["--numstat", "-z"] : ["--patch"]),
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          ...PATCH_RENDER_PREFIX_ARGS,
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
          `${fromRevision}^{commit}`,
          `${input.toCheckpointRef}^{commit}`,
        ],
        allowNonZeroExit: true,
        maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
        outputMode: input.format === "numstat" ? "error" : "truncate",
      });

      if (result.exitCode !== 0) {
        return yield* new VcsProcessExitError({
          operation,
          command: "git diff",
          cwd: input.cwd,
          exitCode: result.exitCode,
          detail: result.stderr.trim() || "Checkpoint ref is unavailable for diff operation.",
        });
      }

      return result.stdout;
    }),

    deleteCheckpointRefs: Effect.fn("GitVcsDriver.checkpoints.deleteCheckpointRefs")(
      function* (input) {
        yield* Effect.forEach(
          input.checkpointRefs,
          (checkpointRef) =>
            execute({
              operation: "GitVcsDriver.checkpoints.deleteCheckpointRefs",
              cwd: input.cwd,
              args: ["update-ref", "-d", checkpointRef],
              allowNonZeroExit: true,
            }),
          { discard: true },
        );
      },
    ),
  };

  return {
    capabilities,
    execute,
    checkpoints,
    detectRepository,
    isInsideWorkTree,
    listWorkspaceFiles,
    listRemotes,
    filterIgnoredPaths,
    initRepository,
  };
});

export const makeVcsDriver = Effect.gen(function* () {
  const driver = yield* makeVcsDriverShape();
  return VcsDriver.VcsDriver.of(driver);
});

export const make = Effect.gen(function* () {
  const git = yield* makeGitVcsDriverCore();
  return GitVcsDriver.of(git);
});

export const vcsLayer = Layer.effect(VcsDriver.VcsDriver, makeVcsDriver);
export const layer = Layer.effect(GitVcsDriver, make);
