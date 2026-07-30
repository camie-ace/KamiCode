import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearProjectBootstrapRecoveryMarker,
  PROJECT_BOOTSTRAP_RECOVERY_KEY,
  startProjectBootstrapRecovery,
} from "./projectBootstrapRecovery";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("project bootstrap recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries first and performs at most one automatic reload", async () => {
    const storage = createStorage();
    const retry = vi.fn();
    const reload = vi.fn();

    startProjectBootstrapRecovery({
      retry,
      reload,
      storage,
      retryDelayMs: 100,
      reloadDelayMs: 200,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(retry).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(reload).toHaveBeenCalledOnce();

    startProjectBootstrapRecovery({
      retry,
      reload,
      storage,
      retryDelayMs: 100,
      reloadDelayMs: 200,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("clears the reload guard after projects become available", () => {
    const storage = createStorage({ [PROJECT_BOOTSTRAP_RECOVERY_KEY]: "1" });

    clearProjectBootstrapRecoveryMarker(storage);

    expect(storage.getItem(PROJECT_BOOTSTRAP_RECOVERY_KEY)).toBeNull();
  });

  it("does not risk a reload loop when session storage is unavailable", async () => {
    const reload = vi.fn();

    startProjectBootstrapRecovery({
      retry: vi.fn(),
      reload,
      storage: null,
      retryDelayMs: 100,
      reloadDelayMs: 200,
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(reload).not.toHaveBeenCalled();
  });
});
