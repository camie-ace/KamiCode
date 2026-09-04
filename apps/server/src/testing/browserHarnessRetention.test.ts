// @effect-diagnostics nodeBuiltinImport:off globalDate:off - retention tests exercise native filesystem ownership boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  markBrowserHarnessRunActive,
  markBrowserHarnessRunComplete,
  pruneBrowserHarnessRuns,
} from "./browserHarnessRetention.ts";

const Fs = NodeFSP;
const path = NodePath;

async function makeRun(input: {
  readonly stateRoot: string;
  readonly project: string;
  readonly run: string;
  readonly mtimeMs: number;
  readonly bytes?: number;
}): Promise<string> {
  const directory = path.join(
    input.stateRoot,
    "test-harness",
    "projects",
    input.project,
    "runs",
    input.run,
  );
  await Fs.mkdir(directory, { recursive: true });
  await Fs.writeFile(path.join(directory, "artifact.bin"), Buffer.alloc(input.bytes ?? 8));
  const mtime = new Date(input.mtimeMs);
  await Fs.utimes(directory, mtime, mtime);
  return directory;
}

describe("browser harness retention", () => {
  it("keeps the newest bounded run set and removes only managed run directories", async () => {
    const stateRoot = await Fs.mkdtemp(path.join(NodeOS.tmpdir(), "t3-harness-retention-"));
    try {
      const runs = await Promise.all(
        [1, 2, 3, 4].map((index) =>
          makeRun({
            stateRoot,
            project: "project-a",
            run: `run-${index}`,
            mtimeMs: index * 1_000,
          }),
        ),
      );
      const unrelated = path.join(stateRoot, "unrelated.txt");
      await Fs.writeFile(unrelated, "preserve");

      const result = await pruneBrowserHarnessRuns({
        stateRoot,
        nowMs: 10_000,
        maxRunsPerProject: 2,
        maxAgeMs: 0,
        maxTotalBytes: Number.MAX_SAFE_INTEGER,
      });

      expect(result.removedRuns).toBe(2);
      await expect(Fs.access(runs[0]!)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(Fs.access(runs[1]!)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(Fs.access(runs[2]!)).resolves.toBeUndefined();
      await expect(Fs.access(runs[3]!)).resolves.toBeUndefined();
      await expect(Fs.readFile(unrelated, "utf8")).resolves.toBe("preserve");
    } finally {
      await Fs.rm(stateRoot, { recursive: true, force: true });
    }
  });

  it("protects active runs and the newest run in every project under a byte budget", async () => {
    const stateRoot = await Fs.mkdtemp(path.join(NodeOS.tmpdir(), "t3-harness-retention-"));
    try {
      const active = await makeRun({
        stateRoot,
        project: "project-a",
        run: "active",
        mtimeMs: 1_000,
        bytes: 32,
      });
      await markBrowserHarnessRunActive(active);
      await Fs.utimes(active, new Date(1_000), new Date(1_000));
      const newestA = await makeRun({
        stateRoot,
        project: "project-a",
        run: "newest-a",
        mtimeMs: 3_000,
        bytes: 32,
      });
      const oldB = await makeRun({
        stateRoot,
        project: "project-b",
        run: "old-b",
        mtimeMs: 1_000,
        bytes: 32,
      });
      const newestB = await makeRun({
        stateRoot,
        project: "project-b",
        run: "newest-b",
        mtimeMs: 2_000,
        bytes: 32,
      });

      const result = await pruneBrowserHarnessRuns({
        stateRoot,
        nowMs: 10_000,
        maxRunsPerProject: 20,
        maxAgeMs: 0,
        maxTotalBytes: 1,
      });

      expect(result.removedRuns).toBe(1);
      await expect(Fs.access(active)).resolves.toBeUndefined();
      await expect(Fs.access(newestA)).resolves.toBeUndefined();
      await expect(Fs.access(oldB)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(Fs.access(newestB)).resolves.toBeUndefined();
      await markBrowserHarnessRunComplete(active);
    } finally {
      await Fs.rm(stateRoot, { recursive: true, force: true });
    }
  });

  it("cleans a retired run left behind by an interrupted deletion", async () => {
    const stateRoot = await Fs.mkdtemp(path.join(NodeOS.tmpdir(), "t3-harness-retention-"));
    try {
      const runsDirectory = path.join(stateRoot, "test-harness", "projects", "project-a", "runs");
      const retired = path.join(runsDirectory, ".retention-trash-123-abc");
      await Fs.mkdir(retired, { recursive: true });
      await Fs.writeFile(path.join(retired, "video.webm"), "partial");

      const result = await pruneBrowserHarnessRuns({ stateRoot });

      expect(result.discoveredRuns).toBe(0);
      await expect(Fs.stat(retired)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Fs.rm(stateRoot, { recursive: true, force: true });
    }
  });
});
