// @effect-diagnostics nodeBuiltinImport:off globalDate:off cryptoRandomUUID:off - storage ownership and atomic directory retirement use native filesystem primitives.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const OWNER_MARKER = ".kamicode-managed-storage.json";
const OWNER_VERSION = 1;
const DEFAULT_ACTIVE_GRACE_MS = 6 * 60 * 60 * 1_000;

type ManagedStorageKind = "scratch" | "package-cache";

interface ManagedEntry {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly modifiedAtMs: number;
  readonly retirable: boolean;
}

export interface ManagedScratchPruneResult {
  readonly scannedEntries: number;
  readonly removedEntries: number;
  readonly removedBytes: number;
  readonly retainedBytes: number;
}

function markerPath(root: string): string {
  return NodePath.join(root, OWNER_MARKER);
}

function ownerMarker(kind: ManagedStorageKind): string {
  return `${JSON.stringify({ owner: "kamicode", version: OWNER_VERSION, kind })}\n`;
}

async function readOwnerKind(root: string): Promise<ManagedStorageKind | null> {
  try {
    const parsed = JSON.parse(await NodeFSP.readFile(markerPath(root), "utf8")) as {
      owner?: unknown;
      version?: unknown;
      kind?: unknown;
    };
    return parsed.owner === "kamicode" &&
      parsed.version === OWNER_VERSION &&
      (parsed.kind === "scratch" || parsed.kind === "package-cache")
      ? parsed.kind
      : null;
  } catch {
    return null;
  }
}

/**
 * Claims only a new or empty directory. A typo pointing at an existing cache
 * or repository therefore cannot turn it into a retention target.
 */
export async function ensureManagedStorageRoot(
  rootInput: string,
  kind: ManagedStorageKind,
): Promise<string> {
  const root = NodePath.resolve(rootInput);
  await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
  const existingKind = await readOwnerKind(root);
  if (existingKind !== null) {
    if (existingKind !== kind) {
      throw new Error(`Managed storage root ${root} belongs to ${existingKind}, not ${kind}.`);
    }
    return root;
  }

  const entries = await NodeFSP.readdir(root);
  if (entries.length > 0) {
    throw new Error(
      `Refusing to claim non-empty storage root without a valid ownership marker: ${root}`,
    );
  }
  try {
    await NodeFSP.writeFile(markerPath(root), ownerMarker(kind), { encoding: "utf8", flag: "wx" });
  } catch (cause) {
    // Two server boots may race while a supervisor is handing over. Accept
    // only the exact marker the other process just installed.
    if (
      !(cause instanceof Error && "code" in cause && cause.code === "EEXIST") ||
      (await readOwnerKind(root)) !== kind
    ) {
      throw cause;
    }
  }
  return root;
}

async function measureEntry(
  entryPath: string,
  expectedDevice: number,
): Promise<{ bytes: number; modifiedAtMs: number; retirable: boolean }> {
  const stat = await NodeFSP.lstat(entryPath);
  if (stat.dev !== expectedDevice) {
    return { bytes: 0, modifiedAtMs: stat.mtimeMs, retirable: false };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { bytes: stat.size, modifiedAtMs: stat.mtimeMs, retirable: true };
  }

  let bytes = stat.size;
  let modifiedAtMs = stat.mtimeMs;
  let retirable = true;
  const children = await NodeFSP.readdir(entryPath, { withFileTypes: true });
  for (const child of children) {
    const measured = await measureEntry(NodePath.join(entryPath, child.name), expectedDevice);
    bytes += measured.bytes;
    modifiedAtMs = Math.max(modifiedAtMs, measured.modifiedAtMs);
    retirable &&= measured.retirable;
  }
  return { bytes, modifiedAtMs, retirable };
}

