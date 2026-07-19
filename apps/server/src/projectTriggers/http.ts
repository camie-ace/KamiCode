import {
  AuthAccessWriteScope,
  AuthProjectTriggerRunScope,
  CommandId,
  PROJECT_TRIGGER_WEBHOOK_MAX_BODY_BYTES,
  ProjectTriggerId,
  ProjectTriggerWebhookEventInput,
  TrimmedNonEmptyString,
  type AuthEnvironmentScope,
  type ProjectTriggerWebhookCredentials,
  type ProjectTriggerWebhookRunResult,
} from "@t3tools/contracts";
import { buildAgentAwarenessDeepLink } from "@t3tools/shared/agentAwareness";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { ServerOrchestrationDispatcher } from "../orchestration/Services/ServerOrchestrationDispatcher.ts";
import { makeProjectTriggerRunRow } from "./commands.ts";
import { redactProjectTriggerEvent } from "./eventPayload.ts";
import { projectTriggerWebhookEndpointPath, toProjectTriggerRunRecord } from "./records.ts";
import {
  ProjectTriggerRepository,
  ProjectTriggerRunId,
  type ProjectTriggerRow,
  type ProjectTriggerRunRow,
} from "./Services/ProjectTriggerRepository.ts";
import { ProjectTriggerScheduler } from "./Services/ProjectTriggerScheduler.ts";
import {
  deriveProjectTriggerWebhookSecret,
  encodeProjectTriggerWebhookSecret,
  parseProjectTriggerWebhookHeaders,
  PROJECT_TRIGGER_WEBHOOK_MASTER_SECRET_NAME,
  PROJECT_TRIGGER_WEBHOOK_RECEIPT_TTL_MS,
  ProjectTriggerWebhookRateLimiter,
  projectTriggerWebhookRequestDigest,
  projectTriggerWebhookRunKey,
  verifyProjectTriggerWebhookSignature,
} from "./webhookSecurity.ts";

const rateLimiter = new ProjectTriggerWebhookRateLimiter();
const ProjectTriggerCancelBody = Schema.Struct({
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
const EmptyJsonObject = Schema.Struct({});
const decodeProjectTriggerWebhookEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProjectTriggerWebhookEventInput),
);
const decodeProjectTriggerCancelBody = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProjectTriggerCancelBody),
);
const decodeEmptyJsonObject = Schema.decodeUnknownEffect(Schema.fromJsonString(EmptyJsonObject));
const RESPONSE_HEADERS = {
  ...browserApiCorsHeaders,
  "cache-control": "no-store",
} as const;

function response(
  status: number,
  code: string,
  message: string,
  headers?: Readonly<Record<string, string>>,
) {
  return HttpServerResponse.jsonUnsafe(
    { error: { code, message } },
    { status, headers: { ...RESPONSE_HEADERS, ...headers } },
  );
}

function pathOnly(request: HttpServerRequest.HttpServerRequest): string {
  const queryStart = request.originalUrl.indexOf("?");
  return queryStart === -1 ? request.originalUrl : request.originalUrl.slice(0, queryStart);
}

function pathParam(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const authenticateServiceRequest = Effect.fn("projectTrigger.authenticateServiceRequest")(
  function* (request: HttpServerRequest.HttpServerRequest, requiredScope: AuthEnvironmentScope) {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request);
    return (
      (session.method === "bearer-access-token" || session.method === "dpop-access-token") &&
      session.scopes.includes(requiredScope)
    );
  },
);

const readBoundedBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(PROJECT_TRIGGER_WEBHOOK_MAX_BODY_BYTES),
    ),
  );

