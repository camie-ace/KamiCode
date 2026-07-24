import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer, { excludeTestServices: true })("WorkspaceFileSystemLive", (it) => {
  describe("readFile", () => {
    it.effect("reads UTF-8 files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "export const answer = 42;\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/index.ts",
        });

        expect(result).toEqual({
          relativePath: "src/index.ts",
          contents: "export const answer = 42;\n",
          byteLength: 26,
          truncated: false,
        });
      }),
    );

    it.effect("rejects reads outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "../escape.md" })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );
      }),
    );

    it.effect("rejects symlinks that resolve outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "secret.txt", "outside\n");
        yield* fileSystem.symlink(
          path.join(outsideDir, "secret.txt"),
          path.join(cwd, "linked-secret.txt"),
        );

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "linked-secret.txt" })
          .pipe(Effect.flip);
        const resolvedWorkspaceRoot = yield* fileSystem.realPath(cwd);
        const resolvedPath = yield* fileSystem.realPath(path.join(outsideDir, "secret.txt"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "linked-secret.txt",
          resolvedWorkspaceRoot,
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects directories without manufacturing an I/O cause", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "src" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(path.join(cwd, "src"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "src",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects binary files without leaking their contents into the error", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "asset.bin");
        yield* fileSystem.writeFile(absolutePath, Uint8Array.from([0x61, 0, 0x62]));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "asset.bin" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(absolutePath);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceBinaryFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "asset.bin",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
        expect("contents" in error).toBe(false);
      }),
    );

    it.effect("preserves the real cause and path for I/O failures", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const resolvedPath = path.join(cwd, "missing.txt");

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "missing.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileSystemOperationError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "missing.txt",
          resolvedPath,
          operationPath: resolvedPath,
          operation: "realpath-target",
        });
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.list({ cwd });
        expect(beforeWrite.entries.some((entry) => entry.path === "plans/effect-rpc.md")).toBe(
          false,
        );

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.list({ cwd });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.orElseSucceed(() => null));
        expect(escapedStat).toBeNull();
      }),
    );
  });

  describe("uploadFiles", () => {
    it.effect("streams binary files into nested workspace directories without changing bytes", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const uploadDir = yield* makeTempDir;
        const sourcePath = path.join(uploadDir, "diagram.png");
        const sourceBytes = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
        yield* fileSystem.writeFile(sourcePath, sourceBytes);

        const result = yield* workspaceFileSystem.uploadFiles({
          cwd,
          directory: "assets/generated",
          conflict: "keep-both",
          files: [{ name: "diagram.png", path: sourcePath }],
        });
        const saved = yield* fileSystem.readFile(path.join(cwd, "assets/generated/diagram.png"));

        expect(result).toEqual({
          files: [
            {
              originalName: "diagram.png",
              relativePath: "assets/generated/diagram.png",
              sizeBytes: sourceBytes.byteLength,
              status: "uploaded",
            },
          ],
        });
        expect(Array.from(saved)).toEqual(Array.from(sourceBytes));
      }),
    );

    it.effect("refreshes an existing workspace entry index after upload", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const uploadDir = yield* makeTempDir;
        const sourcePath = path.join(uploadDir, "notes.md");
        yield* fileSystem.writeFileString(sourcePath, "# Notes\n");

        const beforeUpload = yield* workspaceEntries.list({ cwd });
        expect(beforeUpload.entries).toEqual([]);

        yield* workspaceFileSystem.uploadFiles({
          cwd,
          directory: "docs",
          conflict: "keep-both",
          files: [{ name: "notes.md", path: sourcePath }],
        });

        const afterUpload = yield* workspaceEntries.list({ cwd });
        expect(afterUpload.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "docs/notes.md", kind: "file" }),
          ]),
        );
      }),
    );

    it.effect("keeps existing files and chooses a non-conflicting upload name", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const uploadDir = yield* makeTempDir;
        const sourcePath = path.join(uploadDir, "spec.pdf");
        yield* writeTextFile(cwd, "docs/spec.pdf", "existing");
        yield* writeTextFile(cwd, "docs/spec (2).pdf", "existing copy");
        yield* fileSystem.writeFileString(sourcePath, "new");

        const result = yield* workspaceFileSystem.uploadFiles({
          cwd,
          directory: "docs",
          conflict: "keep-both",
          files: [{ name: "spec.pdf", path: sourcePath }],
        });

        expect(result).toEqual({
          files: [
            {
              originalName: "spec.pdf",
              relativePath: "docs/spec (3).pdf",
              sizeBytes: 3,
              status: "renamed",
            },
          ],
        });
        expect(yield* fileSystem.readFileString(path.join(cwd, "docs/spec.pdf"))).toBe("existing");
        expect(yield* fileSystem.readFileString(path.join(cwd, "docs/spec (3).pdf"))).toBe("new");
      }),
    );

    it.effect("supports skip and replace conflict policies", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const uploadDir = yield* makeTempDir;
        const sourcePath = path.join(uploadDir, "notes.txt");
        yield* writeTextFile(cwd, "notes.txt", "old");
        yield* fileSystem.writeFileString(sourcePath, "new");

        const skipped = yield* workspaceFileSystem.uploadFiles({
          cwd,
          directory: "",
          conflict: "skip",
          files: [{ name: "notes.txt", path: sourcePath }],
        });
        expect(skipped.files[0]?.status).toBe("skipped");
        expect(yield* fileSystem.readFileString(path.join(cwd, "notes.txt"))).toBe("old");

        const replaced = yield* workspaceFileSystem.uploadFiles({
          cwd,
          directory: "",
          conflict: "replace",
          files: [{ name: "notes.txt", path: sourcePath }],
        });
        expect(replaced.files[0]?.status).toBe("uploaded");
        expect(yield* fileSystem.readFileString(path.join(cwd, "notes.txt"))).toBe("new");
      }),
    );

    it.effect("rejects upload destinations and names that escape the workspace", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const uploadDir = yield* makeTempDir;
        const sourcePath = path.join(uploadDir, "payload.txt");
        yield* fileSystem.writeFileString(sourcePath, "nope");

        const destinationError = yield* workspaceFileSystem
          .uploadFiles({
            cwd,
            directory: "../outside",
            conflict: "keep-both",
            files: [{ name: "payload.txt", path: sourcePath }],
          })
          .pipe(Effect.flip);
        const nameError = yield* workspaceFileSystem
          .uploadFiles({
            cwd,
            directory: "",
            conflict: "keep-both",
            files: [{ name: "../payload.txt", path: sourcePath }],
          })
          .pipe(Effect.flip);

        expect(destinationError).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
        expect(nameError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceUploadTargetError);
      }),
    );
  });
});
