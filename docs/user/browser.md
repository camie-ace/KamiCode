# Browser settings

## Route the hosted browser through a proxy

Servers that provide a hosted browser can route that browser's outbound page traffic through an
HTTP, HTTPS, SOCKS4, or SOCKS5 proxy.

1. Open **Settings → Integrations → Browser**.
2. Under **Proxy URL**, paste the full proxy URL and select **Save**.
3. Turn on **Hosted browser proxy**.

The proxy is off by default. Saving a URL does not enable it. The URL is stored separately with
server-only file permissions and is shown only as a stored-secret marker afterward. Enabling,
disabling, replacing, or clearing the proxy recycles the hosted Chromium context and reloads its
open tabs; it does not restart KamiCode or route SSH, mail, or other server traffic.
Loopback addresses stay direct so previews of projects running on the same server continue to work.

Resource-bounded hosts recycle their least-recently-used inactive page when another thread requests
the shared browser at capacity. A page that is currently visible or was just automated is never
reclaimed, and an explicit request for an additional tab still respects the configured tab limit.

A residential proxy can change the browser's public IP reputation, but it does not guarantee that
a site will stop presenting verification challenges.
