// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import {
  WORKSPACE_UPLOAD_MAX_FILE_BYTES,
  type WorkspaceUploadFileResult,
} from "@t3tools/contracts";
import type {
  FilesystemEntryMetadata,
  FilesystemGetMetadataInput,
  FilesystemGetMetadataResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  WorkspaceUploadConflict,
  WorkspaceUploadResult,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isNetworkPath } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

import { makeIsServerInternalPath } from "../auth/serverInternalPaths.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import { fileHeaderMimeType } from "./fileHeaderMimeType.ts";
import { toHostDrivePath } from "./hostDrivePath.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

export interface WorkspaceUploadSourceFile {
  readonly name: string;
  readonly path: string;
}

export interface WorkspaceUploadFilesInput {
  readonly cwd: string;
  readonly directory: string;
  readonly conflict: WorkspaceUploadConflict;
  readonly files: ReadonlyArray<WorkspaceUploadSourceFile>;
}
// NTFS reaches .git through trailing dots/spaces, stream suffixes and GIT~1; compare uppercased names.
const isGitMetadataName = (segment: string) => {
  const name = (segment.split(":")[0] ?? "").replace(/[. ]+$/, "").toUpperCase();
  return name === ".GIT" || name === "GIT~1";
};

export class WorkspaceFileSystemOperationError extends Schema.TaggedError<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceUploadOperationError extends Schema.TaggedError<WorkspaceUploadOperationError>()(
  "WorkspaceUploadOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "copy-upload",
      "lstat-upload",
      "realpath-upload",
      "rename-upload",
      "stat-upload",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace upload operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedError<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedError<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedError<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export class WorkspaceUploadTargetError extends Schema.TaggedError<WorkspaceUploadTargetError>()(
  "WorkspaceUploadTargetError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    reason: Schema.Literals([
      "invalid-file-name",
      "file-too-large",
      "parent-not-directory",
      "target-not-file",
      "unsafe-symbolic-link",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-file-name":
        return "Uploaded file names must be plain file names without path segments.";
      case "file-too-large":
        return `Uploaded files must be ${Math.round(WORKSPACE_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))}MB or smaller.`;
      case "parent-not-directory":
        return `Upload destination '${this.relativePath}' is not a directory.`;
      case "target-not-file":
        return `Upload target '${this.relativePath}' is not a regular file.`;
      case "unsafe-symbolic-link":
        return `Upload destination '${this.relativePath}' contains an unsafe symbolic link.`;
    }
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceUploadOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
  WorkspaceUploadTargetError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;
export type WorkspaceProjectFileError =
  | WorkspaceFileSystemOperationError
  | WorkspaceFilePathEscapeError
  | WorkspacePathNotFileError
  | WorkspaceBinaryFileError;

function normalizedUploadFileName(name: string): string | null {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    Buffer.byteLength(trimmed, "utf8") > 255
  ) {
    return null;
  }
  return trimmed;
}

function pathIsWithinRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
}

async function lstatOrNull(pathname: string) {
  try {
    return await NodeFSP.lstat(pathname);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw cause;
  }
}

async function resolveSafeUploadParent(input: {
  readonly workspaceRoot: string;
  readonly realWorkspaceRoot: string;
  readonly relativePath: string;
}): Promise<{ readonly parentPath: string; readonly fileName: string }> {
  const segments = input.relativePath.split("/");
  const fileName = segments.pop();
  if (!fileName) {
    throw new WorkspaceUploadTargetError({
      workspaceRoot: input.workspaceRoot,
      relativePath: input.relativePath,
      reason: "invalid-file-name",
    });
  }

  let currentPath = input.realWorkspaceRoot;
  for (const segment of segments) {
    const candidate = NodePath.join(currentPath, segment);
    let stat = await lstatOrNull(candidate);
    if (stat === null) {
      await NodeFSP.mkdir(candidate);
      stat = await NodeFSP.lstat(candidate);
    }
    if (stat.isSymbolicLink()) {
      throw new WorkspaceUploadTargetError({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        reason: "unsafe-symbolic-link",
      });
    }
    if (!stat.isDirectory()) {
      throw new WorkspaceUploadTargetError({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        reason: "parent-not-directory",
      });
    }
    currentPath = await NodeFSP.realpath(candidate);
    if (!pathIsWithinRoot(input.realWorkspaceRoot, currentPath)) {
      throw new WorkspaceFilePathEscapeError({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: input.realWorkspaceRoot,
        resolvedPath: currentPath,
      });
    }
  }

  return { parentPath: currentPath, fileName };
}

