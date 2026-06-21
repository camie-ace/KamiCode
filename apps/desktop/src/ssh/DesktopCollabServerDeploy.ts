import type {
  DesktopCollabServerDeployResult,
  DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import {
  SshPasswordPrompt,
  type SshPasswordPromptShape,
  type SshPasswordRequest,
} from "@t3tools/ssh/auth";
import { remoteStateKey, runSshCommand } from "@t3tools/ssh/command";
import {
  SshCommandError,
  SshInvalidTargetError,
  SshPasswordPromptError,
} from "@t3tools/ssh/errors";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopSshPasswordPrompts from "./DesktopSshPasswordPrompts.ts";

const KAMICODE_REPO_URL = "https://github.com/camie-ace/KamiCode";
const COLLAB_SERVICE_NAME = "kamicode-collab";
const COLLAB_DEFAULT_PORT = 8787;

type DeployCollabServerError = SshCommandError | SshInvalidTargetError | SshPasswordPromptError;

function readLocalCollabServerBundleBase64(): Effect.Effect<
  string,
  never,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const candidates = [
      path.join(process.cwd(), "apps", "collab-server", "dist", "index.mjs"),
      path.join(__dirname, "..", "..", "collab-server", "dist", "index.mjs"),
    ];
    for (const candidate of candidates) {
      const content = yield* fs
        .readFileString(candidate)
        .pipe(Effect.orElseSucceed((): string | null => null));
      if (content !== null) {
        return Buffer.from(content).toString("base64");
      }
    }
    return "";
  });
}

function buildDeployScript(localCollabServerBundleBase64: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

PUBLIC_BASE_URL_INPUT="\${1:-}"
TARGET_KEY="\${2:-}"
ALLOW_REPAIR="\${3:-0}"
LOCAL_COLLAB_BUNDLE_BASE64='${localCollabServerBundleBase64}'
REPO_URL="https://github.com/camie-ace/KamiCode"
SERVICE_NAME="kamicode-collab"
PORT="\${KAMICODE_COLLAB_PORT:-8787}"
APP_DIR="$HOME/.kamicode-collab"
REPO_DIR="$APP_DIR/KamiCode"
BUNDLE_DIR="$APP_DIR/collab-server-bundle"
ENV_FILE="$APP_DIR/.env"
LOG_FILE="$APP_DIR/collab.log"
POSTGRES_CONTAINER="kamicode-collab-postgres"
POSTGRES_PORT="54329"
DATABASE_URL="postgres://kamicode:kamicode@127.0.0.1:\${POSTGRES_PORT}/kamicode_collab"

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    printf 'Remote deploy repair requires root access or passwordless sudo on the SSH target.\n' >&2
    exit 1
  fi
}

repair_log() {
  printf 'KamiCode deploy repair: %s\n' "$1" >&2
}

fail_missing_command() {
  printf 'Missing required command on SSH target: %s\n' "$1" >&2
  exit 1
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail_missing_command "$1"
  fi
}

install_packages() {
  if [ "$ALLOW_REPAIR" != "1" ]; then
    fail_missing_command "$1"
  fi
  repair_log "installing missing package(s): $*"
  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get update
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    run_as_root yum install -y "$@"
  elif command -v apk >/dev/null 2>&1; then
    run_as_root apk add --no-cache "$@"
  elif command -v pacman >/dev/null 2>&1; then
    run_as_root pacman -Sy --noconfirm "$@"
  else
    printf 'Automatic deploy repair cannot install %s because no supported package manager was found.\n' "$*" >&2
    exit 1
  fi
}

ensure_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  if [ "$ALLOW_REPAIR" != "1" ]; then
    fail_missing_command "$1"
  fi
  case "$1" in
    git|curl|tar)
      install_packages "$1"
      ;;
    docker)
      ensure_command curl
      repair_log "installing Docker"
      curl -fsSL https://get.docker.com -o /tmp/kamicode-install-docker.sh
      run_as_root sh /tmp/kamicode-install-docker.sh
      rm -f /tmp/kamicode-install-docker.sh
      ;;
    *)
      fail_missing_command "$1"
      ;;
  esac
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Deploy repair attempted to install %s, but it is still unavailable on the SSH target.\n' "$1" >&2
    exit 1
  fi
}

if [ "$(uname -s)" != "Linux" ]; then
  printf 'Collaboration server auto-deploy currently requires a Linux SSH target.\n' >&2
  exit 1
fi

ensure_command git
ensure_command curl
ensure_command docker
ensure_command tar

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-active --quiet docker >/dev/null 2>&1; then
    if [ "$ALLOW_REPAIR" = "1" ]; then
      repair_log "starting Docker service"
      run_as_root systemctl enable --now docker >/dev/null 2>&1 || true
    fi
  fi
fi

DOCKER_BIN="docker"
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    DOCKER_BIN="sudo -n docker"
  else
    printf 'Docker is installed but not usable by this SSH user. Add the user to the docker group or deploy manually.\n' >&2
    exit 1
  fi
