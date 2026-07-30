const POST_PAIRING_PROJECT_REVEAL_KEY = "kamicode:reveal-projects-after-pairing";

type SessionStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type BrowserLocation = Pick<Location, "replace">;

function markPostPairingProjectReveal(sessionStorage: SessionStorage): void {
  try {
    sessionStorage.setItem(POST_PAIRING_PROJECT_REVEAL_KEY, "1");
  } catch {
    // A private or locked-down browser can deny session storage. Pairing still
    // completes; only the automatic sidebar reveal is skipped.
  }
}

export async function completeSameOriginPairing(options: {
  readonly finishInApp: () => Promise<void>;
  readonly location?: BrowserLocation;
  readonly retryProjectConnection?: () => Promise<void>;
  readonly sessionStorage?: SessionStorage;
}): Promise<void> {
  const sessionStorage = options.sessionStorage ?? window.sessionStorage;
  markPostPairingProjectReveal(sessionStorage);

  try {
    await options.retryProjectConnection?.();
  } catch {
    // Route activation also starts/retries the primary environment, so a failed
    // eager wake-up must not strand the user on the pairing page.
  }

  try {
    await options.finishInApp();
  } catch {
    // Keep a hard navigation only as a last-resort recovery path. The normal
    // handoff stays inside the already-loaded SPA so it does not download the
    // full application bundle again.
    (options.location ?? window.location).replace("/");
  }
}

export function consumePostPairingProjectReveal(
  sessionStorage: SessionStorage = window.sessionStorage,
): boolean {
  try {
    const shouldRevealProjects = sessionStorage.getItem(POST_PAIRING_PROJECT_REVEAL_KEY) === "1";
    sessionStorage.removeItem(POST_PAIRING_PROJECT_REVEAL_KEY);
    return shouldRevealProjects;
  } catch {
    return false;
  }
}
