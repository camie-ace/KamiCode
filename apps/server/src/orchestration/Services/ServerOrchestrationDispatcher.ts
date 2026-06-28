import type { OrchestrationCommand } from "@t3tools/contracts";
import { OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ServerOrchestrationDispatchOptions {
  readonly cleanupCreatedThreadOnFailure?: boolean;
}

export interface ServerOrchestrationDispatcherShape {
  readonly dispatch: (
    command: OrchestrationCommand,
    options?: ServerOrchestrationDispatchOptions,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export class ServerOrchestrationDispatcher extends Context.Service<
  ServerOrchestrationDispatcher,
  ServerOrchestrationDispatcherShape
>()("t3/orchestration/Services/ServerOrchestrationDispatcher") {}
