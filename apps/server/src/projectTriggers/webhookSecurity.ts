import * as NodeCrypto from "node:crypto";

import { timingSafeEqualBase64Url } from "../auth/utils.ts";

export const PROJECT_TRIGGER_WEBHOOK_MASTER_SECRET_NAME = "project-trigger-webhook-master";
export const PROJECT_TRIGGER_WEBHOOK_SIGNATURE_HEADER = "x-kamicode-signature";
export const PROJECT_TRIGGER_WEBHOOK_TIMESTAMP_HEADER = "x-kamicode-timestamp";
export const PROJECT_TRIGGER_WEBHOOK_NONCE_HEADER = "x-kamicode-nonce";
export const PROJECT_TRIGGER_WEBHOOK_IDEMPOTENCY_HEADER = "idempotency-key";
export const PROJECT_TRIGGER_WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export const PROJECT_TRIGGER_WEBHOOK_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
export const PROJECT_TRIGGER_WEBHOOK_RATE_LIMIT = 30;
export const PROJECT_TRIGGER_WEBHOOK_RATE_WINDOW_MS = 60_000;

export interface ProjectTriggerWebhookSignatureInput {
  readonly method: string;
  readonly path: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly rawBody: string;
}

export function projectTriggerWebhookCanonicalPayload(
  input: ProjectTriggerWebhookSignatureInput,
): string {
  return [
    "v1",
    input.timestamp,
    input.nonce,
    input.idempotencyKey,
    input.method.toUpperCase(),
    input.path,
    input.rawBody,
  ].join("\n");
}

export function deriveProjectTriggerWebhookSecret(
  masterSecret: Uint8Array,
  publicId: string,
  version: number,
): Uint8Array {
  return Uint8Array.from(
    NodeCrypto.createHmac("sha256", Buffer.from(masterSecret))
      .update(`kamicode-project-trigger:${publicId}:v${version}`, "utf8")
      .digest(),
  );
}

export function encodeProjectTriggerWebhookSecret(secret: Uint8Array): string {
  return Buffer.from(secret).toString("base64url");
}

export function signProjectTriggerWebhookRequest(
  secret: Uint8Array,
  input: ProjectTriggerWebhookSignatureInput,
): string {
  const signature = NodeCrypto.createHmac("sha256", Buffer.from(secret))
    .update(projectTriggerWebhookCanonicalPayload(input), "utf8")
    .digest("base64url");
  return `v1=${signature}`;
}

export function verifyProjectTriggerWebhookSignature(input: {
  readonly secret: Uint8Array;
  readonly signature: string;
  readonly request: ProjectTriggerWebhookSignatureInput;
}): boolean {
  if (!input.signature.startsWith("v1=")) return false;
  const actual = input.signature.slice(3);
  const expected = signProjectTriggerWebhookRequest(input.secret, input.request).slice(3);
  try {
    return timingSafeEqualBase64Url(actual, expected);
  } catch {
    return false;
  }
}

export function projectTriggerWebhookRequestDigest(input: {
  readonly eventKind: string;
  readonly rawBody: string;
}): string {
  return NodeCrypto.createHash("sha256")
    .update(`${input.eventKind}\n${input.rawBody}`, "utf8")
    .digest("base64url");
}

export function projectTriggerWebhookRunKey(triggerId: string, idempotencyKey: string): string {
  return `webhook:${NodeCrypto.createHash("sha256")
    .update(`${triggerId}\0${idempotencyKey}`, "utf8")
    .digest("hex")}`;
}

export type ProjectTriggerWebhookHeaderError =
  | "missing-signature"
  | "missing-timestamp"
  | "invalid-timestamp"
  | "stale-timestamp"
  | "missing-nonce"
  | "invalid-nonce"
  | "missing-idempotency-key"
  | "invalid-idempotency-key";

export type ProjectTriggerWebhookHeadersResult =
  | {
      readonly ok: true;
      readonly signature: string;
      readonly timestamp: string;
      readonly nonce: string;
      readonly idempotencyKey: string;
    }
  | { readonly ok: false; readonly error: ProjectTriggerWebhookHeaderError };

export function parseProjectTriggerWebhookHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  nowMs: number,
): ProjectTriggerWebhookHeadersResult {
  const signature = headers[PROJECT_TRIGGER_WEBHOOK_SIGNATURE_HEADER]?.trim();
  if (!signature) return { ok: false, error: "missing-signature" };
  const timestamp = headers[PROJECT_TRIGGER_WEBHOOK_TIMESTAMP_HEADER]?.trim();
  if (!timestamp) return { ok: false, error: "missing-timestamp" };
  if (!/^(?:\d{10}|\d{13})$/u.test(timestamp)) {
    return { ok: false, error: "invalid-timestamp" };
  }
  const timestampNumber = Number(timestamp);
  const timestampMs = timestamp.length === 13 ? timestampNumber : timestampNumber * 1_000;
  if (
    !Number.isSafeInteger(timestampNumber) ||
    Math.abs(nowMs - timestampMs) > PROJECT_TRIGGER_WEBHOOK_MAX_CLOCK_SKEW_SECONDS * 1_000
  ) {
    return { ok: false, error: "stale-timestamp" };
  }
  const nonce = headers[PROJECT_TRIGGER_WEBHOOK_NONCE_HEADER]?.trim();
  if (!nonce) return { ok: false, error: "missing-nonce" };
  if (!/^[A-Za-z0-9._:-]{16,128}$/u.test(nonce)) {
    return { ok: false, error: "invalid-nonce" };
  }
  const idempotencyKey = headers[PROJECT_TRIGGER_WEBHOOK_IDEMPOTENCY_HEADER]?.trim();
  if (!idempotencyKey) return { ok: false, error: "missing-idempotency-key" };
  if (idempotencyKey.length > 200 || /[\r\n]/u.test(idempotencyKey)) {
    return { ok: false, error: "invalid-idempotency-key" };
  }
  return { ok: true, signature, timestamp, nonce, idempotencyKey };
}

interface RateWindow {
  readonly startedAt: number;
  readonly count: number;
}

export class ProjectTriggerWebhookRateLimiter {
  readonly #windows = new Map<string, RateWindow>();
  readonly limit: number;
  readonly windowMs: number;

  constructor(
    limit = PROJECT_TRIGGER_WEBHOOK_RATE_LIMIT,
    windowMs = PROJECT_TRIGGER_WEBHOOK_RATE_WINDOW_MS,
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  take(key: string, nowMs: number): { readonly allowed: boolean; readonly retryAfter: number } {
    const current = this.#windows.get(key);
    if (!current || nowMs - current.startedAt >= this.windowMs) {
      this.#windows.set(key, { startedAt: nowMs, count: 1 });
      this.#prune(nowMs);
      return { allowed: true, retryAfter: 0 };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((current.startedAt + this.windowMs - nowMs) / 1_000)),
      };
    }
    this.#windows.set(key, { ...current, count: current.count + 1 });
    return { allowed: true, retryAfter: 0 };
  }

  #prune(nowMs: number): void {
    if (this.#windows.size < 1_000) return;
    for (const [key, window] of this.#windows) {
      if (nowMs - window.startedAt >= this.windowMs) this.#windows.delete(key);
    }
  }
}
