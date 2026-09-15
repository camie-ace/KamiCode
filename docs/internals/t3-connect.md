# T3 Connect

> For maintainers. Using T3 Code? See [docs/user](../user/).

T3 Connect uses one Clerk application for web, desktop, and mobile authentication. The relay verifies
two kinds of bearer credential: template JWTs generated from the `t3-relay` template with the shared
`t3-code-relay` audience, and Clerk OAuth tokens issued to the CLI. `verifyRelayClientBearerToken` in
`infra/relay/src/http/Api.ts` tries the template/session path first and falls back to OAuth
verification (`acceptsToken: "oauth_token"`), so the CLI's OAuth credential works without a JWT
template.

For the wider system diagram, see
[t3-code-connect-auth-flow.html](./t3-code-connect-auth-flow.html).

## Application Keys

T3 Connect is disabled in a fresh clone. To enable it for source builds against the production
deployment, copy the repository-root example file:

```sh
cp .env.example .env
```

`.env.example` carries the production public identifiers (the same values baked into official
release builds). To target a different Clerk application or relay, set the values yourself in a
repository-root `.env` or `.env.local` file:

```dotenv
T3CODE_CLERK_PUBLISHABLE_KEY=<publishable key>
T3CODE_CLERK_JWT_TEMPLATE=<JWT template name>
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth application client ID>
T3CODE_RELAY_URL=https://relay.example.com
```

The shared client loader projects these canonical values into framework-specific `VITE_*` and
`EXPO_PUBLIC_*` aliases. Existing aliases remain accepted as overrides for compatibility, but new
client configuration should use the canonical names.

Configuration precedence is:

1. Process or CI environment variables.
2. Repository-root `.env.local`.
3. Repository-root `.env`.

The Clerk publishable key, JWT template name, CLI OAuth client ID, and relay URL are public
identifiers, not secrets.
Web, desktop, mobile, and bundled server builds statically inject the values they consume during
their build step. A built artifact does not need an environment file at runtime. CI release builds
should set `T3CODE_CLERK_PUBLISHABLE_KEY`, `T3CODE_CLERK_JWT_TEMPLATE`,
`T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`, and `T3CODE_RELAY_URL` before building. EAS preview and
production builds only need the Clerk publishable key, JWT template name, and relay URL in their EAS
environment.

When any client-facing public value is absent, cloud UI is omitted. The `t3 connect` command group is
always registered: when the CLI public values are absent, `makeCli` in `apps/server/src/bin.ts`
registers a hidden fallback `connect` command that reports the missing configuration instead of
silently vanishing from help. The bundled server still accepts runtime overrides for self-hosted or
operator-managed deployments.

For a hosted relay deployment, copy `infra/relay/.env.example` to `infra/relay/.env`. The relay
deployment reads `RELAY_DOMAIN`, `RELAY_API_ZONE_NAME`, `RELAY_TUNNEL_ZONE_NAME`,
`CLERK_PUBLISHABLE_KEY`, and `CLERK_JWT_AUDIENCE` through Effect `Config`. There are no checked-in
deployment defaults.
`vp run --filter t3code-relay deploy` invokes Alchemy from the relay directory, so Alchemy loads
`infra/relay/.env`. After a successful deployment, the wrapper updates the repository-root `.env`
with the deployed HTTPS relay URL. The relay still requires
`CLERK_SECRET_KEY` as an Alchemy secret. Never put `CLERK_SECRET_KEY` in a client application
environment or commit it to the repository.

Loopback CLI authorization starts on the hosted `/connect` page so sign-in
completes before entering Clerk's authorize endpoint. Sending a signed-out
browser straight to that endpoint loses the authorize parameters during the
sign-in redirect. The [shared flow](../../packages/shared/src/connectAuth.ts)
preserves PKCE and state for the loopback callback.

SSH and headless sessions use Clerk's OAuth device authorization grant because
the browser cannot ordinarily reach a listener on the remote machine. The CLI
polls Clerk's token endpoint directly while the user approves a short code on
Clerk's hosted device page; the hosted app plays no part and there is no
redirect URI or PKCE. The grant must be enabled on the CLI OAuth application
or the device endpoint returns an error before any prompt is shown.