const signedRequest = Effect.fn("projectTrigger.signedRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
  trigger: ProjectTriggerRow,
  rawBody: string,
) {
  const nowMs = yield* Clock.currentTimeMillis;
  const parsedHeaders = parseProjectTriggerWebhookHeaders(request.headers, nowMs);
  if (!parsedHeaders.ok) {
    return {
      ok: false,
      response: response(401, parsedHeaders.error, "The signed webhook headers are invalid."),
    } as const;
  }
  const secretStore = yield* ServerSecretStore;
  const masterSecretExit = yield* Effect.exit(
    secretStore.getOrCreateRandom(PROJECT_TRIGGER_WEBHOOK_MASTER_SECRET_NAME, 32),
  );
  if (Exit.isFailure(masterSecretExit)) {
    yield* Effect.logError("project trigger webhook secret load failed", {
      cause: masterSecretExit.cause,
    });
    return {
      ok: false,
      response: response(503, "webhook_secret_unavailable", "Webhook verification is unavailable."),
    } as const;
  }
  const secret = deriveProjectTriggerWebhookSecret(
    masterSecretExit.value,
    trigger.webhookPublicId,
    trigger.webhookSecretVersion,
  );
  if (
    !verifyProjectTriggerWebhookSignature({
      secret,
      signature: parsedHeaders.signature,
      request: {
        method: request.method,
        path: pathOnly(request),
        timestamp: parsedHeaders.timestamp,
        nonce: parsedHeaders.nonce,
        idempotencyKey: parsedHeaders.idempotencyKey,
        rawBody,
      },
    })
  ) {
    return {
      ok: false,
      response: response(401, "invalid_signature", "The webhook signature is invalid."),
    } as const;
  }
  const rate = rateLimiter.take(trigger.webhookPublicId, nowMs);
  if (!rate.allowed) {
    return {
      ok: false,
      response: response(429, "rate_limited", "The project trigger rate limit was exceeded.", {
        "retry-after": String(rate.retryAfter),
      }),
    } as const;
  }
  return { ok: true, headers: parsedHeaders } as const;
});

const webhookResult = Effect.fn("projectTrigger.webhookResult")(function* (
  run: ProjectTriggerRunRow,
  trigger: ProjectTriggerRow,
  idempotentReplay: boolean,
) {
  const environment = yield* ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const statusPath = `${projectTriggerWebhookEndpointPath(trigger.webhookPublicId)}/runs/${encodeURIComponent(run.runId)}`;
  return {
    run: toProjectTriggerRunRecord(run, trigger),
    correlation: {
      runId: run.runId,
      threadId: run.threadId,
      threadPath: buildAgentAwarenessDeepLink({ environmentId, threadId: run.threadId }),
      statusPath,
    },
    idempotentReplay,
  } satisfies ProjectTriggerWebhookRunResult;
});

function receiptExpiry(receivedAt: string): string {
  return DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe(receivedAt), {
      milliseconds: PROJECT_TRIGGER_WEBHOOK_RECEIPT_TTL_MS,
    }),
  );
}

