// @effect-diagnostics nodeBuiltinImport:off
import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as NodeFs from "node:fs/promises";
import { createRequire } from "node:module";
import * as NodePath from "node:path";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import { resolveStaticDir, ServerConfig } from "./config.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { respondToAuthError } from "./auth/http.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import {
  browserApiCorsAllowedHeaders,
  browserApiCorsAllowedMethods,
  browserApiCorsHeaders,
} from "./httpCors.ts";
import {
  createBrowserHarnessProjectKey,
  type BrowserHarnessArtifactPaths,
  type BrowserHarnessRunResult,
  type BrowserHarnessScreenshot,
  type BrowserHarnessStatus,
} from "./testing/browserHarness.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
export const TEST_HARNESS_ARTIFACT_ROUTE_PATH = "/api/test-harness/artifact";
export const TEST_HARNESS_RUNS_ROUTE_PATH = "/api/test-harness/runs";
export const TEST_HARNESS_TRACE_VIEWER_ROUTE_PREFIX = "/api/test-harness/trace-viewer";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const DEFAULT_TEST_HARNESS_RUN_LIMIT = 12;
const MAX_TEST_HARNESS_RUN_LIMIT = 50;
const requireFromHttp = createRequire(import.meta.url);
let playwrightTraceViewerRoot: string | undefined;

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: [...browserApiCorsAllowedMethods],
  allowedHeaders: [...browserApiCorsAllowedHeaders],
  maxAge: 600,
});

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

function isDevProxyRequestPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/attachments" ||
    pathname.startsWith("/attachments/") ||
    pathname === "/.well-known" ||
    pathname.startsWith("/.well-known/")
  );
}

function normalizePathForPlatform(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function resolveTestHarnessArtifactPath(input: {
  readonly stateDir: string;
  readonly artifactPath: string;
}): string | null {
  if (!input.artifactPath || input.artifactPath.includes("\0")) {
    return null;
  }

  const artifactRoot = NodePath.resolve(input.stateDir, "test-harness");
  const filePath = NodePath.resolve(input.artifactPath);
  const normalizedRoot = normalizePathForPlatform(artifactRoot);
  const normalizedFilePath = normalizePathForPlatform(filePath);
  const rootPrefix = normalizedRoot.endsWith(NodePath.sep)
    ? normalizedRoot
    : `${normalizedRoot}${NodePath.sep}`;

  if (normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(rootPrefix)) {
    return filePath;
  }

  return null;
}

function resolvePlaywrightTraceViewerRoot(): string {
  if (playwrightTraceViewerRoot) {
    return playwrightTraceViewerRoot;
  }

  const requireFromPlaywright = createRequire(requireFromHttp.resolve("playwright"));
  const playwrightCorePackageJson = requireFromPlaywright.resolve("playwright-core/package.json");
  playwrightTraceViewerRoot = NodePath.join(
    NodePath.dirname(playwrightCorePackageJson),
    "lib",
    "vite",
    "traceViewer",
  );
  return playwrightTraceViewerRoot;
}

export function resolveTestHarnessTraceViewerAssetPath(input: {
  readonly relativePath: string;
}): string | null {
  if (input.relativePath.includes("\0")) {
    return null;
  }

  let decodedRelativePath: string;
  try {
    decodedRelativePath = decodeURIComponent(input.relativePath);
  } catch {
    return null;
  }

  const normalizedRelativePath = decodedRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const assetRelativePath =
    normalizedRelativePath.length === 0 ? "index.html" : normalizedRelativePath;
  const root = resolvePlaywrightTraceViewerRoot();
  const filePath = NodePath.resolve(
    root,
    ...assetRelativePath.split("/").filter((segment) => segment.length > 0),
  );
  const normalizedRoot = normalizePathForPlatform(root);
  const normalizedFilePath = normalizePathForPlatform(filePath);
  const rootPrefix = normalizedRoot.endsWith(NodePath.sep)
    ? normalizedRoot
    : `${normalizedRoot}${NodePath.sep}`;

  if (normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(rootPrefix)) {
    return filePath;
  }

  return null;
}

export type TestHarnessRunListStatus = "pass" | "fail" | "blocked" | "error";

export interface TestHarnessRunListItem {
  readonly runId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly status: TestHarnessRunListStatus;
  readonly success: boolean;
  readonly goal: string | null;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly evidenceSummary: string;
  readonly outputSummary?: string | undefined;
  readonly artifactPaths: BrowserHarnessArtifactPaths;
  readonly screenshots: ReadonlyArray<BrowserHarnessScreenshot>;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly networkFailures: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly summaryPath: string;
  readonly markdownPath: string;
}

export interface TestHarnessRunListResponse {
  readonly runs: ReadonlyArray<TestHarnessRunListItem>;
}

function normalizeTestHarnessRunLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_TEST_HARNESS_RUN_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TEST_HARNESS_RUN_LIMIT;
  }
  return Math.min(parsed, MAX_TEST_HARNESS_RUN_LIMIT);
}

