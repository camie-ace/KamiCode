// @effect-diagnostics nodeBuiltinImport:off - standalone non-Effect service; uses node:http types directly.
import type { SharedProjectId } from "@t3tools/contracts";
import * as NodeHttp from "node:http";
import type { Pool } from "pg";

import { authenticateRequest } from "./auth.ts";
import type { CollabServerConfig } from "./config.ts";
import { asHttpError, HttpError } from "./errors.ts";
import { SharedProjectsStore } from "./sharedProjects.ts";

type Handler = (
  request: NodeHttp.IncomingMessage,
  url: URL,
  body: unknown,
) => Promise<unknown> | unknown;

function corsHeaders(config: CollabServerConfig): Record<string, string> {
  return {
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-kamicode-user-id,x-kamicode-github-id,x-kamicode-github-login,x-kamicode-display-name,x-kamicode-avatar-url",
    "access-control-max-age": "86400",
  };
}

function sendJson(
  config: CollabServerConfig,
  response: NodeHttp.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    ...corsHeaders(config),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: NodeHttp.IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "OPTIONS") return null;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

function projectIdFromQuery(url: URL): string {
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) throw new HttpError(400, "Missing shared project id.");
  return projectId;
}

export function createCollabHttpServer(config: CollabServerConfig, pool: Pool) {
  const store = new SharedProjectsStore(pool);

  const authenticated = (handler: Handler): Handler => {
    return (request, url, body) => {
      const user = authenticateRequest(config, request);
      return handler(request, url, { body, user });
    };
  };

  const routes = new Map<string, Handler>([
    [
      "GET /healthz",
      async () => {
        await pool.query("SELECT 1");
        return { ok: true };
      },
    ],
    [
      "GET /api/shared-projects/current-user",
      authenticated((_request, _url, context) => {
        const { user } = context as AuthenticatedContext;
        return { user: user.user };
      }),
    ],
    [
      "GET /api/shared-projects",
      authenticated((_request, _url, context) => {
        const { user } = context as AuthenticatedContext;
        return store.listForUser(user);
      }),
    ],
    [
      "GET /api/shared-projects/detail",
      authenticated((_request, url, context) => {
        const { user } = context as AuthenticatedContext;
        return store.getDetail(user, projectIdFromQuery(url) as SharedProjectId);
      }),
    ],
    [
      "GET /api/shared-projects/bootstrap",
      authenticated((_request, url, context) => {
        const { user } = context as AuthenticatedContext;
        return store.getBootstrapManifest(user, projectIdFromQuery(url) as SharedProjectId);
      }),
    ],
    [
      "POST /api/shared-projects/publish",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.publishLocalProject(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/context/sync",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.syncContext(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/invites",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.createInvite(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/invites/claim",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.claimInvite(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/members/role",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.updateMemberRole(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/members/remove",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.removeMember(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/delete",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.deleteProject(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/threads/publish",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.publishThread(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/threads/visibility",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.updateThreadVisibility(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/threads/resolve",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.resolveThreadShare(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/threads/messages",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.appendThreadMessage(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/runtimes",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.upsertRuntime(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/environments",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.upsertEnvironment(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/environments/default",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.setDefaultEnvironment(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/deploys",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.upsertDeployAssociation(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/sync-remote-runtime",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.syncRemoteRuntime(user, body);
      }),
    ],
    [
      "POST /api/shared-projects/artifacts",
      authenticated((_request, _url, context) => {
        const { body, user } = context as AuthenticatedContext;
        return store.upsertArtifact(user, body);
      }),
    ],
  ]);

  return NodeHttp.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders(config));
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const routeKey = `${request.method ?? "GET"} ${url.pathname}`;
      const handler = routes.get(routeKey);
      if (!handler) throw new HttpError(404, "Route not found.");
      const body = await readJsonBody(request);
      const result = await handler(request, url, body);
      sendJson(config, response, 200, result);
    } catch (error) {
      const httpError = asHttpError(error);
      sendJson(config, response, httpError.status, {
        error: httpError.message,
      });
    }
  });
}

interface AuthenticatedContext {
  readonly user: ReturnType<typeof authenticateRequest>;
  readonly body: unknown;
}
