// @effect-diagnostics nodeBuiltinImport:off - stale quarantine coverage needs native utimes.
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { assert, it } from "@effect/vitest";

import { CheckpointRef, GitCommandError } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { runVcsDriverContractSuite } from "./testing/VcsDriverContractHarness.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-git-vcs-contract-",
});
const GitContractLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const NoPressureServerConfigLayer = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.map(ServerConfig.ServerConfig, (config) =>
    ServerConfig.make({
      ...config,
      checkpointMinFreeBytes: 0,
      checkpointMinFreePercent: 0,
    }),
  ),
).pipe(Layer.provide(ServerConfigLayer));
const GitNoPressureLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(NoPressureServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const PressureServerConfigLayer = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.map(ServerConfig.ServerConfig, (config) =>
    ServerConfig.make({
      ...config,
      checkpointMinFreeBytes: Number.MAX_SAFE_INTEGER,
      checkpointMinFreePercent: 100,
    }),
  ),
).pipe(Layer.provide(ServerConfigLayer));
const GitPressureLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(PressureServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.execute({
      operation: "GitVcsDriver.contract.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

type GitContractError = GitCommandError | PlatformError.PlatformError;

runVcsDriverContractSuite<GitVcsDriver.GitVcsDriver, GitContractError>({
  name: "Git",
  kind: "git",
  layer: GitContractLayer,
  fixture: {
    createRepo: (cwd) =>
      Effect.gen(function* () {
        yield* runGit(cwd, ["init"]);
        yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
        yield* runGit(cwd, ["config", "user.name", "Test"]);
      }),
    writeFile: (cwd, relativePath, contents) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const absolutePath = path.join(cwd, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
        yield* fileSystem.writeFileString(absolutePath, contents);
      }),
    trackFile: (cwd, relativePath) => runGit(cwd, ["add", relativePath]),
    commit: (cwd, message) => runGit(cwd, ["commit", "-m", message]),
    ignorePath: (cwd, pattern) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(path.join(cwd, ".gitignore"), `${pattern}\n`);
      }),
  },
});

it.effect("GitVcsDriver forwards execute env to the VCS process", () => {
  let observedEnv: NodeJS.ProcessEnv | undefined;
  let observedAppendTruncationMarker: boolean | undefined;

  return Effect.gen(function* () {
    const driver = yield* GitVcsDriver.makeVcsDriverShape();

    yield* driver.execute({
      operation: "GitVcsDriver.test.env",
      cwd: "/repo",
      args: ["status"],
      env: {
        GIT_INDEX_FILE: "/tmp/t3-index",
      },
      appendTruncationMarker: true,
    });

    assert.deepStrictEqual(observedEnv, {
      GIT_INDEX_FILE: "/tmp/t3-index",
    });
    assert.strictEqual(observedAppendTruncationMarker, true);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              observedEnv = input.env;
              observedAppendTruncationMarker = input.appendTruncationMarker;
              return {
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
        }),
      ),
    ),
  );
});

it("suppresses checkpoint capture before the disk recovery reserve is consumed", () => {
  assert.deepStrictEqual(
    GitVcsDriver.assessCheckpointDiskSpace({
      availableBytes: 9n,
      totalBytes: 100n,
      minFreeBytes: 5,
      minFreePercent: 10,
    }),
    {
      status: "suppressed",
      reason: "storage-pressure",
      detail: "Automatic checkpoints require 10 free bytes; 9 are available.",
    },
  );
  assert.deepStrictEqual(
    GitVcsDriver.assessCheckpointDiskSpace({
      availableBytes: 10n,
      totalBytes: 100n,
      minFreeBytes: 5,
      minFreePercent: 10,
    }),
    { status: "ready" },
  );
});

it.effect("sweeps a dead checkpoint quarantine before applying the disk watermark", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-git-checkpoint-stale-quarantine-",
      });
      const driver = yield* VcsDriver.VcsDriver;
      yield* runGit(cwd, ["init"]);
      const commonDir = (yield* driver.execute({
        operation: "GitVcsDriver.test.staleQuarantineCommonDir",
        cwd,
        args: ["rev-parse", "--absolute-git-dir"],
      })).stdout.trim();
      const stale = path.join(commonDir, "t3-checkpoint-quarantine-999999-deadbeef");
      yield* fileSystem.makeDirectory(stale);
      yield* fileSystem.writeFileString(path.join(stale, "partial-pack"), "garbage");
      yield* Effect.promise(() => NodeFSP.utimes(stale, 0, 0));
      yield* TestClock.adjust("2 hours");

      const readiness = yield* driver.checkpoints!.assessCapture!({
        cwd,
        checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/pressure"),
      });

      assert.strictEqual(readiness.status, "suppressed");
      assert.isFalse(yield* fileSystem.exists(stale));
    }).pipe(Effect.provide(GitPressureLayer)),
  ),
);

it.effect("suppresses an empty outer repository that contains a nested repository", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-git-checkpoint-container-",
      });
      const nested = path.join(cwd, "nested-project");
      const driver = yield* VcsDriver.VcsDriver;

      yield* fileSystem.makeDirectory(nested);
      yield* runGit(cwd, ["init"]);
      yield* runGit(nested, ["init"]);

      const readiness = yield* driver.checkpoints!.assessCapture!({
        cwd,
        checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/container"),
      });
      assert.strictEqual(readiness.status, "suppressed");
      if (readiness.status === "suppressed") {
        assert.strictEqual(readiness.reason, "workspace-container");
        assert.include(readiness.detail, nested);
      }
    }).pipe(Effect.provide(GitNoPressureLayer)),
  ),
);

