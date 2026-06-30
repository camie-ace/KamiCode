import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectTriggerRepositoryLive } from "./Layers/ProjectTriggerRepository.ts";
import { ProjectTriggerServiceLive } from "./Layers/ProjectTriggerService.ts";
import {
  createProjectTriggerDynamicToolRunner,
  PROJECT_TRIGGER_TOOL_NAMES,
} from "./dynamicTools.ts";
import { ProjectTriggerId, ProjectTriggerRepository } from "./Services/ProjectTriggerRepository.ts";
import { ProjectTriggerService } from "./Services/ProjectTriggerService.ts";

const layer = it.layer(
  ProjectTriggerServiceLive.pipe(
    Layer.provideMerge(ProjectTriggerRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

function readResponseJson(response: {
  readonly contentItems: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}) {
  const text = response.contentItems.find((item) => item.type === "inputText")?.text;
  assert.ok(text);
  return JSON.parse(text) as Record<string, unknown>;
}

layer("project trigger dynamic tools", (it) => {
  it.effect("create, list, update, disable, and delete persisted triggers", () =>
    Effect.gen(function* () {
      const service = yield* ProjectTriggerService;
      const repository = yield* ProjectTriggerRepository;
      const triggerId = ProjectTriggerId.make("trigger-dynamic-tool-test");
      const runner = createProjectTriggerDynamicToolRunner({
        service,
        repository,
        defaultProviderInstanceId: ProviderInstanceId.make("codex"),
        makeTriggerId: Effect.succeed(triggerId),
      });

      assert.deepStrictEqual(PROJECT_TRIGGER_TOOL_NAMES, [
        "create_trigger",
        "update_trigger",
        "set_trigger_enabled",
        "delete_trigger",
        "list_triggers",
      ]);

      const created = readResponseJson(
        yield* runner({
          tool: "create_trigger",
          rawArguments: {
            projectId: "project-trigger-tools",
            name: "Weekday triage",
            description: "Triage new work every weekday.",
            enabled: true,
            schedule: {
              expression: "0 9 * * 1-5",
              timezone: "UTC",
              runtime: "local",
            },
            threadTemplate: {
              prompt: "Summarize open work and propose next actions.",
              runtimeMode: "full-access",
              interactionMode: "default",
              model: "gpt-5.4",
            },
          },
        }),
      );
      assert.equal(created.tool, "create_trigger");
      assert.equal((created.trigger as { id: string }).id, triggerId);

      const listed = readResponseJson(
        yield* runner({
          tool: "list_triggers",
          rawArguments: { projectId: "project-trigger-tools" },
        }),
      );
      assert.equal((listed.triggers as ReadonlyArray<unknown>).length, 1);

      const updated = readResponseJson(
        yield* runner({
          tool: "update_trigger",
          rawArguments: {
            triggerId,
            name: "Weekday triage updated",
            threadTemplate: {
              prompt: "Summarize open work and draft follow-up actions.",
            },
          },
        }),
      );
      assert.equal((updated.trigger as { name: string }).name, "Weekday triage updated");

      const disabled = readResponseJson(
        yield* runner({
          tool: "set_trigger_enabled",
          rawArguments: { triggerId, enabled: false },
        }),
      );
      assert.equal((disabled.trigger as { enabled: boolean }).enabled, false);

      const deleted = readResponseJson(
        yield* runner({
          tool: "delete_trigger",
          rawArguments: { triggerId },
        }),
      );
      assert.equal(deleted.deleted, true);
    }),
  );
});
