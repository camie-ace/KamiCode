# KamiCode Collaboration Server

Standalone hosted control plane for shared projects. Local KamiCode runtimes keep executing work on each developer machine, while this service stores the shared project state in Postgres.

## What It Owns

- Shared projects
- Members and roles
- GitHub-bound invite codes
- Shared threads and continuation messages
- Runtime registry
- Project environments and deploy associations
- Shared artifacts

## Local Development

```sh
cp apps/collab-server/.env.example apps/collab-server/.env
pnpm install
pnpm --filter @t3tools/collab-server dev
```

The service runs migrations on startup when `KAMICODE_COLLAB_RUN_MIGRATIONS=1`.

## Deployment Shape

The simplest SSH deployment is:

1. Provision Postgres.
2. Build this package with `pnpm --filter @t3tools/collab-server build`.
3. Copy `apps/collab-server/dist`, `package.json`, and production `node_modules` to the server.
4. Set the environment variables from `.env.example`.
5. Run `node dist/index.mjs` under systemd.

There is also a sample unit at `deploy/kamicode-collab.service`.

## Authentication Contract

This MVP expects local KamiCode to authenticate to the hosted backend with:

- `Authorization: Bearer $KAMICODE_COLLAB_SERVER_TOKEN`
- `x-kamicode-user-id`
- `x-kamicode-github-id`
- `x-kamicode-github-login`
- optional `x-kamicode-display-name`
- optional `x-kamicode-avatar-url`

That keeps Postgres private behind the API. A future pass can replace these headers with hosted GitHub OAuth/JWT verification without exposing database access to desktop clients.
