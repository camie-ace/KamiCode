import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CronExpressionParser } from "cron-parser";

import type { ProjectTriggerRow } from "./Services/ProjectTriggerRepository.ts";

export class ProjectTriggerScheduleError extends Schema.TaggedErrorClass<ProjectTriggerScheduleError>()(
  "ProjectTriggerScheduleError",
  {
    triggerId: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Project trigger schedule error for ${this.triggerId}: ${this.detail}`;
  }
}

export type ProjectTriggerNextFireMode = "initialize" | "after-fire";

export const computeProjectTriggerNextFireAt = Effect.fn("computeProjectTriggerNextFireAt")(
  function* (
    trigger: ProjectTriggerRow,
    after: string,
    mode: ProjectTriggerNextFireMode,
  ): Effect.fn.Return<string | null, ProjectTriggerScheduleError> {
    switch (trigger.scheduleKind) {
      case "manual":
        return null;
      case "once":
        return mode === "initialize" ? trigger.scheduleOnceAt : null;
      case "cron": {
        if (trigger.scheduleCron === null) {
          return yield* new ProjectTriggerScheduleError({
            triggerId: trigger.triggerId,
            detail: "Cron trigger is missing scheduleCron.",
          });
        }
        const scheduleCron = trigger.scheduleCron;
        return yield* Effect.try({
          try: () => {
            const interval = CronExpressionParser.parse(scheduleCron, {
              currentDate: after,
              tz: trigger.timezone,
              hashSeed: trigger.triggerId,
            });
            return interval.next().toDate().toISOString();
          },
          catch: (cause) =>
            new ProjectTriggerScheduleError({
              triggerId: trigger.triggerId,
              detail: cause instanceof Error ? cause.message : "Failed to compute next fire time.",
              cause,
            }),
        });
      }
    }
  },
);
