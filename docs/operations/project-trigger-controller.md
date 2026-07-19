# Project Trigger Controller API

This API is for a headless controller running beside KamiCode, including a
loopback-only controller on the same VPS. It does not accept a browser cookie as
a controller identity. Every run operation requires both:

1. a bearer token whose only required scope is `project-trigger:run`; and
2. the per-trigger HMAC secret returned by an explicit secret rotation.

Keep the bearer token and HMAC secret in the controller's secret store. Do not
put either value in a URL, request body, process argument, log, or project
trigger event payload.

Use this controller-side environment contract. These variables are consumed by
the controller deployment, not by the KamiCode server itself:

```sh
KAMICODE_TRIGGER_API_ORIGIN=http://127.0.0.1:3773
KAMICODE_TRIGGER_BEARER_TOKEN=<opaque project-trigger:run token>
KAMICODE_TRIGGER_ID=<stable administrative trigger id>
KAMICODE_TRIGGER_PUBLIC_ID=<public id returned by rotation>
KAMICODE_TRIGGER_ENDPOINT_PATH=/api/project-triggers/webhook/<public id>
KAMICODE_TRIGGER_HMAC_SECRET=<base64url secret returned by rotation>
KAMICODE_TRIGGER_HMAC_SECRET_VERSION=<positive integer returned by rotation>
```

Load the bearer token and HMAC secret through a root- or service-user-readable
secret file rather than putting them in a systemd unit's public command line.
The `PUBLIC_ID`, endpoint path, and secret version are identifiers, not
substitutes for the two credentials.

## 1. Issue the controller bearer token

Run this on the KamiCode host, using the same `--base-dir` as the server:

```sh
t3 auth session issue \
  --base-dir /var/lib/kamicode \
  --project-trigger-only \
  --subject project-trigger-controller \
  --label project-trigger-controller \
  --ttl 30d \
  --token-only
```

The command prints the opaque token once. The resulting identity has only
`project-trigger:run`; it does not grant terminal, filesystem, general
orchestration, relay, or access-administration permissions. Rotate it on the
same schedule as other service credentials. Use `t3 auth session list --json`
to find its session id and `t3 auth session revoke <session-id>` to revoke it.

## 2. Bootstrap or rotate one trigger's HMAC secret

The rotation endpoint is intentionally administrative. Issue a short-lived
administrative token, rotate the trigger secret, then revoke the temporary
session:

```sh
ADMIN_JSON="$(t3 auth session issue \
  --base-dir /var/lib/kamicode \
  --subject project-trigger-bootstrap \
  --label project-trigger-bootstrap \
  --ttl 10m \
  --json)"
ADMIN_TOKEN="$(printf '%s' "$ADMIN_JSON" | jq -r .token)"
ADMIN_SESSION_ID="$(printf '%s' "$ADMIN_JSON" | jq -r .sessionId)"

curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3773/api/project-triggers/TRIGGER_ID/webhook/secret/rotate

t3 auth session revoke --base-dir /var/lib/kamicode "$ADMIN_SESSION_ID"
```

`TRIGGER_ID` is the stable `id` on the project trigger record. The response is
shown only once and has this shape:

```json
{
  "credentials": {
    "triggerId": "...",
    "publicId": "...",
    "endpointPath": "/api/project-triggers/webhook/...",
    "secret": "<base64url raw HMAC key>",
    "secretVersion": 1,
    "algorithm": "hmac-sha256",
    "signatureHeader": "x-kamicode-signature",
    "timestampHeader": "x-kamicode-timestamp",
    "nonceHeader": "x-kamicode-nonce",
    "idempotencyHeader": "idempotency-key"
  }
}
```

Decode `secret` from unpadded base64url before using it as the HMAC key. A
rotation immediately invalidates the prior per-trigger secret. KamiCode stores
only the public id and rotation version in SQLite; key material is derived from
the server secret store and is never written to the trigger tables.

