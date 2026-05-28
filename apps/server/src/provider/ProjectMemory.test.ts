// @effect-diagnostics nodeBuiltinImport:off
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it } from "vitest";

import {
  PROJECT_MEMORY_RELATIVE_PATH,
  applyProjectMemoryPromptPrefix,
  buildProjectMemoryInstructionBlock,
  readProjectMemory,
} from "./ProjectMemory.ts";

describe("ProjectMemory", () => {
  it("reads .camie/project-memory.md from the project or an ancestor", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kamicode-project-memory-"));
    try {
      const nested = path.join(root, "packages", "app");
      mkdirSync(path.join(root, ".camie"), { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        path.join(root, ".camie", "project-memory.md"),
        "# Project Memory\n\n- Product is KamiCode.",
        "utf8",
      );

      assert.equal(readProjectMemory(nested), "# Project Memory\n\n- Product is KamiCode.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read the obsolete .cami project memory path", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kamicode-project-memory-"));
    try {
      mkdirSync(path.join(root, ".cami"), { recursive: true });
      writeFileSync(path.join(root, ".cami", "project-memory.md"), "- Wrong path.", "utf8");

      assert.equal(readProjectMemory(root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds a reusable memory policy and prompt prefix", () => {
    assert.equal(PROJECT_MEMORY_RELATIVE_PATH, ".camie/project-memory.md");

    const instructions = buildProjectMemoryInstructionBlock("- Repo uses Effect.");
    assert.match(instructions, /<project_memory_policy>/);
    assert.match(instructions, /path="\.camie\/project-memory\.md"/);
    assert.match(instructions, /Repo uses Effect\./);

    const prompt = applyProjectMemoryPromptPrefix({
      prompt: "Implement the feature",
      projectMemory: "- Repo uses Effect.",
    });
    assert.match(prompt, /Current user request:\nImplement the feature/);
    assert.match(prompt, /Repo uses Effect\./);
  });
});
