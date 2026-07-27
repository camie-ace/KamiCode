import { describe, expect, it } from "vite-plus/test";

import {
  deriveProjectTriggerWebhookSecret,
  parseProjectTriggerWebhookHeaders,
  ProjectTriggerWebhookRateLimiter,
  signProjectTriggerWebhookRequest,
  verifyProjectTriggerWebhookSignature,
} from "./webhookSecurity.ts";

const request = {
  method: "POST",
  path: "/api/project-triggers/webhook/public-trigger",
  timestamp: "1784487600",
  nonce: "nonce-0123456789abcdef",
  idempotencyKey: "delivery-42",
  rawBody: '{"eventKind":"webhook","payload":{"ref":"main"}}',
} as const;

describe("project trigger webhook security", () => {
  it("derives versioned per-trigger secrets and rejects signed-request tampering", () => {
    const master = new TextEncoder().encode("test-only-master-material-32-bytes");
    const secret = deriveProjectTriggerWebhookSecret(master, "public-trigger", 1);
    const signature = signProjectTriggerWebhookRequest(secret, request);

    expect(signature.startsWith("v1=")).toBe(true);
    expect(verifyProjectTriggerWebhookSignature({ secret, signature, request })).toBe(true);
    expect(
      verifyProjectTriggerWebhookSignature({
        secret,
        signature,
        request: { ...request, rawBody: `${request.rawBody} ` },
      }),
    ).toBe(false);
    expect(
      Buffer.from(deriveProjectTriggerWebhookSecret(master, "public-trigger", 2)).equals(
        Buffer.from(secret),
      ),
    ).toBe(false);
    expect(
      Buffer.from(deriveProjectTriggerWebhookSecret(master, "another-trigger", 1)).equals(
        Buffer.from(secret),
      ),
    ).toBe(false);
  });

  it("validates timestamp freshness, nonce shape, and idempotency headers", () => {
    const nowMs = 1_784_487_600_000;
    const headers = {
      "x-kamicode-signature": "v1=test-signature",
      "x-kamicode-timestamp": String(nowMs / 1_000),
      "x-kamicode-nonce": "nonce-0123456789abcdef",
      "idempotency-key": "delivery-42",
    };

    expect(parseProjectTriggerWebhookHeaders(headers, nowMs)).toEqual({
      ok: true,
      signature: "v1=test-signature",
      timestamp: String(nowMs / 1_000),
      nonce: "nonce-0123456789abcdef",
      idempotencyKey: "delivery-42",
    });
    expect(
      parseProjectTriggerWebhookHeaders(
        { ...headers, "x-kamicode-timestamp": String(nowMs / 1_000 - 301) },
        nowMs,
      ),
    ).toEqual({ ok: false, error: "stale-timestamp" });
    expect(
      parseProjectTriggerWebhookHeaders(
        { ...headers, "x-kamicode-timestamp": "12345678901" },
        nowMs,
      ),
    ).toEqual({ ok: false, error: "invalid-timestamp" });
    expect(
      parseProjectTriggerWebhookHeaders({ ...headers, "x-kamicode-nonce": "short" }, nowMs),
    ).toEqual({ ok: false, error: "invalid-nonce" });
    expect(parseProjectTriggerWebhookHeaders({ ...headers, "idempotency-key": "" }, nowMs)).toEqual(
      { ok: false, error: "missing-idempotency-key" },
    );
  });

  it("enforces a fixed per-trigger request window", () => {
    const limiter = new ProjectTriggerWebhookRateLimiter(2, 1_000);

    expect(limiter.take("trigger-a", 1_000)).toEqual({ allowed: true, retryAfter: 0 });
    expect(limiter.take("trigger-a", 1_100)).toEqual({ allowed: true, retryAfter: 0 });
    expect(limiter.take("trigger-a", 1_200)).toEqual({ allowed: false, retryAfter: 1 });
    expect(limiter.take("trigger-b", 1_200)).toEqual({ allowed: true, retryAfter: 0 });
    expect(limiter.take("trigger-a", 2_001)).toEqual({ allowed: true, retryAfter: 0 });
  });
});
