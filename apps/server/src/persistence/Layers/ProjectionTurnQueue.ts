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
  CancelProjectionTurnQueueForThreadInput,
  CompleteProjectionTurnQueueForThreadInput,
  MarkProjectionTurnQueueDispatchingInput,
  MarkProjectionTurnQueueCancelledInput,
  MarkProjectionTurnQueueFailedInput,
  MarkProjectionTurnQueueStartedInput,
  ProjectionTurnQueueIdInput,
  ProjectionTurnQueueIdentityInput,
  ProjectionTurnQueueRepository,
  ProjectionTurnQueueRow,
  RecoverProjectionTurnQueueInput,
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
const ThreadIdRow = Schema.Struct({
  threadId: ProjectionTurnQueueRow.fields.threadId,
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

  const getByQueueIdRow = SqlSchema.findOneOption({
    Request: ProjectionTurnQueueIdInput,
    Result: ProjectionTurnQueueDbRow,
    execute: ({ queueId }) =>
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
        WHERE queue_id = ${queueId}
        LIMIT 1
      `,
  });

  const isQueuedRow = SqlSchema.findOneOption({
    Request: ProjectionTurnQueueIdentityInput,
    Result: QueueIdRow,
    execute: ({ queueId, messageId }) =>
      sql`
        SELECT queue_id AS "queueId"
        FROM projection_turn_queue
        WHERE queue_id = ${queueId}
          AND message_id = ${messageId}
          AND status = 'queued'
        LIMIT 1
      `,
  });

  const markDispatchingRow = SqlSchema.findOneOption({
    Request: MarkProjectionTurnQueueDispatchingInput,
    Result: QueueIdRow,
    execute: ({ queueId, startedAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'dispatching',
            started_at = ${startedAt},
            completed_at = NULL,
            turn_id = NULL,
            failure_detail = NULL
        WHERE queue_id = ${queueId}
          AND status IN ('queued', 'dispatching')
        RETURNING queue_id AS "queueId"
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
          AND status IN ('dispatching', 'started')
        RETURNING queue_id AS "queueId"
      `,
  });

  const markFailedRow = SqlSchema.findOneOption({
    Request: MarkProjectionTurnQueueFailedInput,
    Result: QueueIdRow,
    execute: ({ queueId, failedAt, failureDetail }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'failed',
            completed_at = ${failedAt},
            failure_detail = ${failureDetail}
        WHERE queue_id = ${queueId}
          AND status IN ('dispatching', 'failed')
        RETURNING queue_id AS "queueId"
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
          AND status IN ('queued', 'cancelled')
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
        FROM projection_turn_queue queue
        WHERE thread_id = ${threadId}
          AND status IN ('queued', 'dispatching')
        ORDER BY COALESCE(
          (SELECT sequence FROM orchestration_events WHERE event_id = queue.event_id),
          9223372036854775807
        ) ASC, queue_id ASC
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

  const listQueuedThreadIdRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadIdRow,
    execute: () =>
      sql`
        SELECT queue.thread_id AS "threadId"
        FROM projection_turn_queue queue
        JOIN projection_threads thread ON thread.thread_id = queue.thread_id
        WHERE queue.status = 'queued'
          AND thread.deleted_at IS NULL
          AND thread.archived_at IS NULL
        GROUP BY queue.thread_id
        ORDER BY MIN(COALESCE(
          (SELECT sequence FROM orchestration_events WHERE event_id = queue.event_id),
          9223372036854775807
        )) ASC, queue.thread_id ASC
      `,
  });

  const completeStartedRows = SqlSchema.void({
    Request: CompleteProjectionTurnQueueForThreadInput,
    execute: ({ threadId, completedAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'completed',
            completed_at = ${completedAt},
            failure_detail = NULL
        WHERE thread_id = ${threadId}
          AND status = 'started'
      `,
  });

  const cancelActiveRows = SqlSchema.void({
    Request: CancelProjectionTurnQueueForThreadInput,
    execute: ({ threadId, cancelledAt }) =>
      sql`
        UPDATE projection_turn_queue
        SET status = 'cancelled',
            completed_at = ${cancelledAt}
        WHERE thread_id = ${threadId}
          AND status IN ('queued', 'dispatching')
      `,
  });

  const recoverAbandonedRows = Effect.fn("ProjectionTurnQueueRepository.recoverAbandonedRows")(
    function* ({ recoveredAt, staleBefore }: RecoverProjectionTurnQueueInput) {
      yield* sql`
        UPDATE projection_turn_queue
        SET status = 'cancelled',
            completed_at = ${recoveredAt}
        WHERE status IN ('queued', 'dispatching')
          AND (
            requested_at < ${staleBefore}
            OR thread_id IN (
              SELECT thread_id
              FROM projection_threads
              WHERE deleted_at IS NOT NULL OR archived_at IS NOT NULL
            )
          )
      `;

      yield* sql`
        UPDATE projection_turn_queue AS queue
        SET status = 'started',
            turn_id = (
              SELECT session.active_turn_id
              FROM projection_thread_sessions session
              WHERE session.thread_id = queue.thread_id
              LIMIT 1
            ),
            failure_detail = NULL
        WHERE queue.status = 'dispatching'
          AND EXISTS (
            SELECT 1
            FROM projection_thread_sessions session
            WHERE session.thread_id = queue.thread_id
              AND session.status = 'running'
              AND session.active_turn_id IS NOT NULL
          )
      `;

      yield* sql`
        UPDATE projection_turn_queue
        SET status = 'queued',
            started_at = NULL,
            completed_at = NULL,
            turn_id = NULL,
            failure_detail = NULL
        WHERE status = 'dispatching'
      `;

      yield* sql`
        UPDATE projection_turn_queue AS queue
        SET status = 'completed',
            completed_at = ${recoveredAt},
            failure_detail = NULL
        WHERE queue.status = 'started'
          AND NOT EXISTS (
            SELECT 1
            FROM projection_thread_sessions session
            WHERE session.thread_id = queue.thread_id
              AND session.status = 'running'
              AND session.active_turn_id = queue.turn_id
          )
      `;
    },
  );

  const upsert: ProjectionTurnQueueRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.upsert:query")),
    );

  const getByQueueId: ProjectionTurnQueueRepositoryShape["getByQueueId"] = (input) =>
    getByQueueIdRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.getByQueueId:query")),
      Effect.map(Option.map((row) => row as ProjectionTurnQueueRow)),
    );

  const isQueued: ProjectionTurnQueueRepositoryShape["isQueued"] = (input) =>
    isQueuedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.isQueued:query")),
      Effect.map(Option.isSome),
    );

  const markDispatching: ProjectionTurnQueueRepositoryShape["markDispatching"] = (input) =>
    markDispatchingRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markDispatching:query")),
      Effect.map(Option.isSome),
    );

  const markStarted: ProjectionTurnQueueRepositoryShape["markStarted"] = (input) =>
    markStartedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markStarted:query")),
      Effect.map(Option.isSome),
    );

  const markFailed: ProjectionTurnQueueRepositoryShape["markFailed"] = (input) =>
    markFailedRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnQueueRepository.markFailed:query")),
      Effect.map(Option.isSome),
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

  const listQueuedThreadIds: ProjectionTurnQueueRepositoryShape["listQueuedThreadIds"] =
    listQueuedThreadIdRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnQueueRepository.listQueuedThreadIds:query"),
      ),
      Effect.map((rows) => rows.map((row) => row.threadId)),
    );

  const completeStartedByThreadId: ProjectionTurnQueueRepositoryShape["completeStartedByThreadId"] =
    (input) =>
      completeStartedRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnQueueRepository.completeStartedByThreadId:query"),
        ),
      );

  const cancelActiveByThreadId: ProjectionTurnQueueRepositoryShape["cancelActiveByThreadId"] = (
    input,
  ) =>
    cancelActiveRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnQueueRepository.cancelActiveByThreadId:query"),
      ),
    );

  const recoverAbandoned: ProjectionTurnQueueRepositoryShape["recoverAbandoned"] = (input) =>
    recoverAbandonedRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionTurnQueueRepository.recoverAbandoned:query"),
      ),
    );

  return {
    upsert,
    getByQueueId,
    isQueued,
    markDispatching,
    markStarted,
    markFailed,
    markCancelled,
    listActiveByThreadId,
    countQueuedByThreadId,
    listQueuedThreadIds,
    completeStartedByThreadId,
    cancelActiveByThreadId,
    recoverAbandoned,
  } satisfies ProjectionTurnQueueRepositoryShape;
});

export const ProjectionTurnQueueRepositoryLive = Layer.effect(
  ProjectionTurnQueueRepository,
  makeProjectionTurnQueueRepository,
);
