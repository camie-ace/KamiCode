import type {
  ChatAttachment,
  IsoDateTime,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  TurnDispatchPolicy,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  DeleteProjectTriggerInput,
  ListProjectTriggersByProjectInput,
  ProjectTriggerBootstrap,
  ProjectTriggerId,
  ProjectTriggerRepositoryError,
  ProjectTriggerRow,
  ProjectTriggerScheduleKind,
} from "./ProjectTriggerRepository.ts";
import type { ProjectTriggerScheduleError } from "../schedule.ts";

export interface SaveProjectTriggerInput {
  readonly triggerId: ProjectTriggerId;
  readonly projectId: ProjectId;
  readonly name: ProjectTriggerRow["name"];
  readonly enabled: boolean;
  readonly scheduleKind: ProjectTriggerScheduleKind;
  readonly scheduleCron: ProjectTriggerRow["scheduleCron"];
  readonly scheduleOnceAt: IsoDateTime | null;
  readonly timezone?: ProjectTriggerRow["timezone"];
  readonly prompt: ProjectTriggerRow["prompt"];
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly dispatchPolicy?: TurnDispatchPolicy | null;
  readonly titleSeed?: ProjectTriggerRow["titleSeed"];
  readonly bootstrap?: ProjectTriggerBootstrap | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export type ProjectTriggerServiceError =
  | ProjectTriggerRepositoryError
  | ProjectTriggerScheduleError;

export interface ProjectTriggerServiceShape {
  readonly saveTrigger: (
    input: SaveProjectTriggerInput,
  ) => Effect.Effect<ProjectTriggerRow, ProjectTriggerServiceError>;
  readonly deleteTrigger: (
    input: DeleteProjectTriggerInput,
  ) => Effect.Effect<boolean, ProjectTriggerRepositoryError>;
  readonly listProjectTriggers: (
    input: ListProjectTriggersByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectTriggerRow>, ProjectTriggerRepositoryError>;
}

export class ProjectTriggerService extends Context.Service<
  ProjectTriggerService,
  ProjectTriggerServiceShape
>()("t3/projectTriggers/Services/ProjectTriggerService") {}
