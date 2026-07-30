const POST_PAIRING_PROJECT_REVEAL_KEY = "kamicode:reveal-projects-after-pairing";

type SessionStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type BrowserLocation = Pick<Location, "replace">;

export function completeSameOriginPairing(
  options: {
    readonly location?: BrowserLocation;
    readonly sessionStorage?: SessionStorage;
  } = {},
): void {
  const sessionStorage = options.sessionStorage ?? window.sessionStorage;

  try {
    sessionStorage.setItem(POST_PAIRING_PROJECT_REVEAL_KEY, "1");
  } catch {
    // A private or locked-down browser can deny session storage. Reloading still
    // completes authentication; only the automatic sidebar reveal is skipped.
  }

  (options.location ?? window.location).replace("/");
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