## 3. Sign a request

Sign the exact UTF-8 request body bytes. Do not reformat JSON after signing.
Construct these seven fields and join them with one LF byte (`0x0a`). There is
no trailing LF after the raw body unless it is part of the body itself:

```text
v1
TIMESTAMP
NONCE
IDEMPOTENCY_KEY
UPPERCASE_METHOD
PATH_WITHOUT_QUERY
RAW_BODY
```

Compute `HMAC-SHA256(decoded_secret, canonical_string)`, encode the digest as
unpadded base64url, and send `x-kamicode-signature: v1=<digest>`.

- `x-kamicode-timestamp`: Unix time in 10-digit seconds or 13-digit
  milliseconds; accepted clock skew is 5 minutes.
- `x-kamicode-nonce`: a fresh 16-128 character value matching
  `[A-Za-z0-9._:-]+`.
- `idempotency-key`: a stable delivery key, at most 200 characters. Reuse the
  key only when retrying the identical operation body.
- `Authorization`: `Bearer <controller token>`.

For example, the start body may be:

```json
{
  "eventKind": "webhook",
  "occurredAt": "2026-07-19T19:00:00.000Z",
  "payload": { "controllerRunId": "cycle-01J...", "source": "jira", "eventId": "10042" }
}
```

The server bounds bodies at 64 KiB, redacts credential-shaped keys and values,
and appends the result to the agent prompt as explicitly untrusted context.

## 4. API paths and responses

All paths below are relative to the KamiCode server origin. `PUBLIC_ID` and the
base `endpointPath` come from the one-time rotation response.

| Operation | Method and path                                                   | Signed body                        | Success                                                          |
| --------- | ----------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Start     | `POST /api/project-triggers/webhook/PUBLIC_ID`                    | Event JSON                         | `202` for a new run; `200` for the identical idempotent replay   |
| Status    | `GET /api/project-triggers/webhook/PUBLIC_ID/runs/RUN_ID`         | Empty string                       | `200`                                                            |
| Cancel    | `POST /api/project-triggers/webhook/PUBLIC_ID/runs/RUN_ID/cancel` | Empty string or `{"reason":"..."}` | `200`; terminal runs remain terminal                             |
| Retry     | `POST /api/project-triggers/webhook/PUBLIC_ID/runs/RUN_ID/retry`  | Empty string or `{}`               | `202` for a new retry; `200` for the identical idempotent replay |

The exact JSON payloads used by the 24HR controller are:

```text
start:  {"eventKind":"webhook","occurredAt":"<ISO-8601 UTC>","payload":{"controllerRunId":"<controller run id>","source":"jira|github|deploy","eventId":"<source delivery id>"}}
status: <zero bytes>
cancel: {"reason":"<safe operator or policy reason>"}
retry:  {}
```

All three start fields are optional at the schema level, but the controller
should send them for durable correlation. `payload` is JSON and is redacted
before prompting. Sign the exact compact bytes shown by the controller; a
pretty-printed body has a different signature. Status must be signed with an
empty body. Empty cancel and retry bodies are also accepted, but the examples
above are the preferred operational form.

Start, status, cancel, and retry responses include:

```json
{
  "run": {
    "id": "...",
    "status": "queued",
    "threadId": "...",
    "failureReason": null,
    "cancellationReason": null,
    "retryOfRunId": null
  },
  "correlation": {
    "runId": "...",
    "threadId": "...",
    "threadPath": "/threads/ENVIRONMENT_ID/THREAD_ID",
    "statusPath": "/api/project-triggers/webhook/PUBLIC_ID/runs/RUN_ID"
  },
  "idempotentReplay": false
}
```

Run status is authoritative: `succeeded` is recorded only after the actual
thread turn completes. Provider/turn errors become `failed`; explicit stops or
interruptions become `cancelled`. Dispatch acceptance alone leaves the run in
`starting`. A retry creates a new run and thread and sets `retryOfRunId` to the
source run.