const webhookRunRoute = HttpRouter.add(
  "POST",
  "/api/project-triggers/webhook/:publicId",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const publicId = pathParam(params.publicId);
    if (!publicId)
      return response(400, "invalid_public_id", "Project trigger public id is missing.");

    const authenticated = yield* Effect.exit(
      authenticateServiceRequest(request, AuthProjectTriggerRunScope),
    );
    if (Exit.isFailure(authenticated)) {
      return response(401, "authentication_required", "A valid service bearer token is required.");
    }
    if (!authenticated.value) {
      return response(
        403,
        "insufficient_scope",
        `The service token requires scope ${AuthProjectTriggerRunScope}.`,
      );
    }

    const repository = yield* ProjectTriggerRepository;
    const triggerResult = yield* Effect.exit(repository.getTriggerByPublicId({ publicId }));
    if (Exit.isFailure(triggerResult)) {
      yield* Effect.logError("project trigger webhook lookup failed", {
        cause: triggerResult.cause,
      });
      return response(500, "trigger_lookup_failed", "The project trigger could not be loaded.");
    }
    if (
      Option.isNone(triggerResult.value) ||
      triggerResult.value.value.deletedAt !== null ||
      !triggerResult.value.value.enabled
    ) {
      return response(
        404,
        "trigger_not_found",
        "The project trigger was not found or is disabled.",
      );
    }
    const trigger = triggerResult.value.value;
    if (trigger.webhookSecretVersion < 1) {
      return response(
        409,
        "webhook_not_configured",
        "Rotate this trigger's webhook secret before sending events.",
      );
    }

    const contentLength = request.headers["content-length"];
    if (
      contentLength !== undefined &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > PROJECT_TRIGGER_WEBHOOK_MAX_BODY_BYTES)
    ) {
      return response(413, "payload_too_large", "The trigger event body exceeds 64 KiB.");
    }
    const rawBodyExit = yield* Effect.exit(readBoundedBody(request));
    if (Exit.isFailure(rawBodyExit)) {
      return response(413, "payload_too_large", "The trigger event body exceeds 64 KiB.");
    }
    const rawBody = rawBodyExit.value;
    if (Buffer.byteLength(rawBody, "utf8") > PROJECT_TRIGGER_WEBHOOK_MAX_BODY_BYTES) {
      return response(413, "payload_too_large", "The trigger event body exceeds 64 KiB.");
    }

    const requestPath = pathOnly(request);
    const signed = yield* signedRequest(request, trigger, rawBody);
    if (!signed.ok) return signed.response;

    const decoded = yield* Effect.exit(decodeProjectTriggerWebhookEvent(rawBody));
    if (Exit.isFailure(decoded)) {
      return response(
        400,
        "invalid_event",
        "The trigger event body does not match the event contract.",
      );
    }
    const event = redactProjectTriggerEvent(decoded.value);
    const receivedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const requestDigest = projectTriggerWebhookRequestDigest({
      eventKind: event.eventKind ?? "webhook",
      rawBody,
    });
    const run = {
      ...makeProjectTriggerRunRow({
        trigger,
        fireAt: receivedAt,
        queuedAt: receivedAt,
        initiator: "webhook",
        eventKind: event.eventKind ?? "webhook",
        event,
        idempotencyKey: signed.headers.idempotencyKey,
        requestDigest,
        runKey: projectTriggerWebhookRunKey(trigger.triggerId, signed.headers.idempotencyKey),
      }),
      idempotencyKey: signed.headers.idempotencyKey,
    };
    const accepted = yield* repository.acceptWebhookRun({
      run,
      nonce: signed.headers.nonce,
      requestDigest,
      receivedAt,
      expiresAt: receiptExpiry(receivedAt),
    });
    if (accepted.outcome === "idempotency-conflict") {
      return response(
        409,
        "idempotency_conflict",
        "The idempotency key was already used for a different event.",
      );
    }
    if (accepted.outcome === "replay") {
      return response(409, "replay_detected", "The webhook nonce has already been used.");
    }

    const scheduler = yield* ProjectTriggerScheduler;
    if (accepted.outcome === "inserted") {
      yield* scheduler.tick.pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);
    }
    const acceptedRun = accepted.run;
    const statusPath = `${requestPath}/runs/${encodeURIComponent(acceptedRun.runId)}`;
    const result = yield* webhookResult(acceptedRun, trigger, accepted.outcome === "existing");
    return HttpServerResponse.jsonUnsafe(result, {
      status: accepted.outcome === "existing" ? 200 : 202,
      headers: { ...RESPONSE_HEADERS, location: statusPath },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("project trigger webhook request failed", { cause }).pipe(
        Effect.as(response(500, "internal_error", "The trigger event could not be accepted.")),
      ),
    ),
  ),
);

const webhookRunStatusRoute = HttpRouter.add(
  "GET",
  "/api/project-triggers/webhook/:publicId/runs/:runId",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const publicId = pathParam(params.publicId);
    const runId = pathParam(params.runId);
    if (!publicId || !runId)
      return response(400, "invalid_request", "Trigger and run ids are required.");
    const authenticated = yield* Effect.exit(
      authenticateServiceRequest(request, AuthProjectTriggerRunScope),
    );
    if (Exit.isFailure(authenticated)) {
      return response(401, "authentication_required", "A valid service bearer token is required.");
    }
    if (!authenticated.value) {
      return response(
        403,
        "insufficient_scope",
        `The service token requires scope ${AuthProjectTriggerRunScope}.`,
      );
    }
    const repository = yield* ProjectTriggerRepository;
    const trigger = yield* repository.getTriggerByPublicId({ publicId });
    if (Option.isNone(trigger) || trigger.value.deletedAt !== null) {
      return response(404, "trigger_not_found", "The project trigger was not found.");
    }
    if (trigger.value.webhookSecretVersion < 1) {
      return response(
        409,
        "webhook_not_configured",
        "The project trigger webhook is not configured.",
      );
    }
    const rawBodyExit = yield* Effect.exit(readBoundedBody(request));
    if (Exit.isFailure(rawBodyExit)) {
      return response(413, "payload_too_large", "The status request body exceeds 64 KiB.");
    }
    if (rawBodyExit.value.length > 0) {
      return response(400, "invalid_status_request", "The status request body must be empty.");
    }
    const signed = yield* signedRequest(request, trigger.value, rawBodyExit.value);
    if (!signed.ok) return signed.response;
    const run = yield* repository.getRunById({ runId: ProjectTriggerRunId.make(runId) });
    if (Option.isNone(run) || run.value.triggerId !== trigger.value.triggerId) {
      return response(404, "run_not_found", "The project trigger run was not found.");
    }
    return HttpServerResponse.jsonUnsafe(yield* webhookResult(run.value, trigger.value, false), {
      status: 200,
      headers: RESPONSE_HEADERS,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("project trigger run status request failed", { cause }).pipe(
        Effect.as(response(500, "internal_error", "The trigger run could not be loaded.")),
      ),
    ),
  ),
);

