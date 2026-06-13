import { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  MarkProjectionTurnQueueCancelledInput,
  MarkProjectionTurnQueueFailedInput,
  MarkProjectionTurnQueueStartedInput,
  ProjectionTurnQueueRepository,
  ProjectionTurnQueueRow,
  ThreadQueueInput,
  UpsertProjectionTurnQueueInput,
  type ProjectionTurnQueueRepositoryShape,
} from "../Services/ProjectionTurnQueue.ts";

const ProjectionTurnQueueDbRow = ProjectionTurnQueueRow.mapFields(
  Struct.assign({
    modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
  }),
);

const CountRow = Schema.Struct({
  count: Schema.Number,
});
const QueueIdRow = Schema.Struct({
  queueId: ProjectionTurnQueueRow.fields.queueId,
});

const makeProjectionTurnQueueRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: UpsertProjectionTurnQueueInput,
    execute: (row) =>
      sql`
        INSERT INTO projection_turn_queue (
          queue_id,
          thread_id,
          event_id,
          command_id,
          message_id,
          status,
          requested_at,
          started_at,
          completed_at,
          turn_id,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          title_seed,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          failure_detail
        )
        VALUES (
          ${row.queueId},
          ${row.threadId},
          ${row.eventId},
          ${row.commandId},
          ${row.messageId},
          ${row.status},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.turnId},
          ${row.modelSelection === null ? null : JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.titleSeed},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.failureDetail}
        )
        ON CONFLICT (event_id)
        DO NOTHING
      `,
  });

  const claimNextQueued = SqlSchema.findOneOption({
    Request: Schema.Struct({
      threadId: ThreadQueueInput.fields.threadId,
      claimedAt: ProjectionTurnQueueRow.fields.startedAt,
    }),
    Result: ProjectionTurnQueueDbRow,
    execute: ({ threadId, claimedAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'dispatching',
            started_at = ${claimedAt}
        WHERE queue_id = (
          SELECT queue_id
          FROM projection_turn_queue
          WHERE thread_id = ${threadId}
            AND status = 'queued'
          ORDER BY requested_at ASC, queue_id ASC
          LIMIT 1
        )
          AND status = 'queued'
        RETURNING
          queue_id AS "queueId",
          thread_id AS "threadId",
          event_id AS "eventId",
          command_id AS "commandId",
          message_id AS "messageId",
          status,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          turn_id AS "turnId",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          title_seed AS "titleSeed",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          failure_detail AS "failureDetail"
      `,
  });

  const markStartedRow = SqlSchema.findOneOption({
    Request: MarkProjectionTurnQueueStartedInput,
    Result: QueueIdRow,
    execute: ({ queueId, turnId, startedAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'started',
            turn_id = ${turnId},
            started_at = ${startedAt},
            completed_at = NULL,
            failure_detail = NULL
        WHERE queue_id = ${queueId}
          AND status = 'dispatching'
        RETURNING queue_id AS "queueId"
      `,
  });

  const markFailedRow = SqlSchema.void({
    Request: MarkProjectionTurnQueueFailedInput,
    execute: ({ queueId, failedAt, failureDetail }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'failed',
            completed_at = ${failedAt},
            failure_detail = ${failureDetail}
        WHERE queue_id = ${queueId}
          AND status = 'dispatching'
      `,
  });

  const markCancelledRow = SqlSchema.findOneOption({
    Request: MarkProjectionTurnQueueCancelledInput,
    Result: QueueIdRow,
    execute: ({ queueId, cancelledAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'cancelled',
            completed_at = ${cancelledAt}
        WHERE queue_id = ${queueId}
          AND status IN ('queued', 'dispatching')
        RETURNING queue_id AS "queueId"
      `,
  });

  const listActiveRows = SqlSchema.findAll({
    Request: ThreadQueueInput,
    Result: ProjectionTurnQueueDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          queue_id AS "queueId",
          thread_id AS "threadId",
          event_id AS "eventId",
          command_id AS "commandId",
          message_id AS "messageId",
          status,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          turn_id AS "turnId",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          title_seed AS "titleSeed",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          failure_detail AS "failureDetail"
        FROM projection_turn_queue
        WHERE thread_id = ${threadId}
          AND status IN ('queued', 'dispatching')
        ORDER BY requested_at ASC, queue_id ASC
      `,
  });

  const countQueuedRows = SqlSchema.findOne({
    Request: ThreadQueueInput,
    Result: CountRow,
    execute: ({ threadId }) =>
      sql`
        SELECT COUNT(*) AS count
        FROM projection_turn_queue
        WHERE thread_id = ${threadId}
          AND status = 'queued'
      `,
  });

  const upsert: ProjectionTurnQueueRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.upsert:query")),
    );

  const claimNextQueuedByThreadId: ProjectionTurnQueueRepositoryShape["claimNextQueuedByThreadId"] =
    (input, claimedAt) =>
      claimNextQueued({ ...input, claimedAt }).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnQueueRepository.claimNextQueuedByThreadId:query"),
        ),
        Effect.map(Option.map((row) => row as ProjectionTurnQueueRow)),
      );

  const markStarted: ProjectionTurnQueueRepositoryShape["markStarted"] = (input) =>
    markStartedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markStarted:query")),
      Effect.map(Option.isSome),
    );

  const markFailed: ProjectionTurnQueueRepositoryShape["markFailed"] = (input) =>
    markFailedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markFailed:query")),
    );

  const markCancelled: ProjectionTurnQueueRepositoryShape["markCancelled"] = (input) =>
    markCancelledRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markCancelled:query")),
      Effect.map(Option.isSome),
    );

  const listActiveByThreadId: ProjectionTurnQueueRepositoryShape["listActiveByThreadId"] = (
    input,
  ) =>
    listActiveRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnQueueRepository.listActiveByThreadId:query"),
      ),
      Effect.map((rows) => rows as ReadonlyArray<ProjectionTurnQueueRow>),
    );

  const countQueuedByThreadId: ProjectionTurnQueueRepositoryShape["countQueuedByThreadId"] = (
    input,
  ) =>
    countQueuedRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnQueueRepository.countQueuedByThreadId:query"),
      ),
      Effect.map((row) => row.count),
    );

  return {
    upsert,
    claimNextQueuedByThreadId,
    markStarted,
    markFailed,
    markCancelled,
    listActiveByThreadId,
    countQueuedByThreadId,
  } satisfies ProjectionTurnQueueRepositoryShape;
});

export const ProjectionTurnQueueRepositoryLive = Layer.effect(
  ProjectionTurnQueueRepository,
  makeProjectionTurnQueueRepository,
);
