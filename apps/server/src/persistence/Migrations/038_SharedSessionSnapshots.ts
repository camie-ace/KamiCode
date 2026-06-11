import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(shared_threads)
  `;
  if (!threadColumns.some((column) => column.name === "session_snapshot_json")) {
    yield* sql`
      ALTER TABLE shared_threads
      ADD COLUMN session_snapshot_json TEXT
    `;
  }
});