fi

if ! $DOCKER_BIN info >/dev/null 2>&1; then
  printf 'Docker is installed but not usable by this SSH user. Add the user to the docker group or deploy manually.\n' >&2
  exit 1
fi

mkdir -p "$APP_DIR"

if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
  git -C "$REPO_DIR" fetch --depth 1 origin
  DEFAULT_BRANCH="$(git -C "$REPO_DIR" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's#^refs/remotes/origin/##')"
  DEFAULT_BRANCH="\${DEFAULT_BRANCH:-main}"
  git -C "$REPO_DIR" reset --hard "origin/$DEFAULT_BRANCH"
else
  rm -rf "$REPO_DIR"
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

NODE_VERSION="24.13.1"
PNPM_VERSION="10.24.0"
NODE_DIR="$APP_DIR/node"
TOOLS_BIN_DIR="$APP_DIR/bin"
export PATH="$TOOLS_BIN_DIR:$NODE_DIR/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

node_is_usable() {
  command -v node >/dev/null 2>&1 || return 1
  command -v corepack >/dev/null 2>&1 || return 1
  node -e 'var v = process.versions.node.split(".").map(Number); var ok = (v[0] === 24 && (v[1] > 13 || (v[1] === 13 && v[2] >= 1))) || v[0] > 24; process.exit(ok ? 0 : 1)' >/dev/null 2>&1
}

if ! node_is_usable; then
  case "$(uname -m)" in
    x86_64|amd64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    *)
      printf 'Collaboration server auto-deploy does not support the remote CPU architecture: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-linux-\${NODE_ARCH}.tar.gz" | tar -xz --strip-components=1 -C "$NODE_DIR"
fi
need_command node
need_command corepack

mkdir -p "$TOOLS_BIN_DIR"
corepack enable --install-directory "$TOOLS_BIN_DIR" pnpm
corepack prepare "pnpm@\${PNPM_VERSION}" --activate
need_command pnpm

if [ -f "$REPO_DIR/apps/collab-server/package.json" ]; then
  cd "$REPO_DIR"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm --filter @t3tools/collab-server build
  RUN_DIR="$REPO_DIR/apps/collab-server"
  START_EXEC="$(command -v node) dist/index.mjs"
else
  if [ -z "$LOCAL_COLLAB_BUNDLE_BASE64" ]; then
    printf 'The cloned GitHub repository does not contain apps/collab-server, and no local collab server bundle was available. Push the current collaboration server changes to GitHub or build apps/collab-server locally before deploying.\n' >&2
    exit 1
  fi
  need_command base64
  rm -rf "$BUNDLE_DIR"
  mkdir -p "$BUNDLE_DIR/dist"
  printf '%s' "$LOCAL_COLLAB_BUNDLE_BASE64" | base64 -d > "$BUNDLE_DIR/dist/index.mjs"
  cat > "$BUNDLE_DIR/package.json" <<'EOF'
{
  "name": "@t3tools/collab-server-deploy-bundle",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.24.0",
  "dependencies": {
    "pg": "^8.16.3"
  }
}
EOF
  cd "$BUNDLE_DIR"
  pnpm install --prod --ignore-scripts
  RUN_DIR="$BUNDLE_DIR"
  START_EXEC="$(command -v node) dist/index.mjs"
fi

if ! $DOCKER_BIN ps -a --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  $DOCKER_BIN run -d \
    --name "$POSTGRES_CONTAINER" \
    --restart unless-stopped \
    -e POSTGRES_USER=kamicode \
    -e POSTGRES_PASSWORD=kamicode \
    -e POSTGRES_DB=kamicode_collab \
    -p "127.0.0.1:\${POSTGRES_PORT}:5432" \
    postgres:16-alpine >/dev/null
else
  $DOCKER_BIN start "$POSTGRES_CONTAINER" >/dev/null
fi

TOKEN=""
if [ -f "$ENV_FILE" ]; then
  TOKEN="$(grep -E '^KAMICODE_COLLAB_SERVER_TOKEN=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
fi
if [ -z "$TOKEN" ]; then
  if command -v openssl >/dev/null 2>&1; then
    TOKEN="$(openssl rand -hex 32)"
  else
    TOKEN="$(date +%s%N)-$(hostname)-$RANDOM"
  fi
fi

cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=0.0.0.0
DATABASE_URL=$DATABASE_URL
KAMICODE_COLLAB_SERVER_TOKEN=$TOKEN
KAMICODE_COLLAB_CORS_ORIGIN=*
KAMICODE_COLLAB_RUN_MIGRATIONS=1
EOF
chmod 600 "$ENV_FILE"

if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/\${SERVICE_NAME}.service" <<EOF
[Unit]
Description=KamiCode Collaboration Server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$RUN_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$START_EXEC
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "\${SERVICE_NAME}.service"
else
  pkill -f '@t3tools/collab-server start|collab-server-bundle/dist/index.mjs|node dist/index.mjs' >/dev/null 2>&1 || true
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  cd "$RUN_DIR"
  nohup $START_EXEC > "$LOG_FILE" 2>&1 &
