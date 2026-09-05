# Remote access

Use this when you want to connect to a KamiCode server from another device such as a phone, tablet, or separate desktop app.

## T3 Connect

T3 Connect makes an environment available to your other devices without setting
up router forwarding. In the desktop app on the host, open **Settings →
Connections**, sign in, and enable **T3 Connect** for that environment.

For a command-line host, run:

```bash
npx t3@latest connect
```

Follow the sign-in instructions. Setup offers a
[background service](./background-service.md); if you decline it, start the
server with `npx t3 serve`. Saving your sign-in alone does not make the machine
reachable.

On your other device, sign in to the same T3 Connect account and choose the
environment. Over SSH, the CLI prints a browser link and accepts the returned
authorization code, so you do not need to forward an OAuth callback port.

T3 Connect renews access credentials when needed without disconnecting a healthy
connection. Pull request diffs and provider settings keep working after the
previous credential expires. A failed renewal affects that request; it does not
disconnect an otherwise healthy conversation.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Connections**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet
address:

```bash
npx t3 serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
npx t3 pair
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Connections**
on web and desktop and **Settings → Environments** on mobile. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Connections page stays open. If you leave or reload that page, create
another link to share.

### Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Connections**. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
npx t3 serve --tailscale-serve
```

For an already-running server:

