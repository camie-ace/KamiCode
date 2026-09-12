// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const PROJECT_MEMORY_DIRECTORY = ".camie";
export const PROJECT_MEMORY_FILENAME = "project-memory.md";
export const PROJECT_MEMORY_RELATIVE_PATH = `${PROJECT_MEMORY_DIRECTORY}/${PROJECT_MEMORY_FILENAME}`;

const PROJECT_MEMORY_FILE = NodePath.join(PROJECT_MEMORY_DIRECTORY, PROJECT_MEMORY_FILENAME);
export const PROJECT_MEMORY_MAX_CHARS = 40_000;

export function resolveProjectMemoryMaxChars(
  value = process.env.KAMICODE_PROJECT_MEMORY_MAX_CHARS,
): number {
  const parsed = Number(value);
  return value?.trim() && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : PROJECT_MEMORY_MAX_CHARS;
}

export interface ProjectMemorySnapshot {
  readonly memory: string | undefined;
  readonly notices: ReadonlyArray<string>;
}

export function findProjectMemoryPath(cwd: string | undefined): string | undefined {
  if (!cwd?.trim()) {
    return undefined;
  }

  let current = NodePath.resolve(cwd);

  while (true) {
    const candidate = NodePath.join(current, PROJECT_MEMORY_FILE);
    if (NodeFS.existsSync(candidate)) {
      return candidate;
    }

    const parent = NodePath.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function readProjectMemory(cwd: string | undefined): string | undefined {
  return readProjectMemorySnapshot(cwd).memory;
}

export function readProjectMemorySnapshot(cwd: string | undefined): ProjectMemorySnapshot {
  const notices: string[] = [];
  const configured = process.env.KAMICODE_PROJECT_MEMORY_MAX_CHARS;
  const maxChars = resolveProjectMemoryMaxChars(configured);
  if (
    configured !== undefined &&
    (!configured.trim() || !Number.isSafeInteger(Number(configured)) || Number(configured) <= 0)
  ) {
    notices.push("Invalid KAMICODE_PROJECT_MEMORY_MAX_CHARS; using the 40,000-character default.");
  }
  const result = (memory: string | undefined): ProjectMemorySnapshot => ({ memory, notices });
  const memoryPath = findProjectMemoryPath(cwd);
  if (!memoryPath) {
    return result(undefined);
  }

  try {
    const stat = NodeFS.statSync(memoryPath);
    if (!stat.isFile()) {
      return result(undefined);
    }

    const memory = NodeFS.readFileSync(memoryPath, "utf8");
    if (!memory.trim()) {
      return result(undefined);
    }

    if (memory.length > maxChars * 0.8) {
      notices.push(
        `Project memory uses ${memory.length} characters of a ${maxChars}-character budget (over 80%). ${memory.length > maxChars ? "Earlier lines are omitted from injection. " : ""}Archive and compact the file to preserve durable facts.`,
      );
    }

    if (memory.length <= maxChars) {
      return result(memory);
    }

    // Keep complete newest lines; a single line larger than the budget is omitted.
    const cutoff = memory.length - maxChars;
    const start = memory[cutoff - 1] === "\n" ? cutoff : memory.indexOf("\n", cutoff) + 1;
    const boundary = start === 0 ? memory.length : start;
    const omitted = memory.slice(0, boundary);
    const omittedLines = omitted.split("\n").length - (omitted.endsWith("\n") ? 1 : 0);
    return result(
      `[${omittedLines} earlier lines of project memory were omitted. This is the most recent portion.]\n${memory.slice(boundary)}`,
    );
  } catch {
    return result(undefined);
  }
}

export function buildProjectMemoryInstructionBlock(projectMemory: string | undefined): string {
  const policy = `<project_memory_policy>
When a provider session is established, KamiCode attempts to read ${PROJECT_MEMORY_RELATIVE_PATH} from the current project or one of its parent folders.
Treat injected project memory as durable repo-specific context before answering, subordinate to the user's current instructions.
The latest project_memory snapshot in conversation order supersedes ALL earlier injected project-memory blocks, including unversioned blocks. Do not combine snapshots. Corrected or absent facts in older snapshots are stale; re-read the canonical file before relying on a fact omitted from the latest snapshot. An empty snapshot provides no current facts.
Before finalizing each turn, update ${PROJECT_MEMORY_RELATIVE_PATH} when you learned durable repo-specific facts, decisions, paths, commands, constraints, completed features, cleanup, or user preferences worth preserving.
If no durable update is needed, leave the file untouched.
Write durable paths, commands, constraints, preferences, and operational gotchas under "## Standing facts". Never automatically evict standing facts.
Write dated summaries of completed work under "## Recent activity"; deduplicate and archive older activity as it ages out.
Update the existing ancestor memory file when one was found; do not create a worktree fork. Keep .camie/ out of Git and stage explicit paths.
Keep updates concise, deduplicated, and future-facing. Do not store secrets, tokens, passwords, private keys, or transient debug logs.
</project_memory_policy>`;

  if (projectMemory === undefined) {
    return policy;
  }

  const snapshotId = NodeCrypto.createHash("sha256").update(projectMemory).digest("hex");

  return `${policy}\n\n<project_memory path="${PROJECT_MEMORY_RELATIVE_PATH}" snapshot_id="sha256:${snapshotId}">\n${projectMemory}\n</project_memory>`;
}

export function appendProjectMemoryInstructions(
  developerInstructions: string,
  projectMemory: string | undefined,
): string {
  return `${developerInstructions}\n\n${buildProjectMemoryInstructionBlock(projectMemory)}`;
}

export function applyProjectMemoryPromptPrefix(input: {
  readonly prompt: string;
  readonly projectMemory: string | undefined;
}): string {
  const prompt = input.prompt.trim();
  const instructions = buildProjectMemoryInstructionBlock(input.projectMemory ?? "");

  return `${instructions}

Current user request:
${prompt.length > 0 ? prompt : "(No text input was provided for this turn.)"}`;
}