fi

if [ -n "$PUBLIC_BASE_URL_INPUT" ]; then
  PUBLIC_BASE_URL="\${PUBLIC_BASE_URL_INPUT%/}"
else
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  PUBLIC_BASE_URL="http://\${HOST_IP:-127.0.0.1}:\${PORT}"
fi

auth_check_url() {
  curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-kamicode-user-id: deploy-healthcheck" \
    -H "x-kamicode-github-id: deploy-healthcheck" \
    -H "x-kamicode-github-login: deploy-healthcheck" \
    "$1/api/shared-projects/current-user" || true
}

AUTH_HTTP_CODE="000"
for _ in $(seq 1 60); do
  AUTH_HTTP_CODE="$(auth_check_url "http://127.0.0.1:\${PORT}")"
  if [ "$AUTH_HTTP_CODE" = "200" ]; then
    break
  fi
  sleep 1
done

if [ "$AUTH_HTTP_CODE" != "200" ]; then
  printf 'Collaboration server started check failed: http://127.0.0.1:%s rejected the generated token with HTTP %s. Another service may already be using this port, or the existing collaboration server was started with a different KAMICODE_COLLAB_SERVER_TOKEN. Stop the old service or save the existing server URL with its matching token.\n' "$PORT" "$AUTH_HTTP_CODE" >&2
  exit 1
fi

printf '{"baseUrl":"%s","token":"%s","service":"%s","targetKey":"%s"}\n' "$PUBLIC_BASE_URL" "$TOKEN" "$SERVICE_NAME" "$TARGET_KEY"
`;
}

function makePasswordPrompt(
  prompts: DesktopSshPasswordPrompts.DesktopSshPasswordPrompts["Service"],
  initialPassword?: string | null,
): SshPasswordPromptShape {
  let pendingInitialPassword = initialPassword ?? null;
  return {
    isAvailable: true,
    request: (request: SshPasswordRequest) => {
      if (pendingInitialPassword !== null) {
        const password = pendingInitialPassword;
        pendingInitialPassword = null;
        return Effect.succeed(password);
      }
      return prompts.request(request).pipe(
        Effect.mapError(
          (cause) =>
            new SshPasswordPromptError({
              message:
                cause instanceof Error && cause.message.trim().length > 0
                  ? cause.message
                  : "SSH password prompt failed.",
              cause,
            }),
        ),
      );
    },
  };
}

function defaultPublicBaseUrl(target: DesktopSshEnvironmentTarget): string {
  const hostname = target.hostname.trim() || target.alias.trim();
  return `http://${hostname}:${COLLAB_DEFAULT_PORT}`;
}

function parseDeployResult(stdout: string): DesktopCollabServerDeployResult {
  const line =
    stdout
      .trim()
      .split(/\r?\n/u)
      .findLast((entry) => entry.trim().startsWith("{")) ?? "";
  const parsed = JSON.parse(line) as DesktopCollabServerDeployResult;
  if (!parsed.baseUrl || !parsed.token || !parsed.service || !parsed.targetKey) {
    throw new Error("Collaboration server deploy did not return a complete result.");
  }
  return parsed;
}

export const deployCollabServer = Effect.fn("desktop.collabServer.deploy")(function* (input: {
  readonly target: DesktopSshEnvironmentTarget;
  readonly password?: string | null;
  readonly publicBaseUrl?: string | null;
  readonly installDocker?: boolean;
}): Effect.fn.Return<
  DesktopCollabServerDeployResult,
  DeployCollabServerError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | DesktopSshPasswordPrompts.DesktopSshPasswordPrompts
> {
  const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
  const passwordPrompt = SshPasswordPrompt.of(makePasswordPrompt(prompts, input.password));
  const publicBaseUrl = input.publicBaseUrl?.trim() || defaultPublicBaseUrl(input.target);
  const localCollabServerBundleBase64 = yield* readLocalCollabServerBundleBase64();
  const result = yield* runSshCommand(input.target, {
    ...(input.password ? { authSecret: input.password, interactiveAuth: true } : {}),
    remoteCommandArgs: [
      "bash",
      "-s",
      "--",
      publicBaseUrl,
      remoteStateKey(input.target),
      input.installDocker ? "1" : "0",
    ],
    stdin: buildDeployScript(localCollabServerBundleBase64),
    timeoutMs: input.installDocker ? 20 * 60 * 1000 : 10 * 60 * 1000,
  }).pipe(Effect.provideService(SshPasswordPrompt, passwordPrompt));
  return yield* Effect.try({
    try: () => parseDeployResult(result.stdout),
    catch: (cause) =>
      new SshCommandError({
        command: ["ssh", "deploy-collab-server"],
        exitCode: null,
        stderr: result.stderr,
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to parse ${COLLAB_SERVICE_NAME} deployment result from ${KAMICODE_REPO_URL}.`,
        cause,
      }),
  });
});