```bash
npx t3 pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

Use this when you want the desktop app to start or reuse KamiCode on another machine over SSH.

1. Open **Settings** → **Connections**.
2. Under **Remote Environments**, choose **Add environment**.
3. Select the SSH launch flow.
4. Enter the SSH target, such as `user@example.com`.
5. Confirm the launch. The desktop app probes the host, starts or reuses a remote T3 server, opens a local port forward, and saves the environment.

After setup, the renderer connects to a local forwarded HTTP/WebSocket endpoint. The remote host still owns the actual T3 server, projects, files, git state, terminals, and provider sessions.

If that port is already in use, choose another with
`--tailscale-serve-port`. See `npx t3 pair --help` for other pairing options.

### Hosted web app

[app.t3.codes](https://app.t3.codes) needs an HTTPS endpoint. It connects directly
to your server; a hosted pairing link does not make an unreachable backend
reachable or convert HTTP to HTTPS.

The remote host must have a compatible Node.js runtime. KamiCode uses the server package's `engines.node` requirement:

## Desktop-managed SSH

During SSH launch, KamiCode first checks whether `node` is already available on `PATH`. If it is missing, the launcher tries common non-interactive shell locations and version-manager shims/activation hooks:

- `~/.local/bin`, `~/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`
- Volta via `~/.volta/bin`
- asdf via `~/.asdf/shims`, `~/.asdf/bin`, or `~/.asdf/asdf.sh`
- mise via `~/.local/share/mise/shims`, `~/.mise/shims`, or `mise activate sh`
- fnm via `fnm env --use-on-cd --shell sh` or `fnm env --shell sh`
- nodenv via `~/.nodenv/bin`, `~/.nodenv/shims`, or `nodenv init -`
- nvm via `$NVM_DIR/nvm.sh`, then `nvm use default`, `nvm use node`, or `nvm use --lts`
- installed nvm versions under `$NVM_DIR/versions/node/*/bin`

If launch fails with `node: command not found`, a port-scan failure, or a message that the remote Node version does not satisfy the required range, SSH into the host and check the same non-interactive shell path KamiCode uses:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

If that does not print a compatible Node version, configure your version manager for non-interactive shells or install a compatible Node binary in one of the searched locations. For example, with nvm you may need a default alias:

```bash
nvm alias default 24
```

With mise, asdf, fnm, or nodenv, make sure the tool's shim directory is installed and resolves to a Node version satisfying the range above without an interactive shell.

If reconnecting after an app update fails, retry the SSH launch once. The launcher now compares its generated runner script, stops stale launcher-managed remote servers, clears the SSH launch PID/port state, and starts a fresh remote server. You should not normally need to delete `~/.t3/ssh-launch` or kill `t3` processes manually.

## Antigravity Google sign-in

Antigravity runs and saves its Google credentials on the selected environment. You can install
it and sign in from a remote web, desktop, or mobile client without an SSH login.

Start in **Settings** > **Providers** on web or desktop. On mobile, open **Settings** >
**Environments**, expand the environment, then choose **Set up Antigravity**.

After Google sign-in, a remote browser usually reaches a `127.0.0.1` page that cannot load.
Copy that full address into the return URL field in the same T3 Code client. Choose
**Continue** on web or desktop, or **Complete sign-in** on mobile. Keep the address unchanged.
Do not paste the return URL into a thread or bug report.

See [Antigravity setup](./providers-antigravity.md) for installation, expiry, and account changes.

## Updating a Remote Server

When the T3 Code web or desktop app and a remote server use different versions, a warning appears in
the conversation and in **Settings** → **Connections**. Follow the action shown there: T3 Code may
be able to update and reconnect the server for you, or it may ask you to update the desktop app or
run a copied command on the server machine.

If T3 Connect cannot connect, check the date and time on both devices, then try again.

Finish active work before updating because the server restarts briefly. For step-by-step guidance,
see [Keeping T3 Code in Sync](./updating.md).

On a Linux host, you can keep the server running after logout and manage it independently of the
connection method. See [Running T3 Code in the Background](./background-service.md).

## Browser Control on a Headless Server

A web-mode server can host the conversation's Browser panel itself. Start the server with
`T3CODE_HOSTED_BROWSER=true` and install its Playwright Chromium dependency. The Browser card then
becomes available in the web client without a desktop app.

The agent and the person using the web client share the same server-side tab. An agent opening or
navigating the browser updates the visible Browser panel, while pointer, scrolling, and keyboard
input in that panel control the same page. The server bounds concurrent tabs with
`T3CODE_HOSTED_BROWSER_MAX_TABS` and reclaims pages after
`T3CODE_HOSTED_BROWSER_IDLE_TIMEOUT_MS` of inactivity.

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `t3 serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Hosted Web App Pairing

The hosted web app at `https://app.t3.codes` can save a remote backend in browser local storage from a URL like:

```text
https://app.t3.codes/pair?host=https://backend.example.com:3773#token=PAIRCODE
```

If SSH reconnecting fails after an app update, retry the launch once. Removing
the connection stops a server that T3 Code launched; a server that was already
running is left alone.

For Antigravity's Google callback on a remote host, see
[remote sign-in](./providers-antigravity.md#sign-in-from-a-remote-device).

Hosted pairing does not proxy traffic through KamiCode. The browser still connects directly to the backend URL in the pairing link.

On the host, **Settings → Connections** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `npx t3 auth --help`.

A session with an open connection stays listed after its access credential
expires.

To remove an environment from T3 Connect, open your account menu's **T3 Connect**
page, or **Settings → T3 Connect** on mobile, and choose **Deregister**. This
revokes its cloud access and frees its host space even when the environment is
offline or has been wiped.

On a command-line host, `t3 connect unlink` disables exposure while retaining
your login; `t3 connect logout` also clears that login. Background-service
[removal](./background-service.md#manage-the-service) is separate.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.

## T3 Connect troubleshooting

Run `t3 connect status` on the host to inspect saved authorization and link
configuration. It is not a live reachability check. If the environment appears
offline, run `t3 service status` and read the displayed log. If it disappears
when SSH closes, see [background-service troubleshooting](./background-service.md#troubleshooting).

| Error                                                     | Recovery                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` or managed tunnel limit | Deregister an unused environment, then restart T3 Code on the host.                                                                         |
| `auth_invalid` or `invalid_bearer`                        | Run `t3 connect login`. If credentials were revoked, run `t3 connect logout`, then `t3 connect` again. Restart the server after signing in. |
| Expired or invalid link proof                             | Check the host's date and time, update T3 Code, then restart it.                                                                            |
| HTTP 403 without a recognized error                       | Check relay access, proxies, and firewall rules. Keep any Cloudflare Ray ID for a bug report.                                               |
| HTTP 408, 429, or 5xx                                     | Check network and relay availability. Startup retries temporary failures for up to ten minutes.                                             |

After fixing a permanent rejection, restart the host's server. On Linux, use
`systemctl --user restart t3code.service` for the background service. For a
foreground server, stop it and run `t3 serve` again with your usual options.
Include the diagnostic message and trace ID when reporting a persistent failure.

For a connection that still fails after linking, check the date and time on both
devices. For server version warnings, follow [Updating T3 Code](./updating.md).
