import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { RpcClientError } from "effect/unstable/rpc";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { archiveThread, createProject, startThreadTurn, stopThreadSession } from "./commands.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (
  dispatched: ClientOrchestrationCommand[],
  preparedConnection?: PreparedConnection,
) {
  const client = {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(
      preparedConnection === undefined
        ? Option.none<PreparedConnection>()
        : Option.some(preparedConnection),
    ),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("environment commands", () => {
  it.effect("adds generated command metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const result = yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* stopThreadSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* archiveThread({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("retries an ambiguous transport failure with the same command id", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      let attempts = 0;
      const client = {
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
          Effect.suspend(() => {
            dispatched.push(command);
            attempts += 1;
            return attempts === 1
              ? Effect.fail(
                  new RpcClientError.RpcClientError({
                    reason: new RpcClientError.RpcClientDefect({
                      message: "socket closed after commit",
                      cause: new Error("socket closed after commit"),
                    }),
                  }),
                )
              : Effect.succeed({ sequence: 42 });
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession.RpcSession = {
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session)),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);

      const resultFiber = yield* stopThreadSession({
        commandId: CommandId.make("retry-safe-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("250 millis");

      expect(yield* Fiber.join(resultFiber)).toEqual({ sequence: 42 });
      expect(dispatched).toHaveLength(2);
      expect(dispatched[0]?.commandId).toBe("retry-safe-command");
      expect(dispatched[1]?.commandId).toBe("retry-safe-command");
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends a 4.3MB video turn over authenticated HTTP instead of WebSocket", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const prepared: PreparedConnection = {
        environmentId: TARGET.environmentId,
        label: TARGET.label,
        httpBaseUrl: TARGET.httpBaseUrl,
        socketUrl: "wss://environment.example.test/ws",
        httpAuthorization: null,
        target: TARGET,
      };
      const supervisor = yield* makeSupervisor(dispatched, prepared);
      const requests: Request[] = [];
      const requestBodies: unknown[] = [];
      const fetchFn: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        requestBodies.push(JSON.parse(await request.text()));
        return new Response(JSON.stringify({ sequence: 73 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const videoSizeBytes = 4_300_000;
      const fullTriplets = Math.floor(videoSizeBytes / 3);
      const remainder = videoSizeBytes % 3;
      const videoDataUrl = `data:video/mp4;base64,${"AAAA".repeat(fullTriplets)}${
        remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : ""
      }`;

      const result = yield* startThreadTurn({
        threadId: ThreadId.make("thread-video"),
        message: {
          messageId: MessageId.make("message-video"),
          role: "user",
          text: "Review this video",
          attachments: [
            {
              type: "video",
              name: "sample.mp4",
              mimeType: "video/mp4",
              sizeBytes: videoSizeBytes,
              dataUrl: videoDataUrl,
            },
          ],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        titleSeed: "Video review",
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchPolicy: "immediate",
        createdAt: "2026-07-30T00:00:00.000Z",
      }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provide(remoteHttpClientLayer(fetchFn)),
      );

      expect(result).toEqual({ sequence: 73 });
      expect(dispatched).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(requests[0]?.url).toBe("https://environment.example.test/api/orchestration/dispatch");
      expect(requestBodies[0]).toMatchObject({
        type: "thread.turn.start",
        threadId: "thread-video",
        message: {
          attachments: [
            {
              type: "video",
              name: "sample.mp4",
              sizeBytes: videoSizeBytes,
              dataUrl: videoDataUrl,
            },
          ],
        },
      });
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});
