import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Reapply the skipped proof-key column after migration 039; keep this frozen schema append-only. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const pairingLinkColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_pairing_links)
  `;
  if (!pairingLinkColumns.some((column) => column.name === "proof_key_thumbprint")) {
    yield* sql`
      ALTER TABLE auth_pairing_links
      ADD COLUMN proof_key_thumbprint TEXT
    `;
  }
});
