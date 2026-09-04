// @effect-diagnostics nodeBuiltinImport:off globalDate:off cryptoRandomUUID:off - offline compaction uses Node's SQLite backup API and durable filesystem swaps.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { projectActivityPayload } from "../orchestration/ActivityPayloadProjection.ts";

const BATCH_SIZE = 100;
const DATABASE_SIDECARS = ["-wal", "-shm"] as const;

async function removeDatabaseFiles(databasePath: string): Promise<void> {
  await Promise.all([
    NodeFSP.rm(databasePath, { force: true }),
    ...DATABASE_SIDECARS.map((suffix) => NodeFSP.rm(`${databasePath}${suffix}`, { force: true })),
  ]);
}

interface EventRow {
  readonly sequence: number;
  readonly payload_json: string;
}

interface ActivityRow {
  readonly row_id: number;
  readonly activity_id: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly tone: OrchestrationThreadActivity["tone"];
  readonly kind: string;
  readonly summary: string;
  readonly payload_json: string;
  readonly created_at: string;
}

export interface DatabaseCompactionResult {
  readonly sourceBytes: number;
  readonly compactedBytes: number;
  readonly eventRowsScanned: number;
  readonly eventRowsChanged: number;
  readonly activityRowsScanned: number;
  readonly activityRowsChanged: number;
  readonly payloadBytesRemoved: number;
}

export interface InstalledDatabaseCompaction extends DatabaseCompactionResult {
  readonly databasePath: string;
  readonly rollbackPath: string;
}