it.effect("publishes checkpoints from a disposable object quarantine", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-git-checkpoint-quarantine-",
      });
      const driver = yield* GitVcsDriver.makeVcsDriverShape();

      yield* runGit(cwd, ["init"]);
      yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
      yield* runGit(cwd, ["config", "user.name", "Test"]);
      yield* runGit(cwd, ["config", "core.autocrlf", "true"]);
      yield* fileSystem.writeFileString(path.join(cwd, "tracked.txt"), "before\n");
      yield* fileSystem.writeFileString(path.join(cwd, "line-endings.txt"), "before\r\n");
      yield* runGit(cwd, ["add", "tracked.txt", "line-endings.txt"]);
      yield* runGit(cwd, ["commit", "-m", "initial"]);

      const baselineRef = CheckpointRef.make("refs/t3/checkpoints/test/baseline");
      yield* driver.checkpoints!.captureCheckpoint({ cwd, checkpointRef: baselineRef });
      const baselineFile = yield* driver.execute({
        operation: "GitVcsDriver.test.baselineContents",
        cwd,
        args: ["show", `${baselineRef}:tracked.txt`],
      });
      assert.strictEqual(baselineFile.stdout, "before\n");

      yield* fileSystem.writeFileString(path.join(cwd, "tracked.txt"), "after\n");
      yield* fileSystem.writeFileString(path.join(cwd, "line-endings.txt"), "after\r\n");
      yield* fileSystem.writeFileString(path.join(cwd, "new.txt"), "new\n");
      const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/1");
      yield* driver.checkpoints!.captureCheckpoint({ cwd, checkpointRef });

      const checkpointFile = yield* driver.execute({
        operation: "GitVcsDriver.test.checkpointContents",
        cwd,
        args: ["show", `${checkpointRef}:tracked.txt`],
      });
      assert.strictEqual(checkpointFile.stdout, "after\n");
      const normalizedFile = yield* driver.execute({
        operation: "GitVcsDriver.test.checkpointRepositoryConfig",
        cwd,
        args: ["show", `${checkpointRef}:line-endings.txt`],
      });
      assert.strictEqual(normalizedFile.stdout, "after\n");

      const commonDir = (yield* driver.execute({
        operation: "GitVcsDriver.test.checkpointCommonDir",
        cwd,
        args: ["rev-parse", "--absolute-git-dir"],
      })).stdout.trim();
      const commonDirEntries = yield* fileSystem.readDirectory(commonDir);
      assert.deepStrictEqual(
        commonDirEntries.filter((entry) => entry.startsWith("t3-checkpoint-quarantine-")),
        [],
      );

      // A duplicate request for the same turn ref is a no-op under the
      // repository lock instead of recapturing a later filesystem state.
      yield* fileSystem.writeFileString(path.join(cwd, "tracked.txt"), "later\n");
      yield* driver.checkpoints!.captureCheckpoint({ cwd, checkpointRef });
      const duplicateContents = yield* driver.execute({
        operation: "GitVcsDriver.test.duplicateCheckpointContents",
        cwd,
        args: ["show", `${checkpointRef}:tracked.txt`],
      });
      assert.strictEqual(duplicateContents.stdout, "after\n");
    }).pipe(Effect.provide(GitContractLayer)),
  ),
);

it.effect("removes quarantined objects when checkpoint staging fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-git-checkpoint-quarantine-failure-",
      });
      const driver = yield* GitVcsDriver.makeVcsDriverShape();

      yield* runGit(cwd, ["init"]);
      yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
      yield* runGit(cwd, ["config", "user.name", "Test"]);
      yield* fileSystem.writeFileString(path.join(cwd, "tracked.txt"), "before\n");
      yield* runGit(cwd, ["add", "tracked.txt"]);
      yield* runGit(cwd, ["commit", "-m", "initial"]);
      const objectsBefore = yield* driver.execute({
        operation: "GitVcsDriver.test.objectsBeforeFailedCapture",
        cwd,
        args: ["count-objects", "-v"],
      });

      yield* runGit(cwd, ["config", "filter.checkpoint-failure.clean", "false"]);
      yield* runGit(cwd, ["config", "filter.checkpoint-failure.required", "true"]);
      yield* fileSystem.writeFileString(
        path.join(cwd, ".gitattributes"),
        "*.checkpoint-failure filter=checkpoint-failure\n",
      );
      yield* fileSystem.writeFileString(
        path.join(cwd, "large.checkpoint-failure"),
        "never publish\n",
      );
      const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/failure");
      const result = yield* driver
        .checkpoints!.captureCheckpoint({ cwd, checkpointRef })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));

      const commonDir = (yield* driver.execute({
        operation: "GitVcsDriver.test.failedCaptureCommonDir",
        cwd,
        args: ["rev-parse", "--absolute-git-dir"],
      })).stdout.trim();
      const commonDirEntries = yield* fileSystem.readDirectory(commonDir);
      assert.deepStrictEqual(
        commonDirEntries.filter((entry) => entry.startsWith("t3-checkpoint-quarantine-")),
        [],
      );
      const objectsAfter = yield* driver.execute({
        operation: "GitVcsDriver.test.objectsAfterFailedCapture",
        cwd,
        args: ["count-objects", "-v"],
      });
      assert.strictEqual(objectsAfter.stdout, objectsBefore.stdout);
      assert.isFalse(yield* driver.checkpoints!.hasCheckpointRef({ cwd, checkpointRef }));
    }).pipe(Effect.provide(GitContractLayer)),
  ),
);
