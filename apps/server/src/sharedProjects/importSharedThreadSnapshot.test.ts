import { assert, it } from "@effect/vitest";
import {
  SharedSessionSnapshot,
  ThreadId,
  ProjectId,
  OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import { sharedSnapshotEvents } from "./importSharedThreadSnapshot.ts";

const database = SqlitePersistenceMemory;
const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer, EffectOutbox.layer).pipe(
  Layer.provideMerge(database),
);
const testLayer = EventSink.layer.pipe(Layer.provideMerge(stores));
const at = "2026-10-06T10:00:00.000Z";
const snapshot = Schema.decodeUnknownSync(SharedSessionSnapshot)({
  version: 1,
  capturedAt: at,
  sourceEnvironmentId: "source",
  sourceThreadId: "old",
  sourceProjectId: "old-project",
  title: "Shared work",
  threadCreatedAt: at,
  threadUpdatedAt: at,
  threadArchivedAt: null,
  error: null,
  repository: {
    canonicalKey: null,
    remoteUrl: null,
    remoteName: null,
    defaultBranch: null,
    currentBranch: "main",
    headSha: null,
    dirty: false,
  },
  branch: "main",
  suggestedBranch: null,
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "workflow",
  messages: [
    {
      id: "question",
      role: "user",
      text: "Review clip",
      authorGithubLogin: null,
      turnId: "source-run",
      createdAt: at,
      completedAt: null,
      attachments: [
        { id: "clip", type: "video", name: "clip.mp4", mimeType: "video/mp4", sizeBytes: 42 },
      ],
    },
    {
      id: "answer",
      role: "assistant",
      text: "Reviewed",
      authorGithubLogin: null,
      turnId: "source-run",
      createdAt: "2026-10-06T10:02:00.000Z",
      completedAt: null,
      attachments: [],
    },
  ],
  activities: [
    {
      id: "activity",
      tone: "info",
      kind: "workflow.lane.completed",
      summary: "Verified",
      payload: { laneId: "verify" },
      turnId: "source-run",
      createdAt: "2026-10-06T10:01:00.000Z",
    },
  ],
  proposedPlans: [
    {
      id: "plan",
      turnId: null,
      planMarkdown: "Review the clip",
      createdAt: at,
      updatedAt: at,
      implementedAt: null,
    },
  ],
  checkpoints: [
    {
      turnId: "source-run",
      checkpointTurnCount: 1,
      checkpointRef: "refs/source-only",
      status: "ready",
      files: [{ path: "a.ts", kind: "modified", additions: 2, deletions: 1 }],
      assistantMessageId: "answer",
      completedAt: at,
    },
  ],
  latestTurn: null,
  queuedTurns: [{ text: "Do not execute on import" }],
  session: { nativeThreadId: "private-source-session" },
  excludedCategories: [],
});

it.effect(
  "imports complete shared history without runnable work or source checkpoint handles",
  () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("imported");
      const events = sharedSnapshotEvents({
        snapshot,
        threadId,
        projectId: ProjectId.make("target"),
        title: "Imported: Shared work",
        branch: "shared/work",
        cwd: "/tmp/shared-work",
        now: DateTime.makeUnsafe(at),
      });
      for (const event of events) assert.isTrue(Schema.is(OrchestrationV2DomainEvent)(event));
      yield* sink.write({ events });
      const projection = yield* projections.getThreadProjection(threadId);
      assert.strictEqual(projection.thread.interactionMode, "workflow");
      assert.strictEqual(projection.thread.historyOrigin, "v1_import");
      assert.deepEqual(
        projection.messages.map((message) => message.text),
        ["Review clip", "Reviewed"],
      );
      assert.strictEqual(projection.messages[0]?.attachments[0]?.type, "video");
      assert.strictEqual(projection.plans[0]?.kind, "proposed_plan");
      assert.strictEqual(projection.checkpoints[0]?.status, "missing");
      assert.notEqual(projection.checkpoints[0]?.ref, "refs/source-only");
      assert.strictEqual(
        projection.visibleTurnItems.filter(({ item }) => item.type === "kami_activity").length,
        1,
      );
      assert.deepEqual(projection.runs, []);
      assert.deepEqual(projection.providerThreads, []);
      assert.deepEqual(projection.runtimeRequests, []);
    }).pipe(Effect.provide(testLayer)),
);