export interface DatabaseStorageAudit {
  readonly databasePath: string;
  readonly databaseBytes: number;
  readonly activityEventRows: number;
  readonly activityEventPayloadBytes: number;
  readonly projectedActivityRows: number;
  readonly projectedActivityPayloadBytes: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compactEventPayload(raw: string): string | null {
  try {
    const payload = asRecord(JSON.parse(raw));
    const activity = asRecord(payload?.activity);
    if (!payload || !activity) return null;
    const projected = projectActivityPayload(activity as unknown as OrchestrationThreadActivity);
    const next = JSON.stringify({ ...payload, activity: projected });
    return next.length < raw.length ? next : null;
  } catch {
    return null;
  }
}

function compactActivityPayload(row: ActivityRow): string | null {
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    const projected = projectActivityPayload({
      id: row.activity_id as OrchestrationThreadActivity["id"],
      turnId: row.turn_id as OrchestrationThreadActivity["turnId"],
      tone: row.tone,
      kind: row.kind,
      summary: row.summary,
      payload,
      createdAt: row.created_at,
    });
    const next = JSON.stringify(projected.payload);
    return next.length < row.payload_json.length ? next : null;
  } catch {
    return null;
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await NodeFSP.open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string, hostPlatform: NodeJS.Platform): Promise<void> {
  try {
    const handle = await NodeFSP.open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (cause) {
    // Windows does not support opening/fsyncing directory handles through
    // Node. Linux production still requires the durability barrier.
    const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
    if (hostPlatform !== "win32" || !["EISDIR", "EINVAL", "EPERM"].includes(String(code))) {
      throw cause;
    }
  }
}

function assertQuickCheck(database: {
  prepare(sql: string): { get(...params: ReadonlyArray<unknown>): unknown };
}): void {
  const row = asRecord(database.prepare("PRAGMA quick_check").get());
  if (row?.quick_check !== "ok") {
    throw new Error(`SQLite quick_check failed: ${JSON.stringify(row)}`);
  }
}

export async function inspectDatabaseStorage(
  databasePathInput: string,
): Promise<DatabaseStorageAudit> {
  const databasePath = NodePath.resolve(databasePathInput);
  const [{ DatabaseSync }, stat] = await Promise.all([
    import("node:sqlite"),
    NodeFSP.stat(databasePath),
  ]);
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  try {
    assertQuickCheck(database);
    const events = asRecord(
      database
        .prepare(`
          SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(payload_json)), 0) AS bytes
          FROM orchestration_events
          WHERE event_type = 'thread.activity-appended'
        `)
        .get(),
    );
    const activities = asRecord(
      database
        .prepare(`
          SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(payload_json)), 0) AS bytes
          FROM projection_thread_activities
        `)
        .get(),
    );
    return {
      databasePath,
      databaseBytes: stat.size,
      activityEventRows: Number(events?.rows ?? 0),
      activityEventPayloadBytes: Number(events?.bytes ?? 0),
      projectedActivityRows: Number(activities?.rows ?? 0),
      projectedActivityPayloadBytes: Number(activities?.bytes ?? 0),
    };
  } finally {
    database.close();
  }
}

/** Builds and verifies a compact database without modifying the source. */
export async function buildCompactedDatabaseCopy(input: {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly hostPlatform: NodeJS.Platform;
}): Promise<DatabaseCompactionResult> {
  const sourcePath = NodePath.resolve(input.sourcePath);
  const outputPath = NodePath.resolve(input.outputPath);
  if (sourcePath === outputPath) {
    throw new Error("Compaction output must differ from the source database.");
  }
  await NodeFSP.mkdir(NodePath.dirname(outputPath), { recursive: true });
  try {
    await NodeFSP.access(outputPath);
    throw new Error(`Compaction output already exists: ${outputPath}`);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }

  const [{ DatabaseSync, backup }, sourceStat] = await Promise.all([
    import("node:sqlite"),
    NodeFSP.stat(sourcePath),
  ]);
  const source = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
  try {
    assertQuickCheck(source);
    await backup(source, outputPath, { rate: 256 });
  } catch (cause) {
    await removeDatabaseFiles(outputPath).catch(() => undefined);
    throw cause;
  } finally {
    source.close();
  }

  let eventRowsScanned = 0;
  let eventRowsChanged = 0;
  let activityRowsScanned = 0;
  let activityRowsChanged = 0;
  let payloadBytesRemoved = 0;
  let compacted: InstanceType<typeof DatabaseSync> | undefined;
  try {
    compacted = new DatabaseSync(outputPath, { timeout: 30_000 });
    compacted.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
    assertQuickCheck(compacted);

    const listEvents = compacted.prepare(`
      SELECT sequence, payload_json
      FROM orchestration_events
      WHERE event_type = 'thread.activity-appended' AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ${String(BATCH_SIZE)}
    `);
    const updateEvent = compacted.prepare(
      "UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?",
    );
    let lastSequence = -1;
    for (;;) {
      const rows = listEvents.all(lastSequence) as unknown as ReadonlyArray<EventRow>;
      if (rows.length === 0) break;
      compacted.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          lastSequence = row.sequence;
          eventRowsScanned += 1;
          const next = compactEventPayload(row.payload_json);
          if (!next) continue;
          updateEvent.run(next, row.sequence);
          eventRowsChanged += 1;
          payloadBytesRemoved += Buffer.byteLength(row.payload_json) - Buffer.byteLength(next);
        }
        compacted.exec("COMMIT");
      } catch (cause) {
        compacted.exec("ROLLBACK");
        throw cause;
      }
    }

    const listActivities = compacted.prepare(`
      SELECT
        rowid AS row_id,
        activity_id,
        thread_id,
        turn_id,
        tone,
        kind,
        summary,
        payload_json,
        created_at
      FROM projection_thread_activities
      WHERE rowid > ?
      ORDER BY rowid ASC
      LIMIT ${String(BATCH_SIZE)}
    `);
    const updateActivity = compacted.prepare(
      "UPDATE projection_thread_activities SET payload_json = ? WHERE rowid = ?",
    );
    let lastRowId = -1;
    for (;;) {
      const rows = listActivities.all(lastRowId) as unknown as ReadonlyArray<ActivityRow>;
      if (rows.length === 0) break;
      compacted.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          lastRowId = row.row_id;
          activityRowsScanned += 1;
          const next = compactActivityPayload(row);
          if (!next) continue;
          updateActivity.run(next, row.row_id);
          activityRowsChanged += 1;
          payloadBytesRemoved += Buffer.byteLength(row.payload_json) - Buffer.byteLength(next);
        }
        compacted.exec("COMMIT");
      } catch (cause) {
        compacted.exec("ROLLBACK");
        throw cause;
      }
    }

    compacted.exec("PRAGMA optimize; VACUUM;");
    assertQuickCheck(compacted);
  } catch (cause) {
    compacted?.close();
    await removeDatabaseFiles(outputPath).catch(() => undefined);
    throw cause;
  }
  if (!compacted) {
    throw new Error("Compacted database did not open after backup.");
  }
  compacted.close();
  if (input.hostPlatform !== "win32") {
    await NodeFSP.chown(outputPath, sourceStat.uid, sourceStat.gid);
  }
  await NodeFSP.chmod(outputPath, sourceStat.mode);
  await syncFile(outputPath);
  const compactedStat = await NodeFSP.stat(outputPath);
  return {
    sourceBytes: sourceStat.size,
    compactedBytes: compactedStat.size,
    eventRowsScanned,
    eventRowsChanged,
    activityRowsScanned,
    activityRowsChanged,
    payloadBytesRemoved,
  };
}