function uploadNameVariant(fileName: string, suffix: number): string {
  const parsed = NodePath.parse(fileName);
  return `${parsed.name} (${suffix})${parsed.ext}`;
}

async function selectUploadTarget(input: {
  readonly parentPath: string;
  readonly fileName: string;
  readonly conflict: WorkspaceUploadConflict;
  readonly workspaceRoot: string;
  readonly relativePath: string;
}): Promise<{
  readonly targetPath: string;
  readonly fileName: string;
  readonly existing: boolean;
  readonly status: "uploaded" | "renamed" | "skipped";
}> {
  const requestedTargetPath = NodePath.join(input.parentPath, input.fileName);
  const requestedStat = await lstatOrNull(requestedTargetPath);
  if (requestedStat === null) {
    return {
      targetPath: requestedTargetPath,
      fileName: input.fileName,
      existing: false,
      status: "uploaded",
    };
  }

  if (input.conflict === "skip") {
    return {
      targetPath: requestedTargetPath,
      fileName: input.fileName,
      existing: true,
      status: "skipped",
    };
  }

  if (input.conflict === "replace") {
    if (requestedStat.isSymbolicLink()) {
      throw new WorkspaceUploadTargetError({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        reason: "unsafe-symbolic-link",
      });
    }
    if (!requestedStat.isFile()) {
      throw new WorkspaceUploadTargetError({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        reason: "target-not-file",
      });
    }
    return {
      targetPath: requestedTargetPath,
      fileName: input.fileName,
      existing: true,
      status: "uploaded",
    };
  }

  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const fileName = uploadNameVariant(input.fileName, suffix);
    const targetPath = NodePath.join(input.parentPath, fileName);
    if ((await lstatOrNull(targetPath)) === null) {
      return { targetPath, fileName, existing: false, status: "renamed" };
    }
  }

  throw new Error(`Could not allocate a non-conflicting upload name for ${input.fileName}.`);
}

async function persistWorkspaceUpload(input: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly replaceExisting: boolean;
}): Promise<void> {
  const parentPath = NodePath.dirname(input.targetPath);
  const stagePath = NodePath.join(
    parentPath,
    `.${NodePath.basename(input.targetPath)}.kamicode-upload-${NodeCrypto.randomUUID()}.tmp`,
  );
  await NodeFSP.copyFile(input.sourcePath, stagePath, NodeFS.constants.COPYFILE_EXCL);
  try {
    if (input.replaceExisting) {
      try {
        await NodeFSP.rename(stagePath, input.targetPath);
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "EPERM") {
          throw cause;
        }
        await NodeFSP.unlink(input.targetPath);
        await NodeFSP.rename(stagePath, input.targetPath);
      }
      return;
    }

    await NodeFSP.link(stagePath, input.targetPath);
  } finally {
    await NodeFSP.unlink(stagePath).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        throw cause;
      }
    });
  }
}

export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    readonly getMetadata: (
      input: FilesystemGetMetadataInput,
    ) => Effect.Effect<FilesystemGetMetadataResult>;

    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      | WorkspaceFileSystemOperationError
      | WorkspaceFilePathEscapeError
      | WorkspacePathNotFileError
      | WorkspaceBinaryFileError
      | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Writes inside a known workspace only. */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      | WorkspaceFileSystemError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
    /** Persist browser-uploaded files inside the workspace root. */
    readonly uploadFiles: (
      input: WorkspaceUploadFilesInput,
    ) => Effect.Effect<
      WorkspaceUploadResult,
      | WorkspaceUploadOperationError
      | WorkspaceFilePathEscapeError
      | WorkspaceUploadTargetError
      | WorkspacePaths.WorkspacePathOutsideRootError
      | KnownWorkspaces.UnknownWorkspaceError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

const UTF8_BOM = "\uFEFF";