const webhookSecretRotateRoute = HttpRouter.add(
  "POST",
  "/api/project-triggers/:triggerId/webhook/secret/rotate",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const rawTriggerId = pathParam(params.triggerId);
    if (!rawTriggerId) {
      return response(400, "invalid_trigger_id", "Project trigger id is missing.");
    }
    const authenticated = yield* Effect.exit(
      authenticateServiceRequest(request, AuthAccessWriteScope),
    );
    if (Exit.isFailure(authenticated)) {
      return response(
        401,
        "authentication_required",
        "A valid administrative bearer token is required.",
      );
    }
    if (!authenticated.value) {
      return response(
        403,
        "insufficient_scope",
        `The administrative token requires scope ${AuthAccessWriteScope}.`,
      );
    }
    const repository = yield* ProjectTriggerRepository;
    const trigger = yield* repository.getTriggerById({
      triggerId: ProjectTriggerId.make(rawTriggerId),
    });
    if (Option.isNone(trigger) || trigger.value.deletedAt !== null) {
      return response(404, "trigger_not_found", "The project trigger was not found.");
    }
    const secretStore = yield* ServerSecretStore;
    const master = yield* secretStore.getOrCreateRandom(
      PROJECT_TRIGGER_WEBHOOK_MASTER_SECRET_NAME,
      32,
    );
    const updatedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const version = yield* repository.rotateWebhookSecretVersion({
      triggerId: trigger.value.triggerId,
      updatedAt,
    });
    if (Option.isNone(version)) {
      return response(404, "trigger_not_found", "The project trigger was not found.");
    }
    const credentials: ProjectTriggerWebhookCredentials = {
      triggerId: trigger.value.triggerId,
      publicId: trigger.value.webhookPublicId,
      endpointPath: projectTriggerWebhookEndpointPath(trigger.value.webhookPublicId),
      secret: encodeProjectTriggerWebhookSecret(
        deriveProjectTriggerWebhookSecret(master, trigger.value.webhookPublicId, version.value),
      ),
      secretVersion: version.value,
      algorithm: "hmac-sha256",
      signatureHeader: "x-kamicode-signature",
      timestampHeader: "x-kamicode-timestamp",
      nonceHeader: "x-kamicode-nonce",
      idempotencyHeader: "idempotency-key",
    };
    return HttpServerResponse.jsonUnsafe(
      { credentials },
      { status: 200, headers: RESPONSE_HEADERS },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("project trigger webhook secret rotation failed", { cause }).pipe(
        Effect.as(response(500, "internal_error", "The webhook secret could not be rotated.")),
      ),
    ),
  ),
);

