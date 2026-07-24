// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import {
  WORKSPACE_UPLOAD_MAX_FILE_BYTES,
  type WorkspaceUploadFileResult,
} from "@t3tools/contracts";
import type {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  WorkspaceUploadConflict,
  WorkspaceUploadResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

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

export class WorkspaceFileSystemOperationError extends Schema.TaggedErrorClass<WorkspaceFileSystemOperationError>()(
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

export class WorkspaceUploadOperationError extends Schema.TaggedErrorClass<WorkspaceUploadOperationError>()(
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

export class WorkspaceFilePathEscapeError extends Schema.TaggedErrorClass<WorkspaceFilePathEscapeError>()(
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

export class WorkspacePathNotFileError extends Schema.TaggedErrorClass<WorkspacePathNotFileError>()(
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

export class WorkspaceBinaryFileError extends Schema.TaggedErrorClass<WorkspaceBinaryFileError>()(
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

export class WorkspaceUploadTargetError extends Schema.TaggedErrorClass<WorkspaceUploadTargetError>()(
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

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /** Read a UTF-8 text file relative to the workspace root. */
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
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      WorkspaceFileSystemOperationError | WorkspacePaths.WorkspacePathOutsideRootError
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
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.cwd),
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
    const realTargetPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(target.absolutePath),
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
    const relativeRealPath = path.relative(realWorkspaceRoot, realTargetPath);
    if (
      relativeRealPath.startsWith(`..${path.sep}`) ||
      relativeRealPath === ".." ||
      path.isAbsolute(relativeRealPath)
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => NodeFSP.open(realTargetPath, "r"),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }),
      (handle) =>
        Effect.gen(function* () {
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
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => handle.read(buffer, 0, bytesToRead, 0),
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
          const fileBytes = buffer.subarray(0, bytesRead);
          if (fileBytes.includes(0)) {
            return yield* new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          return {
            relativePath: target.relativePath,
            contents: new TextDecoder("utf-8").decode(fileBytes),
            byteLength: stat.size,
            truncated: stat.size > PROJECT_READ_FILE_MAX_BYTES,
          };
        }),
      (handle) =>
        Effect.tryPromise({
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

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: path.dirname(target.absolutePath),
            operation: "make-directory",
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "write-file",
            cause,
          }),
      ),
    );
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  const uploadFiles: WorkspaceFileSystem["Service"]["uploadFiles"] = Effect.fn(
    "WorkspaceFileSystem.uploadFiles",
  )(function* (input) {
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
          Schema.is(WorkspaceUploadTargetError)(cause) ||
          Schema.is(WorkspaceFilePathEscapeError)(cause)
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

  return WorkspaceFileSystem.of({ readFile, writeFile, uploadFiles });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