async function startsWithUtf8Bom(filePath: string): Promise<boolean> {
  const handle = await NodeFSP.open(
    filePath,
    // O_NONBLOCK keeps a FIFO with no writer from hanging the save.
    NodeFS.constants.O_RDONLY |
      (NodeFS.constants.O_NOFOLLOW ?? 0) |
      (NodeFS.constants.O_NONBLOCK ?? 0),
  ).catch(() => null);
  if (!handle) return false;
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(3), 0, 3, 0);
    return bytesRead === 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

const isWorkspaceUploadTargetError = Schema.is(WorkspaceUploadTargetError);

const isWorkspaceFilePathEscapeError = Schema.is(WorkspaceFilePathEscapeError);

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const isServerInternalPath = yield* makeIsServerInternalPath;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const toHostPath = (requestedPath: string) =>
    toHostDrivePath(requestedPath).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  const metadataForPath = Effect.fnUntraced(function* (requestedPath: string) {
    const expandedPath = expandHomePath(
      yield* toHostPath(requestedPath),
      yield* HostProcess.HomeDirectory,
    );
    // Chips ask as soon as an agent's message renders, and touching a network
    // path makes Windows sign in to its host with the user's NTLM credentials.
    if (!path.isAbsolute(expandedPath) || isNetworkPath(expandedPath)) return null;
    const stat = yield* fileSystem.stat(expandedPath).pipe(Effect.option);
    // Server state files answer like missing paths, as readFile refuses them.
    if (stat._tag === "None" || (yield* isServerInternalPath(expandedPath))) return null;
    if (stat.value.type === "Directory") return { kind: "directory" } as const;
    if (stat.value.type !== "File") return { kind: "other" } as const;
    let mimeType: string | undefined;
    if (path.extname(expandedPath) === "" && stat.value.size > 0) {
      mimeType = yield* Effect.tryPromise({
        try: async () => {
          const handle = await NodeFSP.open(
            expandedPath,
            NodeFS.constants.O_RDONLY | NodeFS.constants.O_NONBLOCK,
          );
          try {
            if (!(await handle.stat()).isFile()) return undefined;
            const buffer = Buffer.alloc(512);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return fileHeaderMimeType(buffer.subarray(0, bytesRead));
          } finally {
            await handle.close();
          }
        },
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined));
    }
    return {
      kind: "file",
      byteLength: Number(stat.value.size),
      ...(mimeType === undefined ? {} : { mimeType }),
    } satisfies FilesystemEntryMetadata;
  });

  const getMetadata: WorkspaceFileSystem["Service"]["getMetadata"] = Effect.fn(
    "WorkspaceFileSystem.getMetadata",
  )(function* (input) {
    const paths = [...new Set(input.paths)];
    const entries = yield* Effect.forEach(paths, metadataForPath, { concurrency: 8 });
    const byPath = new Map(paths.map((value, index) => [value, entries[index] ?? null]));
    return { entries: input.paths.map((value) => byPath.get(value) ?? null) };
  });

  /** Both paths must already be real paths. */
  const isInsideRealRoot = (realWorkspaceRoot: string, realPath: string) => {
    const relative = path.relative(realWorkspaceRoot, realPath);
    return !(
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    );
  };

  // Reject Git folders, including renamed bare repos whose config/hooks can execute; paths must be normalized.
  // Stop at linked worktrees' .git files since worktrees can sit inside bare repos.
  const isInGitFolder = async (absolutePath: string) => {
    if (absolutePath.split(path.sep).some(isGitMetadataName)) return true;
    for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
      const [head, commondir, objects, refs, dotGit] = await Promise.all(
        ["HEAD", "commondir", "objects", "refs", ".git"].map((name) =>
          NodeFSP.lstat(path.join(folder, name)).catch((error: NodeJS.ErrnoException) => {
            // Any other failure leaves the folder unknown, so the write is refused.
            if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
            throw error;
          }),
        ),
      );
      // Git recognizes HEAD with commondir or objects/refs as a repository.
      if (head && (commondir || (objects && refs))) return true;
      if (dotGit?.isFile() || path.dirname(folder) === folder) return false;
    }
  };

  /**
   * Workspace-relative paths must stay inside the root, symlinks included. An
   * absolute or `~/` path reads a host file in place, such as a report an agent
   * wrote to a temp directory; it gets no root check. A network path does, since
   * Windows signs in to its host with the user's NTLM credentials.
   */
  const resolveReadTarget = Effect.fn("WorkspaceFileSystem.resolveReadTarget")(function* (
    input: ProjectReadFileInput,
  ) {
    const requestedPath = input.relativePath;
    const hostPath =
      requestedPath.startsWith("~/") || requestedPath.startsWith("~\\")
        ? expandHomePath(requestedPath, yield* HostProcess.HomeDirectory)
        : yield* toHostPath(requestedPath);
    if (
      isNetworkPath(hostPath) &&
      !KnownWorkspaces.isWithinRoot(path, path.resolve(hostPath), path.resolve(input.cwd))
    ) {
      return yield* new WorkspacePaths.WorkspacePathOutsideRootError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
    }
    if (path.isAbsolute(hostPath)) {
      // Native realpath hands Windows a `\\?\` path as written, `..` included,
      // so a network path must be the resolved one the check above approved.
      // Others keep POSIX `link/..` semantics, which resolving first would change.
      const absolutePath = isNetworkPath(hostPath) ? path.resolve(hostPath) : hostPath;
      const realTargetPath = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(absolutePath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: absolutePath,
            operationPath: absolutePath,
            operation: "realpath-target",
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) =>
            input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
          () => Effect.succeed(null),
        ),
      );
      return { relativePath: requestedPath, realTargetPath };
    }

    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(path.resolve(input.cwd)),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    }).pipe(
      // Storage cleanup removes idle worktrees but keeps their path, so nothing below them exists.
      Effect.catchIf(
        (error) =>
          input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
        () => Effect.succeed(null),
      ),
    );
    if (realWorkspaceRoot === null) {
      return { relativePath: target.relativePath, realTargetPath: null };
    }
    const resolved = yield* Effect.tryPromise({
      try: async () => {
        let candidate = target.absolutePath;
        for (;;) {
          try {
            return {
              realTargetPath: path.join(
                await NodeFSP.realpath(candidate),
                path.relative(candidate, target.absolutePath),
              ),
              exists: candidate === target.absolutePath,
            };
          } catch (error) {
            if (!input.allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
            // Like writes, missing reads must check the nearest existing ancestor.
            // An existing entry that cannot resolve is a dangling link, not absence.
            const exists = await NodeFSP.lstat(candidate).then(
              () => true,
              (cause: NodeJS.ErrnoException) => {
                if (cause.code !== "ENOENT") throw cause;
                return false;
              },
            );
            if (exists || path.dirname(candidate) === candidate) throw error;
            candidate = path.dirname(candidate);
          }
        }
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    if (!isInsideRealRoot(realWorkspaceRoot, resolved.realTargetPath)) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: resolved.realTargetPath,
      });
    }
    return {
      relativePath: target.relativePath,
      realTargetPath: resolved.exists ? resolved.realTargetPath : null,
    };
  });

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* resolveReadTarget(input);
    const absentResult = {
      relativePath: target.relativePath,
      contents: "",
      byteLength: 0,
      truncated: false,
      exists: false,
    };
    const realTargetPath = target.realTargetPath;
    if (realTargetPath === null) return absentResult;
    if (yield* isServerInternalPath(realTargetPath)) {
      return yield* new WorkspacePaths.WorkspacePathOutsideRootError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        // Non-blocking opens prevent FIFO hangs before stat rejects them; Windows lacks the flag.
        try: () =>
          NodeFSP.open(
            realTargetPath,
            NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0),
          ),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) =>
            input.allowMissing === true && (error.cause as NodeJS.ErrnoException).code === "ENOENT",
          () => Effect.succeed(null),
        ),
      ),
      (handle) =>
        Effect.gen(function* () {
          if (handle === null) return absentResult;
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          let offset = 0;
          while (offset < bytesToRead) {
            const { bytesRead } = yield* Effect.tryPromise({
              try: () => handle.read(buffer, offset, bytesToRead - offset, offset),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "read",
                  cause,
                }),
            });
            if (bytesRead <= 0) break;
            offset += bytesRead;
          }
          const fileBytes = buffer.subarray(0, offset);
          const truncated = stat.size > PROJECT_READ_FILE_MAX_BYTES;
          const binaryFileError = () =>
            new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          if (fileBytes.includes(0)) return yield* binaryFileError();
          // Fatal decoding rejects invalid UTF-8, since U+FFFD contents would corrupt the file on save.
          // Streaming decode drops a character the byte limit split, instead of rejecting it.
          const contents = yield* Effect.try({
            try: () =>
              new TextDecoder("utf-8", { fatal: true }).decode(fileBytes, { stream: truncated }),
            catch: binaryFileError,
          });
          return { relativePath: target.relativePath, contents, byteLength: stat.size, truncated };
        }),
      (handle) =>
        handle === null
          ? Effect.void
          : Effect.tryPromise({
              try: () => handle.close(),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "close",
                  cause,
                }),
            }),
    );
  });

  // Resolve existing ancestors and reject dangling links so creation cannot follow symlinks outside root.
  const resolveWriteTarget = Effect.fn("WorkspaceFileSystem.resolveWriteTarget")(function* (
    input: ProjectWriteFileInput,
  ) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const realWorkspaceRoot = yield* Effect.tryPromise({
      // Resolve `..` in cwd the way the relative path was resolved, before following links.
      try: () => NodeFSP.realpath(path.resolve(input.cwd)),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    });

    // Split the host path, not the display relativePath: on POSIX `\` is a file name character.
    const segments = path.relative(input.cwd, target.absolutePath).split(path.sep);
    const realTargetPath = yield* Effect.tryPromise({
      try: async () => {
        for (let depth = segments.length; depth > 0; depth--) {
          const candidate = path.join(realWorkspaceRoot, ...segments.slice(0, depth));
          try {
            return path.join(await NodeFSP.realpath(candidate), ...segments.slice(depth));
          } catch (error) {
            // Only a missing entry is skipped; one that exists but cannot resolve is a dangling link.
            const exists = await NodeFSP.lstat(candidate).then(
              () => true,
              () => false,
            );
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || exists) throw error;
          }
        }
        return path.join(realWorkspaceRoot, ...segments);
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    // The path as named is checked too: a `.git/config` symlink resolves away the `.git`.
    const namedTargetPath = path.join(realWorkspaceRoot, ...segments);
    const inGitFolder = Effect.fn("WorkspaceFileSystem.inGitFolder")((checkedPath: string) =>
      Effect.tryPromise({
        try: () => isInGitFolder(checkedPath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: checkedPath,
            operation: "stat",
            cause,
          }),
      }),
    );
    if (
      !isInsideRealRoot(realWorkspaceRoot, realTargetPath) ||
      (yield* inGitFolder(realTargetPath)) ||
      (yield* inGitFolder(namedTargetPath))
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }
    return { relativePath: target.relativePath, realTargetPath };
  });

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const target = yield* resolveWriteTarget(input);
    const realTargetPath = target.realTargetPath;
    const replacesFile = yield* fileSystem
      .exists(realTargetPath)
      .pipe(Effect.orElseSucceed(() => false));
    // readFile decodes the BOM away, so an editor save would otherwise drop it from the file.
    const keepsBom =
      replacesFile &&
      !input.contents.startsWith(UTF8_BOM) &&
      (yield* Effect.promise(() => startsWithUtf8Bom(realTargetPath)));
    const contents = keepsBom ? UTF8_BOM + input.contents : input.contents;

    yield* fileSystem.makeDirectory(path.dirname(realTargetPath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: path.dirname(realTargetPath),
            operation: "make-directory",
            cause,
          }),
      ),
    );
    yield* Effect.tryPromise({
      // A symlink swapped in after the check is not followed. Windows lacks O_NOFOLLOW.
      try: () =>
        NodeFSP.writeFile(realTargetPath, contents, {
          flag:
            NodeFS.constants.O_WRONLY |
            NodeFS.constants.O_CREAT |
            NodeFS.constants.O_TRUNC |
            (NodeFS.constants.O_NOFOLLOW ?? 0),
        }),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: realTargetPath,
          operationPath: realTargetPath,
          operation: "write-file",
          cause,
        }),
    });
    // Editor autosave overwrites existing files, which leaves the indexed paths unchanged, and
    // fff's watcher applies the new contents on its own. A forced rescan re-walks the whole
    // workspace, and the save would wait for it.
    if (!replacesFile) {
      yield* workspaceEntries.refresh(input.cwd);
    }
    return { relativePath: target.relativePath };
  });

  const uploadFiles: WorkspaceFileSystem["Service"]["uploadFiles"] = Effect.fn(
    "WorkspaceFileSystem.uploadFiles",
  )(function* (input) {
    yield* knownWorkspaces.assertContains(input.cwd);
    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.cwd),
      catch: (cause) =>
        new WorkspaceUploadOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.directory,
          resolvedPath: input.cwd,
          operationPath: input.cwd,
          operation: "realpath-upload",
          cause,
        }),
    });
    const results: Array<WorkspaceUploadFileResult> = [];

    for (const upload of input.files) {
      const fileName = normalizedUploadFileName(upload.name);
      const requestedRelativePath = [input.directory.trim(), fileName ?? upload.name]
        .filter((part) => part.length > 0 && part !== ".")
        .join("/");
      if (fileName === null) {
        return yield* new WorkspaceUploadTargetError({
          workspaceRoot: input.cwd,
          relativePath: requestedRelativePath,
          reason: "invalid-file-name",
        });
      }

      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: requestedRelativePath,
      });
      const sourceStat = yield* Effect.tryPromise({
        try: () => NodeFSP.stat(upload.path),
        catch: (cause) =>
          new WorkspaceUploadOperationError({
            workspaceRoot: input.cwd,
            relativePath: target.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: upload.path,
            operation: "stat-upload",
            cause,
          }),
      });
      if (!sourceStat.isFile()) {
        return yield* new WorkspaceUploadTargetError({
          workspaceRoot: input.cwd,
          relativePath: target.relativePath,
          reason: "target-not-file",
        });
      }
      if (sourceStat.size > WORKSPACE_UPLOAD_MAX_FILE_BYTES) {
        return yield* new WorkspaceUploadTargetError({
          workspaceRoot: input.cwd,
          relativePath: target.relativePath,
          reason: "file-too-large",
        });
      }

      const resolved = yield* Effect.tryPromise({
        try: async () => {
          const parent = await resolveSafeUploadParent({
            workspaceRoot: input.cwd,
            realWorkspaceRoot,
            relativePath: target.relativePath,
          });
          return selectUploadTarget({
            parentPath: parent.parentPath,
            fileName: parent.fileName,
            conflict: input.conflict,
            workspaceRoot: input.cwd,
            relativePath: target.relativePath,
          });
        },
        catch: (cause) =>
          isWorkspaceUploadTargetError(cause) || isWorkspaceFilePathEscapeError(cause)
            ? cause
            : new WorkspaceUploadOperationError({
                workspaceRoot: input.cwd,
                relativePath: target.relativePath,
                resolvedPath: target.absolutePath,
                operationPath: NodePath.dirname(target.absolutePath),
                operation: "lstat-upload",
                cause,
              }),
      });

      const relativePath = NodePath.relative(realWorkspaceRoot, resolved.targetPath).replaceAll(
        "\\",
        "/",
      );
      if (resolved.status === "skipped") {
        results.push({
          originalName: fileName,
          relativePath,
          sizeBytes: sourceStat.size,
          status: "skipped",
        });
        continue;
      }

      yield* Effect.tryPromise({
        try: () =>
          persistWorkspaceUpload({
            sourcePath: upload.path,
            targetPath: resolved.targetPath,
            replaceExisting: resolved.existing,
          }),
        catch: (cause) =>
          new WorkspaceUploadOperationError({
            workspaceRoot: input.cwd,
            relativePath,
            resolvedPath: resolved.targetPath,
            operationPath: resolved.targetPath,
            operation: resolved.existing ? "rename-upload" : "copy-upload",
            cause,
          }),
      });
      results.push({
        originalName: fileName,
        relativePath,
        sizeBytes: sourceStat.size,
        status: resolved.status,
      });
    }

    yield* workspaceEntries.refresh(input.cwd);
    return { files: results };
  });

  return WorkspaceFileSystem.of({ getMetadata, readFile, writeFile, uploadFiles });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