async function removeTreeOnDevice(entryPath: string, expectedDevice: number): Promise<void> {
  const stat = await NodeFSP.lstat(entryPath);
  if (stat.dev !== expectedDevice) {
    throw new Error(`Refusing to cross a filesystem boundary while retiring ${entryPath}.`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    await NodeFSP.rm(entryPath, { force: true });
    return;
  }
  for (const child of await NodeFSP.readdir(entryPath)) {
    await removeTreeOnDevice(NodePath.join(entryPath, child), expectedDevice);
  }
  await NodeFSP.rmdir(entryPath);
}

async function retireEntry(root: string, rootDevice: number, entry: ManagedEntry): Promise<void> {
  const expectedParent = NodePath.resolve(root);
  if (NodePath.dirname(NodePath.resolve(entry.path)) !== expectedParent) {
    throw new Error(`Refusing to retire a path outside managed scratch: ${entry.path}`);
  }
  const trashPath = NodePath.join(
    root,
    `.retention-trash-${process.pid}-${NodeCrypto.randomUUID()}`,
  );
  await NodeFSP.rename(entry.path, trashPath);
  await removeTreeOnDevice(trashPath, rootDevice);
}

async function sweepRetiredEntries(
  root: string,
  rootDevice: number,
): Promise<{
  readonly entries: number;
  readonly bytes: number;
}> {
  let entries = 0;
  let bytes = 0;
  for (const entry of await NodeFSP.readdir(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(".retention-trash-")) continue;
    const candidate = NodePath.join(root, entry.name);
    try {
      const measured = await measureEntry(candidate, rootDevice);
      if (!measured.retirable) continue;
      await removeTreeOnDevice(candidate, rootDevice);
      entries += 1;
      bytes += measured.bytes;
    } catch {
      // An earlier pruning process may still be deleting the retired entry.
    }
  }
  return { entries, bytes };
}

/**
 * Expires only direct children of an ownership-marked scratch root. Recent
 * entries receive an active grace period even when the byte budget is full;
 * pressure protection elsewhere pauses new heavyweight checkpoint work.
 */
export async function pruneManagedScratch(input: {
  readonly root: string;
  readonly maxAgeMs: number;
  readonly maxBytes: number;
  readonly nowMs?: number;
  readonly activeGraceMs?: number;
}): Promise<ManagedScratchPruneResult> {
  const root = NodePath.resolve(input.root);
  if ((await readOwnerKind(root)) !== "scratch") {
    throw new Error(`Refusing to prune unowned scratch root: ${root}`);
  }
  const rootDevice = (await NodeFSP.lstat(root)).dev;

  // A crash after the atomic rename but before recursive removal must not
  // turn retirement directories into permanent garbage.
  const swept = await sweepRetiredEntries(root, rootDevice);

  const entries: ManagedEntry[] = [];
  for (const directoryEntry of await NodeFSP.readdir(root, { withFileTypes: true })) {
    if (directoryEntry.name === OWNER_MARKER) continue;
    const entryPath = NodePath.join(root, directoryEntry.name);
    try {
      entries.push({
        path: entryPath,
        name: directoryEntry.name,
        ...(await measureEntry(entryPath, rootDevice)),
      });
    } catch {
      // Concurrently removed, unreadable, or locked entries remain untouched.
    }
  }

  const nowMs = input.nowMs ?? Date.now();
  const activeGraceMs = input.activeGraceMs ?? DEFAULT_ACTIVE_GRACE_MS;
  const ordered = entries.toSorted(
    (left, right) => left.modifiedAtMs - right.modifiedAtMs || left.name.localeCompare(right.name),
  );
  const selected = new Set<string>();
  let retainedBytes = ordered.reduce((total, entry) => total + entry.bytes, 0);

  for (const entry of ordered) {
    if (!entry.retirable) continue;
    if (nowMs - entry.modifiedAtMs > Math.max(0, input.maxAgeMs)) {
      selected.add(entry.path);
      retainedBytes -= entry.bytes;
    }
  }
  for (const entry of ordered) {
    if (retainedBytes <= Math.max(0, input.maxBytes)) break;
    if (
      !entry.retirable ||
      selected.has(entry.path) ||
      nowMs - entry.modifiedAtMs <= activeGraceMs
    ) {
      continue;
    }
    selected.add(entry.path);
    retainedBytes -= entry.bytes;
  }

  let removedEntries = swept.entries;
  let removedBytes = swept.bytes;
  for (const entry of ordered) {
    if (!selected.has(entry.path)) continue;
    try {
      await retireEntry(root, rootDevice, entry);
      removedEntries += 1;
      removedBytes += entry.bytes;
    } catch {
      // A process may still own or replace the entry; preserve it on any race.
      retainedBytes += entry.bytes;
    }
  }

  return {
    scannedEntries: entries.length,
    removedEntries,
    removedBytes,
    retainedBytes,
  };
}
