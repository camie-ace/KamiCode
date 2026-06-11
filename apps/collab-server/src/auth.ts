// @effect-diagnostics nodeBuiltinImport:off - standalone non-Effect service; uses node:http types directly.
import type { KamiUser } from "@t3tools/contracts";
import type { IncomingMessage } from "node:http";

import type { CollabServerConfig } from "./config.ts";
import { HttpError } from "./errors.ts";

export interface AuthenticatedUser {
  readonly user: KamiUser;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = firstHeader(request.headers[name]);
  if (!value) {
    throw new HttpError(401, `Missing ${name} header.`);
  }
  return value;
}

export function authenticateRequest(
  config: CollabServerConfig,
  request: IncomingMessage,
): AuthenticatedUser {
  const authorization = firstHeader(request.headers.authorization);
  const expected = `Bearer ${config.serverToken}`;
  if (authorization !== expected) {
    throw new HttpError(401, "Collaboration server authentication required.");
  }

  const userId = requiredHeader(request, "x-kamicode-user-id");
  const githubId = requiredHeader(request, "x-kamicode-github-id");
  const githubLogin = requiredHeader(request, "x-kamicode-github-login")
    .replace(/^@/u, "")
    .toLowerCase();
  const displayName = firstHeader(request.headers["x-kamicode-display-name"]);
  const avatarUrl = firstHeader(request.headers["x-kamicode-avatar-url"]);

  return {
    user: {
      userId,
      githubId,
      githubLogin,
      displayName,
      avatarUrl,
    } as KamiUser,
  };
}
