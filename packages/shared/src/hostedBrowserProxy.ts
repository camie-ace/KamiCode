const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

export interface HostedBrowserProxyConfig {
  readonly server: string;
  readonly username?: string;
  readonly password?: string;
}

export class HostedBrowserProxyUrlError extends Error {
  constructor() {
    super("Enter an HTTP, HTTPS, SOCKS4, or SOCKS5 proxy URL with no path, query, or fragment.");
    this.name = "HostedBrowserProxyUrlError";
  }
}

const decodeCredential = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HostedBrowserProxyUrlError();
  }
};

/**
 * Convert a credential-bearing proxy URL into Playwright's split proxy shape.
 * The returned server deliberately omits user info so Chromium errors and
 * diagnostics cannot accidentally repeat the saved credential.
 */
export function parseHostedBrowserProxyUrl(value: string): HostedBrowserProxyConfig | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HostedBrowserProxyUrlError();
  }

  if (
    !SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol) ||
    parsed.hostname.length === 0 ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new HostedBrowserProxyUrlError();
  }

  const username = decodeCredential(parsed.username);
  const password = decodeCredential(parsed.password);
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    ...(username.length > 0 ? { username } : {}),
    ...(password.length > 0 ? { password } : {}),
  };
}

export function isHostedBrowserProxyUrl(value: string): boolean {
  try {
    return parseHostedBrowserProxyUrl(value) !== null;
  } catch {
    return false;
  }
}