/**
 * Installs a verified compact copy with a same-filesystem rollback rename.
 * The caller must first stop the server and verify its persisted pid is dead.
 */
export async function compactDatabaseOffline(input: {
  readonly databasePath: string;
  readonly rollbackDirectory: string;
  readonly hostPlatform: NodeJS.Platform;
}): Promise<InstalledDatabaseCompaction> {
  const databasePath = NodePath.resolve(input.databasePath);
  const rollbackDirectory = NodePath.resolve(input.rollbackDirectory);
  await NodeFSP.mkdir(rollbackDirectory, { recursive: true, mode: 0o700 });
  const [databaseParentStat, rollbackDirectoryStat] = await Promise.all([
    NodeFSP.stat(NodePath.dirname(databasePath)),
    NodeFSP.stat(rollbackDirectory),
  ]);
  if (databaseParentStat.dev !== rollbackDirectoryStat.dev) {
    throw new Error("Database and rollback directory must be on the same filesystem.");
  }
  const rollbackPath = NodePath.join(rollbackDirectory, NodePath.basename(databasePath));
  if (rollbackPath === databasePath) {
    throw new Error("Rollback directory must differ from the database directory.");
  }
  const stagingPath = NodePath.join(
    NodePath.dirname(databasePath),
    `.${NodePath.basename(databasePath)}.compact-${process.pid}-${NodeCrypto.randomUUID()}`,
  );
  try {
    await NodeFSP.access(rollbackPath);
    throw new Error(`Rollback database already exists: ${rollbackPath}`);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }

  const result = await buildCompactedDatabaseCopy({
    sourcePath: databasePath,
    outputPath: stagingPath,
    hostPlatform: input.hostPlatform,
  });
  await NodeFSP.rename(databasePath, rollbackPath);
  const movedSidecars: Array<{ source: string; rollback: string }> = [];
  try {
    for (const suffix of DATABASE_SIDECARS) {
      const source = `${databasePath}${suffix}`;
      try {
        await NodeFSP.access(source);
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") continue;
        throw cause;
      }
      const rollback = `${rollbackPath}${suffix}`;
      await NodeFSP.rename(source, rollback);
      movedSidecars.push({ source, rollback });
    }
    await NodeFSP.rename(stagingPath, databasePath);
    await Promise.all([
      syncDirectory(NodePath.dirname(databasePath), input.hostPlatform),
      syncDirectory(rollbackDirectory, input.hostPlatform),
    ]);
    const { DatabaseSync } = await import("node:sqlite");
    const installed = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
    try {
      assertQuickCheck(installed);
    } finally {
      installed.close();
    }
  } catch (cause) {
    const restoreFailures: unknown[] = [];
    await NodeFSP.rm(databasePath, { force: true }).catch((restoreCause) => {
      restoreFailures.push(restoreCause);
    });
    await NodeFSP.rename(rollbackPath, databasePath).catch((restoreCause) => {
      restoreFailures.push(restoreCause);
    });
    for (const sidecar of movedSidecars) {
      await NodeFSP.rename(sidecar.rollback, sidecar.source).catch((restoreCause) => {
        restoreFailures.push(restoreCause);
      });
    }
    await removeDatabaseFiles(stagingPath).catch(() => undefined);
    if (restoreFailures.length > 0) {
      throw new AggregateError(
        [cause, ...restoreFailures],
        `Database compaction failed and automatic rollback was incomplete. The original remains at ${rollbackPath}.`,
        { cause },
      );
    }
    throw cause;
  }

  return { ...result, databasePath, rollbackPath };
}
