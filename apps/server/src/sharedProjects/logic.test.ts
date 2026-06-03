import { describe, expect, it } from "vitest";

import {
  canEditSharedWork,
  canManageSharedProject,
  normalizeGitHubLogin,
  resolveDeployState,
  resolveInviteStatus,
  validateSharedEnvironmentUrl,
} from "./logic.ts";

describe("shared project collaboration logic", () => {
  it("normalizes GitHub handles for invite binding", () => {
    expect(normalizeGitHubLogin(" @Octo-User ")).toBe("octo-user");
  });

  it("keeps viewer permissions read-only", () => {
    expect(canManageSharedProject("viewer")).toBe(false);
    expect(canEditSharedWork("viewer")).toBe(false);
    expect(canEditSharedWork("member")).toBe(true);
    expect(canManageSharedProject("admin")).toBe(true);
  });

  it("classifies invite lifecycle states", () => {
    const now = "2026-05-30T12:00:00.000Z";
    expect(
      resolveInviteStatus(
        { claimedAt: null, revokedAt: null, expiresAt: "2026-05-31T12:00:00.000Z" },
        now,
      ),
    ).toBe("pending");
    expect(
      resolveInviteStatus(
        {
          claimedAt: "2026-05-30T12:01:00.000Z",
          revokedAt: null,
          expiresAt: "2026-05-31T12:00:00.000Z",
        },
        now,
      ),
    ).toBe("claimed");
    expect(
      resolveInviteStatus(
        { claimedAt: null, revokedAt: null, expiresAt: "2026-05-29T12:00:00.000Z" },
        now,
      ),
    ).toBe("expired");
  });

  it("marks non-http environment URLs invalid without blocking valid URLs", () => {
    expect(validateSharedEnvironmentUrl("https://preview.example.com")).toBe("unknown");
    expect(validateSharedEnvironmentUrl("http://127.0.0.1:5173")).toBe("unknown");
    expect(validateSharedEnvironmentUrl("notaurl")).toBe("invalid-url");
    expect(validateSharedEnvironmentUrl("file:///tmp/app")).toBe("invalid-url");
  });

  it("detects stale branch deploy associations from SHA mismatch", () => {
    expect(resolveDeployState({ currentHeadSha: "abc", deployedSha: "abc" })).toBe("current");
    expect(resolveDeployState({ currentHeadSha: "abc", deployedSha: "def" })).toBe("stale");
    expect(resolveDeployState({ currentHeadSha: "abc", deployedSha: null })).toBe("unknown");
  });
});