const webhookRunCancelRoute = HttpRouter.add(
  "POST",
  "/api/project-triggers/webhook/:publicId/runs/:runId/cancel",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const publicId = pathParam(params.publicId);
    const rawRunId = pathParam(params.runId);
    if (!publicId || !rawRunId) {
      return response(400, "invalid_request", "Trigger and run ids are required.");
    }
    const authenticated = yield* Effect.exit(
      authenticateServiceRequest(request, AuthProjectTriggerRunScope),
    );
    if (Exit.isFailure(authenticated)) {
      return response(401, "authentication_required", "A valid service bearer token is required.");
    }
    if (!authenticated.value) {
      return response(
        403,
        "insufficient_scope",
        `The service token requires scope ${AuthProjectTriggerRunScope}.`,
      );
    }
    const rawBodyExit = yield* Effect.exit(readBoundedBody(request));
    if (Exit.isFailure(rawBodyExit)) {
      return response(413, "payload_too_large", "The cancellation body exceeds 64 KiB.");
    }
    const rawBody = rawBodyExit.value;
    const repository = yield* ProjectTriggerRepository;
    const trigger = yield* repository.getTriggerByPublicId({ publicId });
    if (
      Option.isNone(trigger) ||
      trigger.value.deletedAt !== null ||
      trigger.value.webhookSecretVersion < 1
    ) {
      return response(404, "trigger_not_found", "The project trigger was not found or configured.");
    }
    const signed = yield* signedRequest(request, trigger.value, rawBody);
    if (!signed.ok) return signed.response;
    const runId = ProjectTriggerRunId.make(rawRunId);
    const run = yield* repository.getRunById({ runId });
    if (Option.isNone(run) || run.value.triggerId !== trigger.value.triggerId) {
      return response(404, "run_not_found", "The project trigger run was not found.");
    }
    const decodedBody =
      rawBody.trim().length === 0
        ? Exit.succeed({} as typeof ProjectTriggerCancelBody.Type)
        : yield* Effect.exit(decodeProjectTriggerCancelBody(rawBody));
    if (Exit.isFailure(decodedBody)) {
      return response(400, "invalid_cancel_request", "The cancellation body is invalid.");
    }
    const reason = decodedBody.value.reason;
    if (reason !== undefined && reason.length > 2_000) {
      return response(400, "invalid_cancel_request", "The cancellation reason is too long.");
    }
    const receivedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const operationIdempotencyKey = `cancel:${runId}:${signed.headers.idempotencyKey}`;
    const requestDigest = projectTriggerWebhookRequestDigest({
      eventKind: `cancel:${runId}`,
      rawBody,
    });
    const receipt = yield* repository.recordWebhookOperation({
      triggerId: trigger.value.triggerId,
      runId,
      idempotencyKey: operationIdempotencyKey,
      nonce: signed.headers.nonce,
      requestDigest,
      receivedAt,
      expiresAt: receiptExpiry(receivedAt),
    });
    if (receipt.outcome === "idempotency-conflict") {
      return response(409, "idempotency_conflict", "The idempotency key has different content.");
    }
    if (receipt.outcome === "replay") {
      return response(409, "replay_detected", "The webhook nonce has already been used.");
    }
    if (run.value.status === "running") {
      const dispatcher = yield* ServerOrchestrationDispatcher;
      yield* dispatcher.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make(
          `project-trigger:${runId}:cancel:${projectTriggerWebhookRunKey(
            trigger.value.triggerId,
            operationIdempotencyKey,
          )}`,
        ),
        threadId: run.value.threadId,
        createdAt: receivedAt,
      });
    }
    yield* repository.markRunCancelled({
      runId,
      cancelledAt: receivedAt,
      cancellationReason: reason ?? "Cancelled by the project trigger controller.",
    });
    const current = yield* repository.getRunById({ runId });
    if (Option.isNone(current)) {
      return response(404, "run_not_found", "The project trigger run was not found.");
    }
    return HttpServerResponse.jsonUnsafe(
      yield* webhookResult(current.value, trigger.value, receipt.outcome === "existing"),
      { status: 200, headers: RESPONSE_HEADERS },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("project trigger run cancellation failed", { cause }).pipe(
        Effect.as(response(500, "internal_error", "The trigger run could not be cancelled.")),
      ),
    ),
  ),
);