function testHarnessStatusToListStatus(
  status: BrowserHarnessStatus | undefined,
): TestHarnessRunListStatus {
  switch (status) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    case "blocked":
      return "blocked";
    case "error":
    default:
      return "error";
  }
}

function collectTestHarnessConsoleErrors(
  result: Pick<BrowserHarnessRunResult, "consoleMessages" | "pageErrors">,
): string[] {
  return [
    ...result.consoleMessages
      .filter((message) => message.type === "error" || message.type === "warning")
      .map((message) => `[${message.type}] ${message.text}`),
    ...result.pageErrors.map((message) => `[pageerror] ${message}`),
  ];
}

async function readTestHarnessRunSummary(
  summaryPath: string,
): Promise<TestHarnessRunListItem | null> {
  const raw = await NodeFs.readFile(summaryPath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  let parsed: BrowserHarnessRunResult;
  try {
    parsed = JSON.parse(raw) as BrowserHarnessRunResult;
  } catch {
    return null;
  }

  if (
    typeof parsed.runId !== "string" ||
    typeof parsed.projectId !== "string" ||
    typeof parsed.environmentId !== "string" ||
    typeof parsed.url !== "string" ||
    typeof parsed.evidenceSummary !== "string" ||
    !parsed.artifactPaths
  ) {
    return null;
  }

  return {
    runId: parsed.runId,
    projectId: parsed.projectId,
    environmentId: parsed.environmentId,
    status: testHarnessStatusToListStatus(parsed.status),
    success: parsed.success === true,
    goal: typeof parsed.goal === "string" ? parsed.goal : null,
    url: parsed.url,
    finalUrl: typeof parsed.finalUrl === "string" ? parsed.finalUrl : null,
    title: typeof parsed.title === "string" ? parsed.title : null,
    evidenceSummary: parsed.evidenceSummary,
    ...(typeof parsed.doneSummary === "string" ? { outputSummary: parsed.doneSummary } : {}),
    artifactPaths: parsed.artifactPaths,
    screenshots: Array.isArray(parsed.screenshots) ? parsed.screenshots : [],
    consoleErrors: collectTestHarnessConsoleErrors({
      consoleMessages: Array.isArray(parsed.consoleMessages) ? parsed.consoleMessages : [],
      pageErrors: Array.isArray(parsed.pageErrors) ? parsed.pageErrors : [],
    }),
    networkFailures: Array.isArray(parsed.failedRequests) ? parsed.failedRequests : [],
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : "",
    durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
    summaryPath: parsed.summaryPath ?? summaryPath,
    markdownPath: parsed.markdownPath ?? NodePath.join(NodePath.dirname(summaryPath), "summary.md"),
  };
}

function runSortTime(run: TestHarnessRunListItem): number {
  const completed = Date.parse(run.completedAt);
  if (Number.isFinite(completed)) {
    return completed;
  }
  const started = Date.parse(run.startedAt);
  return Number.isFinite(started) ? started : 0;
}

export async function listTestHarnessRuns(input: {
  readonly stateDir: string;
  readonly cwd: string;
  readonly projectId?: string | undefined;
  readonly limit?: number | undefined;
}): Promise<TestHarnessRunListResponse> {
  const cwd = NodePath.resolve(input.cwd);
  const projectKeys = new Set([
    createBrowserHarnessProjectKey({ cwd }),
    ...(input.projectId
      ? [createBrowserHarnessProjectKey({ cwd, projectId: input.projectId })]
      : []),
  ]);
  const limit = Math.min(input.limit ?? DEFAULT_TEST_HARNESS_RUN_LIMIT, MAX_TEST_HARNESS_RUN_LIMIT);
  const summaryPaths: string[] = [];

  for (const projectKey of projectKeys) {
    const runsDir = NodePath.join(input.stateDir, "test-harness", "projects", projectKey, "runs");
    const entries = await NodeFs.readdir(runsDir, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        summaryPaths.push(NodePath.join(runsDir, entry.name, "summary.json"));
      }
    }
  }

  const runs = (await Promise.all(summaryPaths.map(readTestHarnessRunSummary)))
    .filter((run): run is TestHarnessRunListItem => run !== null)
    .toSorted((a, b) => runSortTime(b) - runSortTime(a))
    .slice(0, limit);

  return { runs };
}

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

