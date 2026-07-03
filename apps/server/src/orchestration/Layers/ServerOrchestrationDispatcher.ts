import {
  CommandId,
  EventId,
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ServerOrchestrationDispatcher,
  type ServerOrchestrationDispatcherShape,
  type ServerOrchestrationDispatchOptions,
} from "../Services/ServerOrchestrationDispatcher.ts";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const isProjectSetupScriptOperationError = Schema.is(
  ProjectSetupScriptRunner.ProjectSetupScriptOperationError,
);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const childCommandId = (
  command: Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>,
  tag: string,
) => CommandId.make(`${command.commandId}:${tag}`);

const childEventId = (
  command: Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>,
  tag: string,
) => EventId.make(`${command.commandId}:${tag}`);

const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
  isOrchestrationDispatchCommandError(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message: cause instanceof Error ? cause.message : fallbackMessage,
        cause,
      });

const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return isOrchestrationDispatchCommandError(error)
    ? error
    : new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
        cause,
      });
};

const messageFromUnknown = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (typeof value !== "object" || value === null || !("message" in value)) return null;
  const message = (value as { readonly message?: unknown }).message;
  return typeof message === "string" ? message : null;
};

const setupScriptFailureDetail = (error: unknown) => {
  if (isProjectSetupScriptOperationError(error)) {
    return messageFromUnknown(error.cause) ?? error.message;
  }
  return messageFromUnknown(error) ?? "Unknown setup failure.";
};

