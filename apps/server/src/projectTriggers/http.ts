import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { browserApiCorsHeaders } from "../httpCors.ts";

export interface ProjectTriggerWebhookNotConfiguredResponse {
  readonly error: {
    readonly type: "ProjectTriggerWebhookNotConfiguredError";
    readonly code: "project_trigger_webhook_not_configured";
    readonly message: string;
    readonly publicId: string;
    readonly idempotencyKey: string | null;
  };
}

export const projectTriggerWebhookRouteLayer = HttpRouter.add(
  "POST",
  "/api/project-triggers/webhook/:publicId",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const publicId = params.publicId?.trim();
    if (!publicId) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: {
            type: "ProjectTriggerWebhookNotConfiguredError",
            code: "project_trigger_webhook_not_configured",
            message: "Project trigger webhook public id is missing.",
            publicId: "",
            idempotencyKey: request.headers["idempotency-key"] ?? null,
          },
        } satisfies ProjectTriggerWebhookNotConfiguredResponse,
        { status: 400, headers: browserApiCorsHeaders },
      );
    }

    return HttpServerResponse.jsonUnsafe(
      {
        error: {
          type: "ProjectTriggerWebhookNotConfiguredError",
          code: "project_trigger_webhook_not_configured",
          message:
            "Project trigger webhooks are not configured on this runtime. HMAC verification data is not exposed by the trigger service.",
          publicId,
          idempotencyKey: request.headers["idempotency-key"] ?? null,
        },
      } satisfies ProjectTriggerWebhookNotConfiguredResponse,
      { status: 501, headers: browserApiCorsHeaders },
    );
  }),
);
