import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectTriggerRepository } from "../Services/ProjectTriggerRepository.ts";
import type { ProjectTriggerRow } from "../Services/ProjectTriggerRepository.ts";
import {
  ProjectTriggerService,
  type ProjectTriggerServiceShape,
} from "../Services/ProjectTriggerService.ts";
import { computeProjectTriggerNextFireAt } from "../schedule.ts";

const makeProjectTriggerService = Effect.gen(function* () {
  const repository = yield* ProjectTriggerRepository;

  const saveTrigger: ProjectTriggerServiceShape["saveTrigger"] = (input) =>
    Effect.gen(function* () {
      const baseRow: ProjectTriggerRow = {
        triggerId: input.triggerId,
        projectId: input.projectId,
        name: input.name,
        enabled: input.enabled,
        scheduleKind: input.scheduleKind,
        scheduleCron: input.scheduleCron,
        scheduleOnceAt: input.scheduleOnceAt,
        timezone: input.timezone ?? "UTC",
        nextFireAt: null,
        lastFireAt: null,
        prompt: input.prompt,
        attachments: [...(input.attachments ?? [])],
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        dispatchPolicy: input.dispatchPolicy ?? null,
        titleSeed: input.titleSeed ?? null,
        bootstrap: input.bootstrap ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: null,
        scheduleClaimedAt: null,
        scheduleClaimExpiresAt: null,
        failureDetail: null,
      };
      const nextFireAt = baseRow.enabled
        ? yield* computeProjectTriggerNextFireAt(baseRow, input.updatedAt, "initialize")
        : null;
      const row = {
        ...baseRow,
        nextFireAt,
      };
      yield* repository.upsertTrigger(row);
      return row;
    });

  return {
    saveTrigger,
    deleteTrigger: repository.deleteTrigger,
    listProjectTriggers: repository.listTriggersByProjectId,
  } satisfies ProjectTriggerServiceShape;
});

export const ProjectTriggerServiceLive = Layer.effect(
  ProjectTriggerService,
  makeProjectTriggerService,
);
