// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, it } from "vite-plus/test";

import {
  PROJECT_MEMORY_RELATIVE_PATH,
  applyProjectMemoryPromptPrefix,
  buildProjectMemoryInstructionBlock,
  readProjectMemory,
} from "./ProjectMemory.ts";

describe("ProjectMemory", () => {
  it("reads .camie/project-memory.md from the project or an ancestor", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kamicode-project-memory-"));
    try {
      const nested = NodePath.join(root, "packages", "app");
      NodeFS.mkdirSync(NodePath.join(root, ".camie"), { recursive: true });
      NodeFS.mkdirSync(nested, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, ".camie", "project-memory.md"),
        "# Project Memory\n\n- Product is KamiCode.",
        "utf8",
      );

      NodeAssert.equal(readProjectMemory(nested), "# Project Memory\n\n- Product is KamiCode.");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read the obsolete .cami project memory path", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kamicode-project-memory-"));
    try {
      NodeFS.mkdirSync(NodePath.join(root, ".cami"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, ".cami", "project-memory.md"),
        "- Wrong path.",
        "utf8",
      );

      NodeAssert.equal(readProjectMemory(root), undefined);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds a reusable memory policy and prompt prefix", () => {
    NodeAssert.equal(PROJECT_MEMORY_RELATIVE_PATH, ".camie/project-memory.md");

    const instructions = buildProjectMemoryInstructionBlock("- Repo uses Effect.");
    NodeAssert.match(instructions, /<project_memory_policy>/);
    NodeAssert.match(instructions, /path="\.camie\/project-memory\.md"/);
    NodeAssert.match(instructions, /Repo uses Effect\./);

    const prompt = applyProjectMemoryPromptPrefix({
      prompt: "Implement the feature",
      projectMemory: "- Repo uses Effect.",
    });
    NodeAssert.match(prompt, /Current user request:\nImplement the feature/);
    NodeAssert.match(prompt, /Repo uses Effect\./);
  });
});
