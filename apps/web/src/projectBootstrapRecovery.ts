export const PROJECT_BOOTSTRAP_RECOVERY_KEY = "kamicode:project-bootstrap-reload:v1";

type RecoveryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function clearProjectBootstrapRecoveryMarker(storage: RecoveryStorage | null): void {
  try {
    storage?.removeItem(PROJECT_BOOTSTRAP_RECOVERY_KEY);
  } catch {
    // Recovery must not break the shell in browsers that deny session storage.
  }
}

export function startProjectBootstrapRecovery(options: {
  readonly retry: () => Promise<void> | void;
  readonly reload: () => void;
  readonly storage: RecoveryStorage | null;
  readonly retryDelayMs?: number;
  readonly reloadDelayMs?: number;
}): () => void {
  const retryTimer = setTimeout(() => {
    void Promise.resolve(options.retry()).catch(() => undefined);
  }, options.retryDelayMs ?? 3_000);
  const reloadTimer = setTimeout(() => {
    if (!claimProjectBootstrapRecoveryReload(options.storage)) {
      return;
    }
    options.reload();
  }, options.reloadDelayMs ?? 10_000);

  return () => {
    clearTimeout(retryTimer);
    clearTimeout(reloadTimer);
  };
}

function claimProjectBootstrapRecoveryReload(storage: RecoveryStorage | null): boolean {
  if (storage === null) {
    return false;
  }
  try {
    if (storage.getItem(PROJECT_BOOTSTRAP_RECOVERY_KEY) === "1") {
      return false;
    }
    storage.setItem(PROJECT_BOOTSTRAP_RECOVERY_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
