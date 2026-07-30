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
  it("reloads the app and reveals projects exactly once", () => {
    const sessionStorage = createSessionStorage();
    const replace = vi.fn();

    completeSameOriginPairing({
      location: { replace },
      sessionStorage,
    });

    expect(replace).toHaveBeenCalledWith("/");
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(true);
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(false);
  });

  it("still reloads when session storage is unavailable", () => {
    const replace = vi.fn();
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

    completeSameOriginPairing({
      location: { replace },
      sessionStorage,
    });

    expect(replace).toHaveBeenCalledWith("/");
    expect(consumePostPairingProjectReveal(sessionStorage)).toBe(false);
  });
});