Webhook request receipts retain nonce and idempotency protection for 24 hours.
The current per-trigger limit is 30 signed requests per minute; `429` includes a
`Retry-After` header. Other important responses are `401` for bad auth/signature
or stale headers, `403` for a token without the required scope, `409` for nonce
replay/idempotency conflicts or retrying an active run, and `413` for an
oversized body.

Bind the service to loopback when the controller is colocated. If requests must
cross a host boundary, terminate TLS in a trusted proxy and keep both the
bearer token and HMAC requirement; HMAC is not a replacement for transport
confidentiality.

## 5. Preserve native connector ownership

A trigger must be created on the `24HR Development Cycle` KamiCode project with
the same Codex provider instance that owns the installed GitHub and Jira
connected apps. Dispatch preserves the trigger's `projectId`, complete
`modelSelection` (including `instanceId`), runtime mode, interaction mode, and
thread bootstrap settings on the new thread. Provider sessions are routed by
that exact instance id, and the normal project-session bootstrap supplies the
project cwd and its project-memory snapshot.

This is the permanent native-connector path:

```text
controller event -> signed KamiCode start -> triggered Codex session
  -> installed GitHub/Jira connected apps -> signed controller receipt
```

Do not add GitHub or Jira OAuth tokens to the trigger service, webhook body,
agent prompt, or trigger tables. The triggered session uses the connected apps
already installed and authenticated in its selected provider profile. Selecting
a different provider instance can select a different account/profile and must
be treated as an operational configuration change.

The controller's receipt broker is a separate outbound trust boundary at
`http://127.0.0.1:8790`. Configure its receipt credentials as sensitive
environment values on the selected Codex provider instance (or in a trusted
receipt helper invoked by that instance):

```sh
DEV_CYCLE_CONTROLLER_ORIGIN=http://127.0.0.1:8790
DEV_CYCLE_RECEIPT_BEARER_TOKEN=<controller-issued receipt-only token>
DEV_CYCLE_RECEIPT_HMAC_SECRET=<controller-issued receipt signing key>
DEV_CYCLE_EVIDENCE_RECEIPT_PATH=<controller-supplied evidence path>
DEV_CYCLE_ACTION_RECEIPT_PATH=<controller-supplied action path>
```

The controller owns the authoritative evidence/action receipt schemas and
paths; KamiCode deliberately does not hard-code them. Use a separate receipt
bearer/HMAC pair—never reuse `KAMICODE_TRIGGER_BEARER_TOKEN` or
`KAMICODE_TRIGGER_HMAC_SECRET`. A control-plane helper should read the outbound
values without printing them, sign the exact receipt bytes, and post only to
the loopback origin. The controller must verify the receipt signature, bind the
controller run id to the KamiCode `runId`/`threadId`, and independently verify
GitHub, CI, merge, and deployment claims before allowing side effects.

## 6. Rollout checklist

Migration `045_ProjectTriggerRuntime` runs during the next server startup and
rebuilds the project-trigger run table. Treat it as a forward-only schema
change: stop the old server, back up the server base directory/SQLite database,
deploy the new server and CLI together, and allow only that version to open the
database. Existing legacy `dispatched` rows migrate to `starting`, not
`succeeded`, so startup reconciliation can determine their real outcome.

Keep the same server `--base-dir` and secret store across the rollout. The
per-trigger HMAC key is derived from the server master secret; replacing or
losing that master secret invalidates controller credentials and requires a
fresh rotation. After the server is healthy:

1. issue the controller-only bearer token;
2. rotate the target trigger's HMAC secret with a temporary administrator;
3. store the returned values in the controller secret store and revoke the
   temporary administrator; and
4. smoke-test signed start and status calls, followed by cancel and retry on a
   disposable run.

Do not enable controller side effects until the returned `runId`, `threadId`,
thread deep link, and terminal state all correlate with the controller's own
run record.