export const serverEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  "/.well-known/t3/environment",
  Effect.gen(function* () {
    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
    );
    return HttpServerResponse.jsonUnsafe(descriptor, {
      status: 200,
      headers: browserApiCorsHeaders,
    });
  }),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

class ListTestHarnessRunsError extends Data.TaggedError("ListTestHarnessRunsError")<{
  readonly cause: unknown;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", {
        status: 400,
      });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const testHarnessTraceViewerRouteLayer = HttpRouter.add(
  "GET",
  `${TEST_HARNESS_TRACE_VIEWER_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const relativePath = url.value.pathname.slice(TEST_HARNESS_TRACE_VIEWER_ROUTE_PREFIX.length);
    const filePath = resolveTestHarnessTraceViewerAssetPath({ relativePath });
    if (!filePath) {
      return HttpServerResponse.text("Invalid trace viewer asset path", { status: 403 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const testHarnessArtifactRouteLayer = HttpRouter.add(
  "GET",
  TEST_HARNESS_ARTIFACT_ROUTE_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const requestedPath = url.value.searchParams.get("path");
    if (!requestedPath) {
      return HttpServerResponse.text("Missing path parameter", { status: 400 });
    }

    const config = yield* ServerConfig;
    const filePath = resolveTestHarnessArtifactPath({
      stateDir: config.stateDir,
      artifactPath: requestedPath,
    });
    if (!filePath) {
      return HttpServerResponse.text("Invalid artifact path", { status: 403 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const filename = NodePath.basename(filePath).replace(/"/g, "");
    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const testHarnessRunsRouteLayer = HttpRouter.add(
  "GET",
  TEST_HARNESS_RUNS_ROUTE_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const cwd = url.value.searchParams.get("cwd");
    if (!cwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const config = yield* ServerConfig;
    const response = yield* Effect.tryPromise({
      try: () =>
        listTestHarnessRuns({
          stateDir: config.stateDir,
          cwd,
          projectId: url.value.searchParams.get("projectId") ?? undefined,
          limit: normalizeTestHarnessRunLimit(url.value.searchParams.get("limit")),
        }),
      catch: (cause) => new ListTestHarnessRunsError({ cause }),
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to list test harness runs", { cause }).pipe(
          Effect.as<TestHarnessRunListResponse>({ runs: [] }),
        ),
      ),
    );

    return HttpServerResponse.jsonUnsafe(response, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      if (isDevProxyRequestPath(url.value.pathname)) {
        return HttpServerResponse.jsonUnsafe(
          {
            error: "Not found.",
          },
          { status: 404, headers: browserApiCorsHeaders },
        );
      }

      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir = config.staticDir ?? (config.devUrl ? yield* resolveStaticDir() : undefined);
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", {
        status: 400,
      });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", {
        status: 400,
      });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", {
          status: 400,
        });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return HttpServerResponse.uint8Array(indexData, {
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }),
);
