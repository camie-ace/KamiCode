import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE shared_threads
    ADD COLUMN share_code TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE shared_threads
    ADD COLUMN allowed_github_logins_json TEXT NOT NULL DEFAULT '[]'
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS shared_threads_share_code_idx
    ON shared_threads(share_code)
    WHERE share_code IS NOT NULL
  `;
});
