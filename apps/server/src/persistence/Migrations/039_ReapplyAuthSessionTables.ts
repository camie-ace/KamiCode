import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Heal migration for the KamiCode <- T3 Code upstream merge.
 *
 * Upstream's `031_AuthAuthorizationScopes` rebuilds `auth_pairing_links` and
 * `auth_sessions` into the shape EnvironmentAuth/SessionStore/PairingGrantStore
 * require. During the merge it was slotted at id 31, but existing KamiCode
 * installs had already recorded id 31 (the pre-merge
 * `031_ProjectionProjectTestEnvironments`) as applied. The migrator only runs
 * ids greater than the latest recorded id, so 031 (and 032) silently never ran
 * on those databases, leaving `auth_sessions` in its old pre-031 shape and
 * `auth_pairing_links` absent. Credential issue/consume then failed with
 * "Failed to prepare statement" -> 500 on browserSession bootstrap (the pairing
 * wall). See also [040_ReapplyAuthPairingProofKeyThumbprint].
 *
 * This re-applies 031's schema as an append-only id so every database
 * (fresh, partially-migrated, or already-broken) converges to the correct
 * shape. The body is a frozen copy of 031 and must not be edited if 031 later
 * changes upstream.
 *
 * Migrations are append-only and immutable: never reuse or reorder an id that a
 * released build has already applied.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS auth_pairing_links`;
  yield* sql`DROP TABLE IF EXISTS auth_sessions`;

  yield* sql`
    CREATE TABLE auth_pairing_links (
      id TEXT PRIMARY KEY,
      credential TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      scopes TEXT NOT NULL,
      subject TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX idx_auth_pairing_links_active
    ON auth_pairing_links(revoked_at, consumed_at, expires_at)
  `;

  yield* sql`
    CREATE TABLE auth_sessions (
      session_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      scopes TEXT NOT NULL,
      method TEXT NOT NULL,
      client_label TEXT,
      client_ip_address TEXT,
      client_user_agent TEXT,
      client_device_type TEXT NOT NULL DEFAULT 'unknown',
      client_os TEXT,
      client_browser TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_connected_at TEXT,
      revoked_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX idx_auth_sessions_active
    ON auth_sessions(revoked_at, expires_at, issued_at)
  `;
});
