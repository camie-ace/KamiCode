// @effect-diagnostics nodeBuiltinImport:off
import * as fs from "node:fs";
import * as path from "node:path";

export const PROJECT_MEMORY_DIRECTORY = ".camie";
export const PROJECT_MEMORY_FILENAME = "project-memory.md";
export const PROJECT_MEMORY_RELATIVE_PATH = `${PROJECT_MEMORY_DIRECTORY}/${PROJECT_MEMORY_FILENAME}`;

const PROJECT_MEMORY_FILE = path.join(PROJECT_MEMORY_DIRECTORY, PROJECT_MEMORY_FILENAME);
const PROJECT_MEMORY_MAX_CHARS = 40_000;

export function findProjectMemoryPath(cwd: string | undefined): string | undefined {
  if (!cwd?.trim()) {
    return undefined;
  }

  let current = path.resolve(cwd);

  while (true) {
    const candidate = path.join(current, PROJECT_MEMORY_FILE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function readProjectMemory(cwd: string | undefined): string | undefined {
  const memoryPath = findProjectMemoryPath(cwd);
  if (!memoryPath) {
    return undefined;
  }

  try {
    const stat = fs.statSync(memoryPath);
    if (!stat.isFile()) {
      return undefined;
    }

    const memory = fs.readFileSync(memoryPath, "utf8").trim();
    if (!memory) {
      return undefined;
    }

    if (memory.length <= PROJECT_MEMORY_MAX_CHARS) {
      return memory;
    }

    return `${memory.slice(0, PROJECT_MEMORY_MAX_CHARS)}\n\n[Project memory truncated by KamiCode before injection.]`;
  } catch {
    return undefined;
  }
}

export function buildProjectMemoryInstructionBlock(projectMemory: string | undefined): string {
  const policy = `<project_memory_policy>
At the beginning of each turn, KamiCode attempts to read ${PROJECT_MEMORY_RELATIVE_PATH} from the current project or one of its parent folders.
Treat injected project memory as durable repo-specific context before answering.
Before finalizing each turn, update ${PROJECT_MEMORY_RELATIVE_PATH} when you learned durable repo-specific facts, decisions, paths, commands, constraints, completed features, cleanup, or user preferences worth preserving.
If no durable update is needed, leave the file untouched.
Keep updates concise, deduplicated, and future-facing. Do not store secrets, tokens, passwords, private keys, or transient debug logs.
</project_memory_policy>`;

  if (!projectMemory?.trim()) {
    return policy;
  }

  return `${policy}\n\n<project_memory path="${PROJECT_MEMORY_RELATIVE_PATH}">\n${projectMemory.trim()}\n</project_memory>`;
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
  const instructions = buildProjectMemoryInstructionBlock(input.projectMemory);

  return `${instructions}

Current user request:
${prompt.length > 0 ? prompt : "(No text input was provided for this turn.)"}`;
}