const makeServerOrchestrationDispatcher = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const gitWorkflow = yield* GitWorkflowService;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const startup = yield* ServerRuntimeStartup;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;

  const refreshGitStatus = (cwd: string) =>
    vcsStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const dispatchDirect = (command: OrchestrationCommand) =>
    orchestrationEngine
      .dispatch(command)
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command."),
        ),
      );

  const dispatchBootstrapTurnStart = (
    command: Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>,
    options?: ServerOrchestrationDispatchOptions,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
    Effect.gen(function* () {
      const bootstrap = command.bootstrap;
      const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
      const cleanupCreatedThreadOnFailure = options?.cleanupCreatedThreadOnFailure ?? true;
      let createdThread = false;
      let targetProjectId = bootstrap?.createThread?.projectId;
      let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
      let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

      const cleanupCreatedThread = () =>
        createdThread && cleanupCreatedThreadOnFailure
          ? orchestrationEngine
              .dispatch({
                type: "thread.delete",
                commandId: childCommandId(command, "bootstrap-thread-delete"),
                threadId: command.threadId,
              })
              .pipe(Effect.ignoreCause({ log: true }))
          : Effect.void;

      const appendSetupScriptActivity = (input: {
        readonly activityKey: string;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: childCommandId(command, `setup-script-activity:${input.activityKey}`),
          threadId: command.threadId,
          activity: {
            id: childEventId(command, `setup-script-activity:${input.activityKey}`),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const recordSetupScriptLaunchFailure = (input: {
        readonly error: unknown;
        readonly requestedAt: string;
        readonly worktreePath: string;
      }) => {
        const detail = setupScriptFailureDetail(input.error);
        return appendSetupScriptActivity({
          activityKey: "failed",
          kind: "setup-script.failed",
          summary: "Setup script failed to start",
          createdAt: input.requestedAt,
          payload: {
            detail,
            worktreePath: input.worktreePath,
          },
          tone: "error",
        }).pipe(
          Effect.ignoreCause({ log: false }),
          Effect.flatMap(() =>
            Effect.logWarning("bootstrap turn start failed to launch setup script", {
              threadId: command.threadId,
              worktreePath: input.worktreePath,
              detail,
            }),
          ),
        );
      };

      const recordSetupScriptStarted = (input: {
        readonly requestedAt: string;
        readonly worktreePath: string;
        readonly scriptId: string;
        readonly scriptName: string;
        readonly terminalId: string;
      }) =>
        Effect.gen(function* () {
          const startedAt = yield* nowIso;
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          yield* Effect.all([
            appendSetupScriptActivity({
              activityKey: "requested",
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              activityKey: "started",
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: startedAt,
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail: error.message,
                },
              ),
            ),
          );
        });

      const runSetupProgram = () =>
        Effect.gen(function* () {
          if (!bootstrap?.runSetupScript || !targetWorktreePath) {
            return;
          }
          const worktreePath = targetWorktreePath;
          const requestedAt = yield* nowIso;
          yield* projectSetupScriptRunner
            .runForThread({
              threadId: command.threadId,
              ...(targetProjectId ? { projectId: targetProjectId } : {}),
              ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
              worktreePath,
            })
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  recordSetupScriptLaunchFailure({
                    error,
                    requestedAt,
                    worktreePath,
                  }),
                onSuccess: (setupResult) => {
                  if (setupResult.status !== "started") {
                    return Effect.void;
                  }
                  return recordSetupScriptStarted({
                    requestedAt,
                    worktreePath,
                    scriptId: setupResult.scriptId,
                    scriptName: setupResult.scriptName,
                    terminalId: setupResult.terminalId,
                  });
                },
              }),
            );
        });

      const bootstrapProgram = Effect.gen(function* () {
        if (bootstrap?.createThread) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: childCommandId(command, "bootstrap-thread-create"),
            threadId: command.threadId,
            projectId: bootstrap.createThread.projectId,
            title: bootstrap.createThread.title,
            modelSelection: bootstrap.createThread.modelSelection,
            runtimeMode: bootstrap.createThread.runtimeMode,
            interactionMode: bootstrap.createThread.interactionMode,
            branch: bootstrap.createThread.branch,
            worktreePath: bootstrap.createThread.worktreePath,
            ...(bootstrap.createThread.startedBy !== undefined
              ? { startedBy: bootstrap.createThread.startedBy }
              : {}),
            ...(bootstrap.createThread.workflowParentThreadId !== undefined
              ? { workflowParentThreadId: bootstrap.createThread.workflowParentThreadId }
              : {}),
            ...(bootstrap.createThread.workflowLaneId !== undefined
              ? { workflowLaneId: bootstrap.createThread.workflowLaneId }
              : {}),
            ...(bootstrap.createThread.workflowLaneRole !== undefined
              ? { workflowLaneRole: bootstrap.createThread.workflowLaneRole }
              : {}),
            createdAt: bootstrap.createThread.createdAt,
          });
          createdThread = true;
        }

        const prepareWorktree = bootstrap?.prepareWorktree;
        if (prepareWorktree) {
          const worktreeRef = yield* Effect.gen(function* () {
            if (prepareWorktree.startFromOrigin !== true) {
              return {
                refName: prepareWorktree.baseBranch,
                baseRefName: undefined,
              };
            }

            yield* gitWorkflow.fetchRemote({
              cwd: prepareWorktree.projectCwd,
              remoteName: "origin",
            });
            const resolvedBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
              cwd: prepareWorktree.projectCwd,
              refName: prepareWorktree.baseBranch,
              fallbackRemoteName: "origin",
            });
            return {
              refName: resolvedBase.commitSha,
              baseRefName: prepareWorktree.baseBranch,
            };
          });
          const worktree = yield* gitWorkflow.createWorktree({
            cwd: prepareWorktree.projectCwd,
            refName: worktreeRef.refName,
            newRefName: prepareWorktree.branch,
            ...(worktreeRef.baseRefName ? { baseRefName: worktreeRef.baseRefName } : {}),
            path: null,
          });
          targetProjectCwd = prepareWorktree.projectCwd;
          targetWorktreePath = worktree.worktree.path;
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: childCommandId(command, "bootstrap-thread-meta-update"),
            threadId: command.threadId,
            branch: worktree.worktree.refName,
            worktreePath: targetWorktreePath,
          });
          yield* refreshGitStatus(targetWorktreePath);
        }

        yield* runSetupProgram();

        return yield* dispatchDirect(finalTurnStartCommand);
      });

      return yield* bootstrapProgram.pipe(
        Effect.catchCause((cause) => {
          const dispatchError = toBootstrapDispatchCommandCauseError(cause);
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.fail(dispatchError);
          }
          return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
        }),
      );
    });

  const dispatch: ServerOrchestrationDispatcherShape["dispatch"] = (command, options) => {
    const dispatchEffect =
      command.type === "thread.turn.start" && command.bootstrap
        ? dispatchBootstrapTurnStart(command, options)
        : dispatchDirect(command);

    return startup
      .enqueueCommand(dispatchEffect)
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command."),
        ),
      );
  };

  return {
    dispatch,
  } satisfies ServerOrchestrationDispatcherShape;
});

export const ServerOrchestrationDispatcherLive = Layer.effect(
  ServerOrchestrationDispatcher,
  makeServerOrchestrationDispatcher,
);
