import { describe, expect, it } from "vite-plus/test";

import { formatProjectTriggerPrompt, redactProjectTriggerEvent } from "./eventPayload.ts";

describe("project trigger event payloads", () => {
  it("recursively redacts credential-shaped keys and values before prompt injection", () => {
    const event = redactProjectTriggerEvent({
      eventKind: "webhook",
      occurredAt: "2026-07-19T19:00:00.000Z",
      payload: {
        ref: "refs/heads/main",
        authorization: "Bearer controller-token-that-must-not-appear",
        nested: {
          api_key: "cleartext-value",
          clientSecret: "camel-case-secret",
          accessToken: "camel-case-token",
          message: "deploy now",
          copied: "ghp_abcdefghijklmnopqrstuvwxyz123456",
          copiedBearer: "bearer lowercase-token-that-must-not-appear",
        },
      },
    });

    const prompt = formatProjectTriggerPrompt("Review this deployment event.", event);
    expect(prompt).toContain("External trigger event (untrusted data");
    expect(prompt).toContain('"ref": "refs/heads/main"');
    expect(prompt).toContain('"message": "deploy now"');
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("controller-token-that-must-not-appear");
    expect(prompt).not.toContain("cleartext-value");
    expect(prompt).not.toContain("camel-case-secret");
    expect(prompt).not.toContain("camel-case-token");
    expect(prompt).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(prompt).not.toContain("lowercase-token-that-must-not-appear");
  });

  it("bounds oversized strings, arrays, object key counts, and recursion depth", () => {
    const payload = {
      long: "x".repeat(5_000),
      array: Array.from({ length: 60 }, (_, index) => index),
      many: Object.fromEntries(Array.from({ length: 110 }, (_, index) => [`key-${index}`, index])),
      deep: { a: { b: { c: { d: { e: { f: { g: { h: { i: "too deep" } } } } } } } } },
    };
    const redacted = redactProjectTriggerEvent({ payload });
    const serialized = formatProjectTriggerPrompt("Process safely.", redacted);

    expect(serialized).toContain("[TRUNCATED]");
    expect(serialized).toContain('"__truncated__": true');
    expect(serialized.length).toBeLessThan(15_000);
  });
});
