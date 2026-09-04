// @effect-diagnostics nodeBuiltinImport:off globalDate:off cryptoRandomUUID:off - retention operates on native directory entries and process liveness.
import * as NodeCrypto from "node:crypto";
import type * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const ACTIVE_MARKER = ".active-run.json";
const STALE_ACTIVE_MARKER_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_MAX_RUNS_PER_PROJECT = 20;
const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;

function environmentInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface BrowserHarnessRetentionOptions {
  readonly stateRoot: string;
  readonly nowMs?: number | undefined;
  readonly maxRunsPerProject?: number | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly maxTotalBytes?: number | undefined;
  readonly keepRunDirectories?: ReadonlyArray<string> | undefined;
}

export interface BrowserHarnessRetentionResult {
  readonly discoveredRuns: number;
  readonly removedRuns: number;
  readonly removedBytes: number;
  readonly retainedBytes: number;
}

interface ManagedRun {
  readonly directory: string;
  readonly project: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly active: boolean;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function directorySize(directory: string): Promise<number> {
  const queue = [directory];
  let bytes = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;
    const entries = await NodeFSP.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = NodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(child);
      } else {
        bytes += (await NodeFSP.lstat(child)).size;
      }
    }
  }
  return bytes;
}

async function runIsActive(directory: string, nowMs: number): Promise<boolean> {
  const marker = NodePath.join(directory, ACTIVE_MARKER);
  try {
    const [raw, stat] = await Promise.all([NodeFSP.readFile(marker, "utf8"), NodeFSP.stat(marker)]);
    const parsed = JSON.parse(raw) as { readonly pid?: unknown };
    if (typeof parsed.pid === "number" && processIsAlive(parsed.pid)) {
      return true;
    }
    return nowMs - stat.mtimeMs < STALE_ACTIVE_MARKER_MS;
  } catch {
    return false;
  }
}

async function discoverManagedRuns(
  projectsRoot: string,
  nowMs: number,
): Promise<ReadonlyArray<ManagedRun>> {
  const runs: ManagedRun[] = [];
  let projects: Array<NodeFS.Dirent<string>>;
  try {
    projects = await NodeFSP.readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return runs;
    throw error;
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const runsDirectory = NodePath.join(projectsRoot, project.name, "runs");
    let entries: Array<NodeFS.Dirent<string>>;
    try {
      entries = await NodeFSP.readdir(runsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    // A prior process may have crashed after atomically retiring a run but
    // before recursive deletion completed. These exact direct children were
    // already proven inactive and selected by this retention owner.
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(".retention-trash-")) continue;
      await NodeFSP.rm(NodePath.join(runsDirectory, entry.name), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".retention-trash-")) continue;
      const directory = NodePath.join(runsDirectory, entry.name);
      try {
        const [stat, sizeBytes, active] = await Promise.all([
          NodeFSP.stat(directory),
          directorySize(directory),
          runIsActive(directory, nowMs),
        ]);
        runs.push({
          directory,
          project: project.name,
          mtimeMs: stat.mtimeMs,
          sizeBytes,
          active,
        });
      } catch {
        // An unreadable or concurrently changing run is not proven safe to
        // remove. Leave it for a later pass.
      }
    }
  }
  return runs;
}

export async function markBrowserHarnessRunActive(directory: string): Promise<void> {
  await NodeFSP.writeFile(
    NodePath.join(directory, ACTIVE_MARKER),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { encoding: "utf8", flag: "wx" },
  );
}

export async function markBrowserHarnessRunComplete(directory: string): Promise<void> {
  await NodeFSP.rm(NodePath.join(directory, ACTIVE_MARKER), { force: true });
}

export async function pruneBrowserHarnessRuns(
  options: BrowserHarnessRetentionOptions,
): Promise<BrowserHarnessRetentionResult> {
  const nowMs = options.nowMs ?? Date.now();
  const maxRunsPerProject = Math.max(
    1,
    Math.trunc(
      options.maxRunsPerProject ??
        environmentInteger(
          "T3CODE_TEST_HARNESS_MAX_RUNS_PER_PROJECT",
          DEFAULT_MAX_RUNS_PER_PROJECT,
        ),
    ),
  );
  const maxAgeMs = Math.max(
    0,
    options.maxAgeMs ??
      environmentInteger("T3CODE_TEST_HARNESS_MAX_AGE_DAYS", 14) * 24 * 60 * 60 * 1_000,
  );
  const maxTotalBytes = Math.max(
    0,
    options.maxTotalBytes ??
      environmentInteger("T3CODE_TEST_HARNESS_MAX_BYTES", DEFAULT_MAX_TOTAL_BYTES),
  );
  const projectsRoot = NodePath.resolve(options.stateRoot, "test-harness", "projects");
  const keep = new Set(
    (options.keepRunDirectories ?? []).map((directory) => NodePath.resolve(directory)),
  );
  const runs = await discoverManagedRuns(projectsRoot, nowMs);
  const byProject = new Map<string, ManagedRun[]>();
  for (const run of runs) {
    const projectRuns = byProject.get(run.project);
    if (projectRuns) projectRuns.push(run);
    else byProject.set(run.project, [run]);
  }

  const remove = new Set<string>();
  const newestByProject = new Set<string>();
  for (const projectRuns of byProject.values()) {
    projectRuns.sort((left, right) => right.mtimeMs - left.mtimeMs);
    if (projectRuns[0]) newestByProject.add(projectRuns[0].directory);
    for (const [index, run] of projectRuns.entries()) {
      const protectedRun = run.active || keep.has(run.directory) || index === 0;
      if (protectedRun) continue;
      if (index >= maxRunsPerProject || (maxAgeMs > 0 && nowMs - run.mtimeMs > maxAgeMs)) {
        remove.add(run.directory);
      }
    }
  }

  let retainedBytes = runs.reduce(
    (total, run) => total + (remove.has(run.directory) ? 0 : run.sizeBytes),
    0,
  );
  if (retainedBytes > maxTotalBytes) {
    const oldestFirst = runs.toSorted((left, right) => left.mtimeMs - right.mtimeMs);
    for (const run of oldestFirst) {
      if (retainedBytes <= maxTotalBytes) break;
      if (
        remove.has(run.directory) ||
        run.active ||
        keep.has(run.directory) ||
        newestByProject.has(run.directory)
      ) {
        continue;
      }
      remove.add(run.directory);
      retainedBytes -= run.sizeBytes;
    }
  }

  let removedRuns = 0;
  let removedBytes = 0;
  for (const run of runs) {
    if (!remove.has(run.directory)) continue;
    const runsDirectory = NodePath.dirname(run.directory);
    const relative = NodePath.relative(projectsRoot, run.directory);
    const segments = relative.split(NodePath.sep);
    if (
      relative.startsWith("..") ||
      NodePath.isAbsolute(relative) ||
      segments.length !== 3 ||
      segments[1] !== "runs"
    ) {
      continue;
    }
    if (await runIsActive(run.directory, nowMs)) continue;
    const trash = NodePath.join(
      runsDirectory,
      `.retention-trash-${process.pid}-${NodeCrypto.randomUUID()}`,
    );
    try {
      await NodeFSP.rename(run.directory, trash);
      await NodeFSP.rm(trash, { recursive: true, force: true });
      removedRuns += 1;
      removedBytes += run.sizeBytes;
    } catch {
      // A concurrent run or a locked artifact wins over reclamation.
    }
  }

  return {
    discoveredRuns: runs.length,
    removedRuns,
    removedBytes,
    retainedBytes: runs.reduce((total, run) => total + run.sizeBytes, 0) - removedBytes,
  };
}
