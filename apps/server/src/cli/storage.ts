import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import * as ServerConfig from "../config.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveBaseDir } from "../os-jank.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { compactDatabaseOffline, inspectDatabaseStorage } from "../storage/DatabaseCompaction.ts";
import { baseDirFlag } from "./config.ts";

const applyFlag = Flag.boolean("apply").pipe(
  Flag.withDefault(false),
  Flag.withDescription(
    "Build, verify, and atomically install a compact copy. The server must be stopped.",
  ),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

class StorageCommandServerRunningError extends Schema.TaggedErrorClass<StorageCommandServerRunningError>()(
  "StorageCommandServerRunningError",
  { pid: Schema.Int },
) {
  override get message(): string {
    return `Refusing offline compaction while the KamiCode server is running as pid ${String(this.pid)}.`;
  }
}

function safeTimestamp(iso: string): string {
  return iso.replace(/[-:.]/g, "");
}

const compactDatabaseCommand = Command.make("compact-database", {
  baseDir: baseDirFlag,
  apply: applyFlag,
}).pipe(
  Command.withDescription(
    "Audit duplicated activity payloads or compact them offline with a rollback database.",
  ),
  Command.withHandler(({ baseDir: baseDirOption, apply }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const hostPlatform = yield* HostProcessPlatform;
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(baseDirOption));
      const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined, {
        baseDirIsExplicit: Option.isSome(baseDirOption),
      });
      const before = yield* Effect.tryPromise(() => inspectDatabaseStorage(paths.dbPath));
      if (!apply) {
        yield* Console.log(encodeJson({ mode: "audit", ...before }));
        return;
      }

      const runtime = yield* readPersistedServerRuntimeState(paths.serverRuntimeStatePath);
      if (Option.isSome(runtime) && isProcessAlive(runtime.value.pid)) {
        return yield* new StorageCommandServerRunningError({ pid: runtime.value.pid });
      }

      const timestamp = safeTimestamp(DateTime.formatIso(yield* DateTime.now));
      const rollbackDirectory = path.join(
        path.dirname(paths.dbPath),
        "database-rollback",
        `${timestamp}-pre-compaction`,
      );
      const installed = yield* Effect.tryPromise(() =>
        compactDatabaseOffline({ databasePath: paths.dbPath, rollbackDirectory, hostPlatform }),
      );
      const after = yield* Effect.tryPromise(() => inspectDatabaseStorage(paths.dbPath));
      yield* Console.log(
        encodeJson({
          mode: "applied",
          before,
          after,
          compaction: installed,
          rollbackNotice:
            "Keep rollbackPath until the restarted server passes its integrity and smoke checks; then remove that exact owned rollback directory under your backup retention policy.",
        }),
      );
    }),
  ),
);

export const storageCommand = Command.make("storage").pipe(
  Command.withDescription("Audit and maintain bounded KamiCode-owned storage."),
  Command.withSubcommands([compactDatabaseCommand]),
);
