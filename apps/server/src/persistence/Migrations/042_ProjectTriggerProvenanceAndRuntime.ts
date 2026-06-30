import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN started_by_json TEXT
  `;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN description TEXT
  `;

  yield* sql`
    ALTER TABLE project_triggers
    ADD COLUMN runtime_target TEXT NOT NULL DEFAULT 'local'
    CHECK (runtime_target IN ('local', 'remote'))
  `;
});
