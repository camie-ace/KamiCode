import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Heal migration paired with [039_ReapplyAuthSessionTables].
 *
 * Upstream's `032_AuthPairingProofKeyThumbprint` adds the `proof_key_thumbprint`
 * column to `auth_pairing_links`. Like 031 it was skipped on existing KamiCode
 * installs because id 32 was already recorded (pre-merge `032_UserAuth`).
 * Re-applied here as an append-only id, after 039 has recreated the table.
 *
 * Frozen copy of 032; PRAGMA-guarded so it is a no-op when the column exists.
 */
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
