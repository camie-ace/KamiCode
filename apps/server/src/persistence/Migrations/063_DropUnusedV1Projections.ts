import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Remove unused copies while retaining KamiCode activities for lazy transcript import.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // KamiCode imports workflow and test evidence from projection_thread_activities.
  yield* sql`DROP TABLE IF EXISTS projection_turns`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_proposed_plans`;
  yield* sql`DROP TABLE IF EXISTS projection_pending_approvals`;
  yield* sql`DROP TABLE IF EXISTS projection_state`;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
});
