import { describe, expect, it, vi } from "vite-plus/test";

import { completeSameOriginPairing, consumePostPairingProjectReveal } from "./postPairing";

function createSessionStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("post-pairing handoff", () => {
  it("stays in the loaded app, wakes projects, and reveals them exactly once", async () => {
    const sessionStorage = createSessionStorage();
    const replace = vi.fn();
    const calls: string[] = [];

    await completeSameOriginPairing({
      finishInApp: async () => {
        calls.push("finish");
      },
      location: { replace },
      retryProjectConnection: async () => {
        calls.push("retry");
      },
      sessionStorage,
    });

    expect(calls).toEqual(["retry", "finish"]);
    expect(replace).not.toHaveBeenCalled();
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(true);
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(false);
  });

  it("still finishes in-app when session storage is unavailable", async () => {
    const replace = vi.fn();
    const finishInApp = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    await completeSameOriginPairing({
      finishInApp,
      location: { replace },
      sessionStorage,
    });

    expect(finishInApp).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(false);
  });

  it("uses a hard navigation only when the in-app handoff fails", async () => {
    const replace = vi.fn();

    await completeSameOriginPairing({
      finishInApp: async () => {
        throw new Error("router failed");
      },
      location: { replace },
      sessionStorage: createSessionStorage(),
    });

    expect(replace).toHaveBeenCalledWith("/");
  });
});
