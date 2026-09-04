// @effect-diagnostics nodeBuiltinImport:off globalDate:off - integration test uses a real disposable SQLite database.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { buildCompactedDatabaseCopy, compactDatabaseOffline } from "./DatabaseCompaction.ts";

describe("database compaction", () => {
  it("removes an incomplete output when source verification fails", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-db-failed-copy-"));
    const sourcePath = NodePath.join(root, "invalid.sqlite");
    const outputPath = NodePath.join(root, "partial.sqlite");
    try {
      await NodeFSP.writeFile(sourcePath, "not a sqlite database");

      await expect(
        buildCompactedDatabaseCopy({ sourcePath, outputPath, hostPlatform: "win32" }),
      ).rejects.toThrow();

      await expect(NodeFSP.stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("slims both retained activity copies without changing the source", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-db-compact-"));
    const sourcePath = NodePath.join(root, "state.sqlite");
    const outputPath = NodePath.join(root, "compacted.sqlite");
    const database = new NodeSqlite.DatabaseSync(sourcePath);
    database.exec(`
      CREATE TABLE orchestration_events (
        sequence INTEGER PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE projection_thread_activities (
        activity_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        tone TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const hugeOutput = Array.from({ length: 4_000 }, (_, index) => `line ${String(index)}`).join(
      "\n",
    );
    const activity = {
      id: "activity-1",
      turnId: "turn-1",
      tone: "tool",
      kind: "tool.completed",
      summary: "Command",
      payload: {
        itemType: "command_execution",
        status: "completed",
        data: { command: "npm test", rawOutput: { content: hugeOutput } },
      },
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    database
      .prepare(
        "INSERT INTO orchestration_events(sequence, event_type, payload_json) VALUES (?, ?, ?)",
      )
      .run(1, "thread.activity-appended", JSON.stringify({ threadId: "thread-1", activity }));
    database
      .prepare(`
        INSERT INTO projection_thread_activities(
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        activity.id,
        "thread-1",
        activity.turnId,
        activity.tone,
        activity.kind,
        activity.summary,
        JSON.stringify(activity.payload),
        activity.createdAt,
      );
    database.close();
    const sourceBefore = await NodeFSP.readFile(sourcePath);

    const result = await buildCompactedDatabaseCopy({
      sourcePath,
      outputPath,
      hostPlatform: "win32",
    });

    expect(result.eventRowsChanged).toBe(1);
    expect(result.activityRowsChanged).toBe(1);
    expect(result.payloadBytesRemoved).toBeGreaterThan(10_000);
    expect(await NodeFSP.readFile(sourcePath)).toEqual(sourceBefore);
    const compacted = new NodeSqlite.DatabaseSync(outputPath, { readOnly: true });
    const event = compacted.prepare("SELECT payload_json FROM orchestration_events").get() as {
      payload_json: string;
    };
    const projection = compacted
      .prepare("SELECT payload_json FROM projection_thread_activities")
      .get() as { payload_json: string };
    expect(event.payload_json).not.toContain("line 3999");
    expect(projection.payload_json).not.toContain("line 3999");
    expect(compacted.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    compacted.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  });

  it("atomically installs a verified copy and retains the exact original for rollback", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-db-install-"));
    const sourcePath = NodePath.join(root, "state.sqlite");
    const rollbackDirectory = NodePath.join(root, "rollback", "before-compaction");
    try {
      const database = new NodeSqlite.DatabaseSync(sourcePath);
      database.exec(`
        CREATE TABLE orchestration_events (
          sequence INTEGER PRIMARY KEY,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE projection_thread_activities (
          activity_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          turn_id TEXT,
          tone TEXT NOT NULL,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      database.close();
      const original = await NodeFSP.readFile(sourcePath);
      const originalStat = await NodeFSP.stat(sourcePath);

      const result = await compactDatabaseOffline({
        databasePath: sourcePath,
        rollbackDirectory,
        hostPlatform: "win32",
      });

      expect(result.databasePath).toBe(sourcePath);
      expect(await NodeFSP.readFile(result.rollbackPath)).toEqual(original);
      const installedStat = await NodeFSP.stat(sourcePath);
      expect(installedStat.mode).toBe(originalStat.mode);
      expect(installedStat.uid).toBe(originalStat.uid);
      expect(installedStat.gid).toBe(originalStat.gid);
      const installed = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
      expect(installed.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      installed.close();
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