const webhookRunRetryRoute = HttpRouter.add(
  "POST",
  "/api/project-triggers/webhook/:publicId/runs/:runId/retry",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const publicId = pathParam(params.publicId);
    const rawRunId = pathParam(params.runId);
    if (!publicId || !rawRunId) {
      return response(400, "invalid_request", "Trigger and run ids are required.");
    }
    const authenticated = yield* Effect.exit(
      authenticateServiceRequest(request, AuthProjectTriggerRunScope),
    );
    if (Exit.isFailure(authenticated)) {
      return response(401, "authentication_required", "A valid service bearer token is required.");
    }
    if (!authenticated.value) {
      return response(
        403,
        "insufficient_scope",
        `The service token requires scope ${AuthProjectTriggerRunScope}.`,
      );
    }
    const rawBodyExit = yield* Effect.exit(readBoundedBody(request));
    if (Exit.isFailure(rawBodyExit)) {
      return response(413, "payload_too_large", "The retry body exceeds 64 KiB.");
    }
    const rawBody = rawBodyExit.value;
    if (rawBody.trim().length > 0) {
      const decoded = yield* Effect.exit(decodeEmptyJsonObject(rawBody));
      if (Exit.isFailure(decoded)) {
        return response(400, "invalid_retry_request", "The retry body must be a JSON object.");
      }
    }
    const repository = yield* ProjectTriggerRepository;
    const trigger = yield* repository.getTriggerByPublicId({ publicId });
    if (
      Option.isNone(trigger) ||
      trigger.value.deletedAt !== null ||
      !trigger.value.enabled ||
      trigger.value.webhookSecretVersion < 1
    ) {
      return response(404, "trigger_not_found", "The project trigger was not found or enabled.");
    }
    const signed = yield* signedRequest(request, trigger.value, rawBody);
    if (!signed.ok) return signed.response;
    const sourceRunId = ProjectTriggerRunId.make(rawRunId);
    const source = yield* repository.getRunById({ runId: sourceRunId });
    if (Option.isNone(source) || source.value.triggerId !== trigger.value.triggerId) {
      return response(404, "run_not_found", "The project trigger run was not found.");
    }
    if (
      source.value.status === "queued" ||
      source.value.status === "starting" ||
      source.value.status === "running"
    ) {
      return response(409, "run_not_terminal", "Only a terminal trigger run can be retried.");
    }
    const receivedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const idempotencyKey = `retry:${sourceRunId}:${signed.headers.idempotencyKey}`;
    const requestDigest = projectTriggerWebhookRequestDigest({
      eventKind: `retry:${sourceRunId}`,
      rawBody,
    });
    const event =
      source.value.eventPayload === null
        ? null
        : {
            eventKind: source.value.eventKind ?? "webhook",
            occurredAt: source.value.fireAt,
            payload: source.value.eventPayload,
          };
    const retry = {
      ...makeProjectTriggerRunRow({
        trigger: trigger.value,
        fireAt: receivedAt,
        queuedAt: receivedAt,
        initiator: "retry",
        eventKind: source.value.eventKind ?? "webhook",
        event,
        idempotencyKey,
        requestDigest,
        retryOfRunId: sourceRunId,
        runKey: projectTriggerWebhookRunKey(trigger.value.triggerId, idempotencyKey),
      }),
      idempotencyKey,
    };
    const accepted = yield* repository.acceptWebhookRun({
      run: retry,
      nonce: signed.headers.nonce,
      requestDigest,
      receivedAt,
      expiresAt: receiptExpiry(receivedAt),
    });
    if (accepted.outcome === "idempotency-conflict") {
      return response(409, "idempotency_conflict", "The idempotency key has different content.");
    }
    if (accepted.outcome === "replay") {
      return response(409, "replay_detected", "The webhook nonce has already been used.");
    }
    if (accepted.outcome === "inserted") {
      const scheduler = yield* ProjectTriggerScheduler;
      yield* scheduler.tick.pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);
    }
    const result = yield* webhookResult(
      accepted.run,
      trigger.value,
      accepted.outcome === "existing",
    );
    return HttpServerResponse.jsonUnsafe(result, {
      status: accepted.outcome === "existing" ? 200 : 202,
      headers: { ...RESPONSE_HEADERS, location: result.correlation.statusPath },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("project trigger run retry failed", { cause }).pipe(
        Effect.as(response(500, "internal_error", "The trigger run could not be retried.")),
      ),
    ),
  ),
);

export const projectTriggerWebhookRouteLayer = Layer.mergeAll(
  webhookRunRoute,
  webhookRunStatusRoute,
  webhookSecretRotateRoute,
  webhookRunCancelRoute,
  webhookRunRetryRoute,
);
