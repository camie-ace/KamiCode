import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0039 from "./039_ReapplyAuthSessionTables.ts";
import Migration0040 from "./040_ReapplyAuthPairingProofKeyThumbprint.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_ReapplyAuthSessionTables", (it) => {
  // Reproduces the upstream-merge breakage: an existing KamiCode database is
  // stuck on the pre-031 (role-based) auth shape because ids 31/32 were already
  // recorded as applied (pre-merge migrations), so the migrator skipped
  // upstream's auth-table rebuild. The 039/040 heal must converge it.
  it.effect("heals a database stuck on the pre-031 role-based auth shape", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Migrations 020-022 install the old role-based auth tables.
      yield* runMigrations({ toMigrationInclusive: 30 });

      yield* sql`
        INSERT INTO auth_pairing_links (
          id, credential, method, role, subject, created_at, expires_at
        ) VALUES (
          'link-owner', 'bootstrap-owner', 'desktop-bootstrap', 'owner', 'desktop',
          '2026-05-29T00:00:00.000Z', '2026-05-29T01:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO auth_sessions (
          session_id, subject, role, method, issued_at, expires_at
        ) VALUES (
          'session-owner', 'desktop', 'owner', 'browser-session-cookie',
          '2026-05-29T00:00:00.000Z', '2026-05-29T01:00:00.000Z'
        )
      `;

      // Apply only the heal migrations, simulating a database whose migrator
      // has already passed id 38 (so it never ran 031/032).
      yield* Migration0039;
      yield* Migration0040;

      const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;

      // New scoped shape installed, old role-based shape gone.
      assert.isTrue(pairingColumns.some((column) => column.name === "scopes"));
      assert.isTrue(pairingColumns.some((column) => column.name === "proof_key_thumbprint"));
      assert.isFalse(pairingColumns.some((column) => column.name === "role"));
      assert.isTrue(sessionColumns.some((column) => column.name === "scopes"));
      assert.isFalse(sessionColumns.some((column) => column.name === "role"));

      // Statements the credential layer relies on now prepare and run.
      const pairingRows = yield* sql<{ readonly id: string }>`
        SELECT id FROM auth_pairing_links WHERE proof_key_thumbprint IS NULL
      `;
      const sessionRows = yield* sql<{ readonly sessionId: string }>`
        SELECT session_id AS "sessionId" FROM auth_sessions WHERE scopes IS NOT NULL
      `;
      assert.deepStrictEqual(pairingRows, []);
      assert.deepStrictEqual(sessionRows, []);
    }),
  );

  it.effect("is idempotent when run again", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 30 });

      yield* Migration0039;
      yield* Migration0040;
      // A second pass must not throw (DROP IF EXISTS + PRAGMA-guarded ADD COLUMN).
      yield* Migration0039;
      yield* Migration0040;

      const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      assert.isTrue(pairingColumns.some((column) => column.name === "proof_key_thumbprint"));
    }),
  );

  it.effect("full migration run ends with the scoped auth shape", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Fresh-install path: every migration in order, 31/32 then the 39/40 heal.
      yield* runMigrations();

      const pairingColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.isTrue(pairingColumns.some((column) => column.name === "proof_key_thumbprint"));
      assert.isTrue(pairingColumns.some((column) => column.name === "scopes"));
      assert.isTrue(sessionColumns.some((column) => column.name === "scopes"));
    }),
  );
});
