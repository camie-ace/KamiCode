// @effect-diagnostics nodeBuiltinImport:off globalDate:off - tests exercise native filesystem ownership boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ensureManagedStorageRoot, pruneManagedScratch } from "./ManagedStorage.ts";

describe("managed storage", () => {
  it("refuses to claim a non-empty unowned directory", async () => {
    const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-storage-owner-"));
    const root = NodePath.join(parent, "scratch");
    await NodeFSP.mkdir(root);
    await NodeFSP.writeFile(NodePath.join(root, "user-data.txt"), "keep");

    await expect(ensureManagedStorageRoot(root, "scratch")).rejects.toThrow(
      "Refusing to claim non-empty storage root",
    );
    await expect(NodeFSP.readFile(NodePath.join(root, "user-data.txt"), "utf8")).resolves.toBe(
      "keep",
    );
    await NodeFSP.rm(parent, { recursive: true, force: true });
  });

  it("removes expired owned scratch while preserving recent and outside files", async () => {
    const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-storage-prune-"));
    const root = NodePath.join(parent, "scratch");
    await ensureManagedStorageRoot(root, "scratch");
    const oldPath = NodePath.join(root, "old-task");
    const recentPath = NodePath.join(root, "active-task");
    const outsidePath = NodePath.join(parent, "outside.txt");
    await NodeFSP.mkdir(oldPath);
    await NodeFSP.writeFile(NodePath.join(oldPath, "pack"), "old data");
    await NodeFSP.mkdir(recentPath);
    await NodeFSP.writeFile(NodePath.join(recentPath, "pack"), "new data");
    await NodeFSP.writeFile(outsidePath, "keep");
    const now = Date.now();
    const old = new Date(now - 10 * 60 * 60 * 1_000);
    await NodeFSP.utimes(NodePath.join(oldPath, "pack"), old, old);
    await NodeFSP.utimes(oldPath, old, old);

    const result = await pruneManagedScratch({
      root,
      nowMs: now,
      maxAgeMs: 8 * 60 * 60 * 1_000,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(result.removedEntries).toBe(1);
    await expect(NodeFSP.stat(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(NodeFSP.readFile(NodePath.join(recentPath, "pack"), "utf8")).resolves.toBe(
      "new data",
    );
    await expect(NodeFSP.readFile(outsidePath, "utf8")).resolves.toBe("keep");
    await NodeFSP.rm(parent, { recursive: true, force: true });
  });

  it("finishes a retired-entry cleanup left behind by an interrupted prune", async () => {
    const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-storage-trash-"));
    const root = NodePath.join(parent, "scratch");
    await ensureManagedStorageRoot(root, "scratch");
    const retired = NodePath.join(root, ".retention-trash-123-abc");
    await NodeFSP.mkdir(retired);
    await NodeFSP.writeFile(NodePath.join(retired, "partial-pack"), "garbage");

    const result = await pruneManagedScratch({
      root,
      maxAgeMs: Number.MAX_SAFE_INTEGER,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(result.removedEntries).toBe(1);
    await expect(NodeFSP.stat(retired)).rejects.toMatchObject({ code: "ENOENT" });
    await NodeFSP.rm(parent, { recursive: true, force: true });
  });

  it("unlinks a disposable symlink without following it outside managed scratch", async () => {
    const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-storage-link-"));
    const root = NodePath.join(parent, "scratch");
    const outside = NodePath.join(parent, "outside");
    const linked = NodePath.join(root, "expired-link");
    await ensureManagedStorageRoot(root, "scratch");
    await NodeFSP.mkdir(outside);
    await NodeFSP.writeFile(NodePath.join(outside, "keep.txt"), "keep");
    await NodeFSP.symlink(outside, linked, "junction");

    await pruneManagedScratch({
      root,
      nowMs: Date.now() + 1_000,
      maxAgeMs: 0,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });

    await expect(NodeFSP.lstat(linked)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(NodeFSP.readFile(NodePath.join(outside, "keep.txt"), "utf8")).resolves.toBe(
      "keep",
    );
    await NodeFSP.rm(parent, { recursive: true, force: true });
  });
});
