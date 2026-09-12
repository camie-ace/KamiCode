// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, it, vi } from "vite-plus/test";

import {
  PROJECT_MEMORY_RELATIVE_PATH,
  applyProjectMemoryPromptPrefix,
  buildProjectMemoryInstructionBlock,
  readProjectMemory,
  readProjectMemorySnapshot,
  resolveProjectMemoryMaxChars,
} from "./ProjectMemory.ts";

describe("ProjectMemory", () => {
  afterEach(() => vi.unstubAllEnvs());

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

  function readSnapshotFixture(memory: string) {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kamicode-memory-truncation-"));
    try {
      NodeFS.mkdirSync(NodePath.join(root, ".camie"));
      NodeFS.writeFileSync(NodePath.join(root, ".camie", "project-memory.md"), memory);
      return readProjectMemorySnapshot(root);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }

  function readFixture(memory: string): string | undefined {
    return readSnapshotFixture(memory).memory;
  }

  it("validates the configurable cap without changing the default", () => {
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      NodeAssert.equal(resolveProjectMemoryMaxChars(value), 40_000);
    }
    NodeAssert.equal(resolveProjectMemoryMaxChars("8000"), 8000);
    vi.stubEnv("KAMICODE_PROJECT_MEMORY_MAX_CHARS", "10");
    NodeAssert.ok(readFixture("earlier\nnewest")!.endsWith("\nnewest"));
    NodeAssert.equal(readSnapshotFixture("12345678").notices.length, 0);
    NodeAssert.equal(readSnapshotFixture("123456789").notices.length, 1);
  });

  it("warns above 80% without changing the verbatim memory", () => {
    vi.stubEnv("KAMICODE_PROJECT_MEMORY_MAX_CHARS", "40000");
    NodeAssert.equal(readSnapshotFixture("x".repeat(32_000)).notices.length, 0);
    const snapshot = readSnapshotFixture("x".repeat(32_001));
    NodeAssert.equal(snapshot.memory, "x".repeat(32_001));
    NodeAssert.match(snapshot.notices[0]!, /over 80%/);
    NodeAssert.match(
      readSnapshotFixture("x".repeat(40_001)).notices[0]!,
      /Earlier lines are omitted/,
    );
    vi.stubEnv("KAMICODE_PROJECT_MEMORY_MAX_CHARS", "invalid");
    NodeAssert.match(readSnapshotFixture("fact").notices[0]!, /Invalid KAMICODE/);
  });

  it("returns memory under the cap verbatim, including whitespace", () => {
    const memory = "  # Memory\n\n- A standing fact.\n";
    NodeAssert.equal(readFixture(memory), memory);
  });

  it("does not truncate exactly 40,000 characters", () => {
    const memory = "x".repeat(40_000);
    NodeAssert.equal(readFixture(memory), memory);
  });

  it("keeps the final line of a 100 KB file and reports omitted earlier lines", () => {
    const memory =
      Array.from({ length: 2_000 }, (_, i) => `Entry ${i}: ${"x".repeat(44)}\n`).join("") +
      "FINAL LINE\n";
    NodeAssert.ok(memory.length > 100_000);
    const result = readFixture(memory)!;
    const newline = result.indexOf("\n");
    const marker = result.slice(0, newline + 1);
    const retained = result.slice(newline + 1);
    NodeAssert.match(
      marker,
      /^\[\d+ earlier lines of project memory were omitted\. This is the most recent portion\.\]\n$/,
    );
    NodeAssert.ok(result.endsWith("FINAL LINE\n"));
    NodeAssert.ok(result.length <= 40_000 + marker.length);
    NodeAssert.ok(memory.endsWith(retained));
    NodeAssert.ok(memory.slice(0, -retained.length).endsWith("\n"));
    NodeAssert.match(retained, /^Entry \d+: /);
    NodeAssert.equal(
      Number(marker.match(/\d+/)![0]),
      memory.slice(0, -retained.length).split("\n").length - 1,
    );
  });

  it("keeps a line that starts exactly at the cutoff", () => {
    const tail = "z".repeat(39_999) + "\n";
    NodeAssert.equal(
      readFixture("old\n" + tail),
      "[1 earlier lines of project memory were omitted. This is the most recent portion.]\n" + tail,
    );
  });

  it("handles CRLF and omits an oversized single line without splitting it", () => {
    const result = readFixture("old".repeat(20_000) + "\r\nnewest\r\n")!;
    NodeAssert.ok(result.endsWith("\nnewest\r\n"));
    NodeAssert.equal(
      readFixture("x".repeat(40_001)),
      "[1 earlier lines of project memory were omitted. This is the most recent portion.]\n",
    );
  });

  it("versions replacement snapshots and explicitly supersedes corrected and deleted facts", () => {
    const old = buildProjectMemoryInstructionBlock("- API port: 3000.\n- Deploy with legacy.sh.");
    const corrected = buildProjectMemoryInstructionBlock("- API port: 4000.");
    const empty = buildProjectMemoryInstructionBlock("");
    const id = (block: string) => block.match(/snapshot_id="([^"]+)"/)?.[1];
    NodeAssert.ok(id(old));
    NodeAssert.notEqual(id(old), id(corrected));
    NodeAssert.notEqual(id(corrected), id(empty));
    NodeAssert.match(corrected, /supersedes ALL earlier/);
    NodeAssert.match(corrected, /Do not combine snapshots/);
    NodeAssert.doesNotMatch(corrected, /3000|legacy\.sh/);
    NodeAssert.match(empty, /<project_memory path=/);
    NodeAssert.doesNotMatch(buildProjectMemoryInstructionBlock(undefined), /<project_memory path=/);
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
