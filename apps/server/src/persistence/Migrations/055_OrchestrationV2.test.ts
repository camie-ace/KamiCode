import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("055_OrchestrationV2", (it) => {
  it.effect("keeps released migrations contiguous", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        migrationEntries.map(([id]) => id),
        Array.from({ length: 116 }, (_, index) => index + 1),
      );
    }),
  );

  it.effect("upgrades released KamiCode schema 70 through the latest migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 70 });

      yield* sql`INSERT INTO projection_turn_queue
        (queue_id, thread_id, event_id, message_id, status, requested_at,
         runtime_mode, interaction_mode, scheduled_for, queue_position)
        VALUES ('queue-preserved', 'thread-preserved', 'event-preserved', 'message-preserved',
          'queued', '2026-10-01T00:00:00Z', 'full-access', 'workflow',
          '2026-10-06T00:00:00Z', 3)`;
      const previousLedger =
        yield* sql`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
      const previousQueue = yield* sql`SELECT * FROM projection_turn_queue`;
      const executed = yield* runMigrations();
      assert.deepStrictEqual(yield* sql`SELECT * FROM projection_turn_queue`, previousQueue);
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id <= 70 ORDER BY migration_id`,
        previousLedger,
      );
      assert.deepStrictEqual(executed, [
        [71, "ProjectionThreadsAutoSettleDisabledAt"],
        [72, "OrchestrationV2"],
        [73, "RemoveRedundantProjectionIndexes"],
        [74, "ImportKamiQueuedMessages"],
        [75, "ScheduledTaskWebhooks"],
        [76, "WebhookRelayDeliveries"],
        [77, "McpAppModelContext"],
        [78, "ThreadSnapshotWindowIndexes"],
        [79, "PullRequestReviewGuides"],
        [80, "ThreadFailureLookupIndex"],
        [81, "DropUnusedV1Projections"],
        [82, "CanonicalizeThreadPullRequestLinks"],
        [83, "CodexUsageNativeTurnIndex"],
        [84, "RepairClientSettlementTimestamps"],
        [85, "WebhookDedupe"],
        [86, "ShellStopRequestIndex"],
        [87, "ThreadMessageSearch"],
        [88, "PeerLinks"],
        [89, "PeerLinkFence"],
        [90, "WaitingLinkRequestIndex"],
        [91, "ActiveTurnItemIndexes"],
        [92, "ExcludeAttachmentPlaceholdersFromSearch"],
        [93, "SubagentDeliveryState"],
        [94, "ProjectionProjectsPinArchive"],
        [95, "RepairBooleanSettledOverride"],
        [96, "DropOrchestrationEventCorrelationIndex"],
        [97, "DelegatedRecoveryIndexes"],
        [98, "ScheduledTaskThreadMode"],
        [99, "ProjectionMessageSearchText"],
        [100, "TurnItemConversationIndex"],
        [101, "CommandReadIndexes"],
        [102, "LastExecutedRunIndex"],
        [103, "TurnItemCounts"],
        [104, "QueuedTurnInputIndex"],
        [105, "ProjectionProjectsCustomTitle"],
        [106, "TurnItemTypeStatusIndex"],
        [107, "ShellThreadReadIndexes"],
        [108, "AuthConnectDevices"],
        [109, "AuthConnectDeniedRequests"],
        [110, "QueuedTurnInputIndexJsonValid"],
        [111, "ProviderTurnAttemptIndex"],
        [112, "TurnItemMessageOrdinalIndex"],
        [113, "TurnItemInlineWorkOutput"],
        [114, "RepairStaleTitleRegeneration"],
        [115, "IssueTrackerBindings"],
        [116, "ActiveShellIndexIndexes"],
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 70
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 70, name: "PullRequestFilesViewed" },
        { migration_id: 71, name: "ProjectionThreadsAutoSettleDisabledAt" },
        { migration_id: 72, name: "OrchestrationV2" },
        { migration_id: 73, name: "RemoveRedundantProjectionIndexes" },
        { migration_id: 74, name: "ImportKamiQueuedMessages" },
        { migration_id: 75, name: "ScheduledTaskWebhooks" },
        { migration_id: 76, name: "WebhookRelayDeliveries" },
        { migration_id: 77, name: "McpAppModelContext" },
        { migration_id: 78, name: "ThreadSnapshotWindowIndexes" },
        { migration_id: 79, name: "PullRequestReviewGuides" },
        { migration_id: 80, name: "ThreadFailureLookupIndex" },
        { migration_id: 81, name: "DropUnusedV1Projections" },
        { migration_id: 82, name: "CanonicalizeThreadPullRequestLinks" },
        { migration_id: 83, name: "CodexUsageNativeTurnIndex" },
        { migration_id: 84, name: "RepairClientSettlementTimestamps" },
        { migration_id: 85, name: "WebhookDedupe" },
        { migration_id: 86, name: "ShellStopRequestIndex" },
        { migration_id: 87, name: "ThreadMessageSearch" },
        { migration_id: 88, name: "PeerLinks" },
        { migration_id: 89, name: "PeerLinkFence" },
        { migration_id: 90, name: "WaitingLinkRequestIndex" },
        { migration_id: 91, name: "ActiveTurnItemIndexes" },
        { migration_id: 92, name: "ExcludeAttachmentPlaceholdersFromSearch" },
        { migration_id: 93, name: "SubagentDeliveryState" },
        { migration_id: 94, name: "ProjectionProjectsPinArchive" },
        { migration_id: 95, name: "RepairBooleanSettledOverride" },
        { migration_id: 96, name: "DropOrchestrationEventCorrelationIndex" },
        { migration_id: 97, name: "DelegatedRecoveryIndexes" },
        { migration_id: 98, name: "ScheduledTaskThreadMode" },
        { migration_id: 99, name: "ProjectionMessageSearchText" },
        { migration_id: 100, name: "TurnItemConversationIndex" },
        { migration_id: 101, name: "CommandReadIndexes" },
        { migration_id: 102, name: "LastExecutedRunIndex" },
        { migration_id: 103, name: "TurnItemCounts" },
        { migration_id: 104, name: "QueuedTurnInputIndex" },
        { migration_id: 105, name: "ProjectionProjectsCustomTitle" },
        { migration_id: 106, name: "TurnItemTypeStatusIndex" },
        { migration_id: 107, name: "ShellThreadReadIndexes" },
        { migration_id: 108, name: "AuthConnectDevices" },
        { migration_id: 109, name: "AuthConnectDeniedRequests" },
        { migration_id: 110, name: "QueuedTurnInputIndexJsonValid" },
        { migration_id: 111, name: "ProviderTurnAttemptIndex" },
        { migration_id: 112, name: "TurnItemMessageOrdinalIndex" },
        { migration_id: 113, name: "TurnItemInlineWorkOutput" },
        { migration_id: 114, name: "RepairStaleTitleRegeneration" },
        { migration_id: 115, name: "IssueTrackerBindings" },
        { migration_id: 116, name: "ActiveShellIndexIndexes" },
      ]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'orchestration_v2_projection_threads',
            'orchestration_v2_projection_subagents',
            'orchestration_v2_effect_outbox',
            'orchestration_v2_turn_item_positions',
            'orchestration_v2_projection_metadata',
            'orchestration_v2_projection_provider_session_bindings',
            'orchestration_v2_thread_launch_workflows',
            'orchestration_v2_legacy_imports',
            'scheduled_tasks'
          )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map(({ name }) => name),
        [
          "orchestration_v2_effect_outbox",
          "orchestration_v2_legacy_imports",
          "orchestration_v2_projection_metadata",
          "orchestration_v2_projection_provider_session_bindings",
          "orchestration_v2_projection_subagents",
          "orchestration_v2_projection_threads",
          "orchestration_v2_thread_launch_workflows",
          "orchestration_v2_turn_item_positions",
          "scheduled_tasks",
        ],
      );

      const eventColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_events)
      `;
      const receiptColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_command_receipts)
      `;
      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_v2_projection_threads)
      `;
      const subagentColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_v2_projection_subagents)
      `;
      assert.ok(eventColumns.some(({ name }) => name === "application_event_version"));
      assert.ok(receiptColumns.some(({ name }) => name === "command_type"));
      assert.ok(threadColumns.some(({ name }) => name === "provider_instance_id"));
      assert.ok(subagentColumns.some(({ name }) => name === "driver"));
      assert.ok(subagentColumns.some(({ name }) => name === "provider_instance_id"));

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_orchestration_events_application_high_water',
            'orchestration_events_v2_created_threads_idx',
            'orchestration_v2_projection_turn_items_shell_pending_idx'
          )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        indexes.map(({ name }) => name),
        [
          "idx_orchestration_events_application_high_water",
          "orchestration_events_v2_created_threads_idx",
          "orchestration_v2_projection_turn_items_shell_pending_idx",
        ],
      );
    }),
  );
});
