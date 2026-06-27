import { it as effectIt } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, vi } from "vite-plus/test";

import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as WindowIpc from "./window.ts";

function provideShell<A, E>(
  effect: Effect.Effect<A, E, ElectronShell.ElectronShell>,
  revealLocalMediaFile: (rawPath: unknown) => Effect.Effect<boolean>,
) {
  return effect.pipe(
    Effect.provideService(
      ElectronShell.ElectronShell,
      ElectronShell.ElectronShell.of({
        openExternal: () => Effect.succeed(false),
        revealLocalMediaFile,
        copyText: () => Effect.void,
      }),
    ),
  );
}

describe("window IPC methods", () => {
  effectIt.effect("delegates local media reveal to the Electron shell service", () =>
    Effect.gen(function* () {
      const mediaPath = "C:\\tmp\\hero.png";
      const revealLocalMediaFile = vi.fn((rawPath: unknown) =>
        Effect.succeed(rawPath === mediaPath),
      );

      const result = yield* provideShell(
        WindowIpc.revealLocalMediaFile.handler({ path: mediaPath }),
        revealLocalMediaFile,
      );

      expect(result).toBe(true);
      expect(revealLocalMediaFile).toHaveBeenCalledExactlyOnceWith(mediaPath);
    }),
  );

  effectIt.effect(
    "rejects invalid local media reveal payloads before resolving the shell service",
    () =>
      Effect.gen(function* () {
        const revealLocalMediaFile = vi.fn(() => Effect.succeed(true));
        const exit = yield* Effect.exit(
          provideShell(
            WindowIpc.revealLocalMediaFile.handler("not-an-object"),
            revealLocalMediaFile,
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect(revealLocalMediaFile).not.toHaveBeenCalled();
        if (Exit.isSuccess(exit)) return;

        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error) && Schema.isSchemaError(error.value)).toBe(true);
      }),
  );
});
