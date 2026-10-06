import { CommandId, OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../../config.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import * as ThreadManagement from "../ThreadManagementService.ts";
import * as ThreadLaunch from "../ThreadLaunchService.ts";
import * as ThreadMessageIntake from "../ThreadMessageIntake.ts";
import { ServerOrchestrationDispatcher } from "../Services/ServerOrchestrationDispatcher.ts";

// Saved KamiCode trigger jobs retain their durable command IDs and V1 JSON shape.
// Execute them entirely through V2 so retries use the same command receipts as clients.
export const ServerOrchestrationDispatcherLive = Layer.effect(
  ServerOrchestrationDispatcher,
  Effect.gen(function* () {
    const startup = yield* ServerRuntimeStartup;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const context = yield* Effect.context<
      | ThreadManagement.ThreadManagementService
      | ThreadLaunch.ThreadLaunchService
      | FileSystem.FileSystem
      | ServerConfig.ServerConfig
    >();
    return ServerOrchestrationDispatcher.of({
      dispatch: (command, options) =>
        startup
          .enqueueCommand(
            Effect.gen(function* () {
              const template = command.bootstrap?.createThread;
              if (template !== undefined) {
                const prepare = command.bootstrap?.prepareWorktree;
                yield* ThreadMessageIntake.launchThread({
                  commandId: command.commandId,
                  threadId: command.threadId,
                  projectId: template.projectId,
                  title: template.title,
                  modelSelection: template.modelSelection,
                  runtimeMode: template.runtimeMode,
                  interactionMode: template.interactionMode,
                  ...(template.startedBy === undefined ? {} : { startedBy: template.startedBy }),
                  ...(options?.origin?.user === undefined
                    ? {}
                    : { createdByUser: options.origin.user }),
                  workspaceStrategy:
                    prepare !== undefined
                      ? {
                          type: "worktree",
                          baseRef: prepare.baseBranch,
                          ...(prepare.startFromOrigin === undefined
                            ? {}
                            : { startFromOrigin: prepare.startFromOrigin }),
                          ...(prepare.branch === undefined ? {} : { branch: prepare.branch }),
                        }
                      : template.worktreePath !== null
                        ? {
                            type: "existing_worktree",
                            worktreePath: template.worktreePath,
                            ...(template.branch === null ? {} : { branch: template.branch }),
                          }
                        : {
                            type: "root",
                            ...(template.branch === null ? {} : { branch: template.branch }),
                          },
                  initialMessage: {
                    messageId: command.message.messageId,
                    text: command.message.text,
                    attachments: command.message.attachments,
                    ...(command.message.context === undefined
                      ? {}
                      : { context: command.message.context }),
                  },
                  createdBy: "system",
                  creationSource: "server",
                });
                return { sequence: yield* threads.getThreadEventSequence(command.threadId) };
              }
              // Recurrences target an existing conversation. Preserve its explicit mode,
              // and queue behind active work when that was the saved dispatch policy.
              yield* threads.dispatch({
                type: "thread.runtime-mode.set",
                commandId: CommandId.make(`${command.commandId}:runtime-mode`),
                threadId: command.threadId,
                runtimeMode: command.runtimeMode,
              });
              yield* threads.dispatch({
                type: "thread.interaction-mode.set",
                commandId: CommandId.make(`${command.commandId}:interaction-mode`),
                threadId: command.threadId,
                interactionMode: command.interactionMode,
              });
              return yield* ThreadMessageIntake.dispatchCommand({
                type: "message.dispatch",
                commandId: command.commandId,
                threadId: command.threadId,
                messageId: command.message.messageId,
                text: command.message.text,
                attachments: command.message.attachments,
                ...(command.message.context === undefined
                  ? {}
                  : { context: command.message.context }),
                ...(command.modelSelection === undefined
                  ? {}
                  : { modelSelection: command.modelSelection }),
                ...(command.titleSeed === undefined ? {} : { titleSeed: command.titleSeed }),
                dispatchMode: {
                  type:
                    command.dispatchPolicy === "queue" ? "queue_after_active" : "start_immediately",
                },
                createdBy: "system",
                creationSource: "server",
              });
            }).pipe(Effect.provide(context)),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Could not dispatch the scheduled KamiCode job.",
                  cause,
                }),
            ),
          ),
    });
  }),
);
