// @effect-diagnostics nodeBuiltinImport:off - test-harness routes read Playwright artifacts from disk.
import * as Mime from "effect/http/Mime";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import { Platform as HostProcessPlatform } from "@t3tools/shared/HostProcess";
import { isDevProxiedPath } from "@t3tools/shared/devProxy";
import { injectMcpAppCookieBootstrap, injectMcpAppThemeBootstrap } from "@t3tools/shared/mcpApp";
import { FILE_PREVIEW_SCROLL_SCRIPT } from "@t3tools/shared/htmlRender";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import { cast, pipe } from "effect/Function";
import {
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
  HttpServerRespondable,
} from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { OtlpTracer, OtlpSerialization } from "effect/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import * as ServerConfig from "./config.ts";
import { ASSET_ROUTE_PREFIX, readMcpAppHtml, resolveAsset } from "./assets/AssetAccess.ts";
import { sourceControlMediaResponse } from "./assets/sourceControlMediaResponse.ts";
import { statMediaFile, streamMediaFile, type OpenMediaFile } from "./assets/MediaFile.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "./assets/AttachmentUpload.ts";
import * as BrowserTraceCollector from "./observability/BrowserTraceCollector.ts";
import { ProjectFaviconResolver } from "./project/ProjectFaviconResolver.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { traceRelayRequest } from "./cloud/traceRelayRequest.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentScopeRequired,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
} from "./auth/http.ts";
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
  type BrowserHarnessVideo,
} from "./testing/browserHarness.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import { WEBHOOK_ROUTE_PREFIX } from "./scheduledTasks/ScheduledTaskService.ts";
import { DESKTOP_RENDERER_ORIGINS, MCP_HTTP_PATH } from "./httpCors.ts";
import { requestUrl } from "./requestUrl.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const PRIVATE_ASSET_CACHE_CONTROL = "private, max-age=3600";

export type HttpByteRangeResolution =
  | {
      readonly _tag: "range";
      readonly start: number;
      readonly end: number;
      readonly bytesToRead: number;
      readonly contentRange: string;
    }
  | {
      readonly _tag: "unsatisfiable";
      readonly contentRange: string;
    };

function parseByteRangeInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveHttpByteRange(
  rangeHeader: string | undefined,
  sizeBytes: number,
): HttpByteRangeResolution | null {
  if (!rangeHeader || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  const trimmed = rangeHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bytes=") || trimmed.includes(",")) {
    return null;
  }
  const spec = trimmed.slice("bytes=".length).trim();
  const match = /^(?<start>\d*)-(?<end>\d*)$/u.exec(spec);
  const rawStart = match?.groups?.start ?? "";
  const rawEnd = match?.groups?.end ?? "";
  if (!match || (rawStart.length === 0 && rawEnd.length === 0)) {
    return null;
  }
  if (sizeBytes === 0) {
    return { _tag: "unsatisfiable", contentRange: "bytes */0" };
  }

  let start: number;
  let end: number;
  if (rawStart.length === 0) {
    const suffixLength = parseByteRangeInteger(rawEnd);
    if (suffixLength === null || suffixLength === 0) {
      return null;
    }
    start = Math.max(sizeBytes - suffixLength, 0);
    end = sizeBytes - 1;
  } else {
    const parsedStart = parseByteRangeInteger(rawStart);
    if (parsedStart === null) {
      return null;
    }
    start = parsedStart;
    const parsedEnd = rawEnd.length > 0 ? parseByteRangeInteger(rawEnd) : null;
    if (rawEnd.length > 0 && parsedEnd === null) {
      return null;
    }
    end = Math.min(parsedEnd ?? sizeBytes - 1, sizeBytes - 1);
  }

  if (start >= sizeBytes || end < start) {
    return { _tag: "unsatisfiable", contentRange: `bytes */${sizeBytes}` };
  }

  return {
    _tag: "range",
    start,
    end,
    bytesToRead: end - start + 1,
    contentRange: `bytes ${start}-${end}/${sizeBytes}`,
  };
}
const TEST_HARNESS_ARTIFACT_ROUTE_PATH = "/api/test-harness/artifact";
const TEST_HARNESS_RUNS_ROUTE_PATH = "/api/test-harness/runs";
const TEST_HARNESS_TRACE_VIEWER_ROUTE_PREFIX = "/api/test-harness/trace-viewer";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const DEFAULT_TEST_HARNESS_RUN_LIMIT = 12;
const MAX_TEST_HARNESS_RUN_LIMIT = 50;
const requireFromHttp = NodeModule.createRequire(import.meta.url);
const hostProcessPlatform = Effect.runSync(HostProcessPlatform);
let playwrightTraceViewerRoot: string | undefined;
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
// Opaque origin blocks cookies, storage and API access while allowing scripts.
// Agent HTML can open without a click, so disallow blocking modals.
const HTML_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts allow-forms allow-popups allow-downloads";

// Proxies may strip disposition; force document-capable downloads to octet-stream.
const DOWNLOAD_MIME_TYPE_PATTERN = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/;
const isSafeDownloadMimeType = (mimeType: string): boolean =>
  DOWNLOAD_MIME_TYPE_PATTERN.test(mimeType) &&
  !/(?:^text\/html$|\/xml(?:$|-)|\+xml$)/i.test(mimeType.trim().toLowerCase());
const isSafeInlineMediaMimeType = (mimeType: string): boolean =>
  DOWNLOAD_MIME_TYPE_PATTERN.test(mimeType) && /^(?:audio|video)\//i.test(mimeType);
const isSafeInlineDocumentMimeType = (mimeType: string): boolean =>
  mimeType.toLowerCase() === "application/pdf" || mimeType.toLowerCase() === "text/html";

export function downloadContentDisposition(fileName?: string): string {
  if (fileName === undefined) {
    return "attachment";
  }
  // toWellFormed: encodeURIComponent throws URIError on unpaired surrogates.
  const sanitized = fileName.toWellFormed().replace(/[\p{Cc}"\\]/gu, "_");
  const asciiFallback = sanitized.replace(/[^\u0020-\u007e]/g, "_");
  const needsExtended = asciiFallback !== sanitized;
  const extendedName = encodeURIComponent(sanitized).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"${
    needsExtended ? `; filename*=UTF-8''${extendedName}` : ""
  }`;
}

export function assetResponseHeaders(
  filePath: string,
  options?: {
    readonly download?: boolean;
    readonly fileName?: string;
    readonly mimeType?: string;
  },
): Record<string, string> {
  const lowerPath = filePath.toLowerCase();
  const inlineMimeType = options?.mimeType?.split(";", 1)[0]?.trim();
  return {
    "Cache-Control": PRIVATE_ASSET_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    ...(options?.download
      ? {
          "Content-Disposition": downloadContentDisposition(options.fileName),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type":
            options.mimeType !== undefined && isSafeDownloadMimeType(options.mimeType)
              ? options.mimeType
              : "application/octet-stream",
        }
      : inlineMimeType !== undefined && isSafeInlineMediaMimeType(inlineMimeType)
        ? { "Content-Type": inlineMimeType }
        : inlineMimeType !== undefined && isSafeInlineDocumentMimeType(inlineMimeType)
          ? {
              "Content-Type":
                inlineMimeType.toLowerCase() === "text/html"
                  ? "text/html; charset=utf-8"
                  : "application/pdf",
              ...(inlineMimeType.toLowerCase() === "text/html"
                ? { "Content-Security-Policy": HTML_CONTENT_SECURITY_POLICY }
                : {}),
            }
          : lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")
            ? {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy": HTML_CONTENT_SECURITY_POLICY,
              }
            : {}),
    ...(!options?.download && lowerPath.endsWith(".svg")
      ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
      : {}),
  };
}

function assetByteRange(header: string, size: bigint) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? BigInt(match[1]) : null;
  const last = match[2] ? BigInt(match[2]) : null;
  if (first !== null && last !== null && last < first) return null;
  if (size === 0n || (first !== null && first >= size) || (first === null && last === 0n)) {
    return { _tag: "Unsatisfiable" as const };
  }
  const start = first ?? (last! >= size ? 0n : size - last!);
  const end = first === null || last === null || last >= size ? size - 1n : last;
  if (!Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end))) {
    return { _tag: "Unsatisfiable" as const };
  }
  return {
    _tag: "Range" as const,
    offset: start,
    bytesToRead: end - start + 1n,
    contentRange: `bytes ${start}-${end}/${size}`,
  };
}

export const assetFileResponse = Effect.fn("assetFileResponse")(function* (
  asset: {
    readonly path: string;
    readonly download?: boolean;
    readonly fileName?: string;
    readonly mimeType?: string;
    readonly file?: OpenMediaFile;
    readonly renderIntent?: "mcp-app" | "file-preview";
  },
  rangeHeader?: string,
  ifRangeHeader?: string,
  method: "GET" | "HEAD" = "GET",
) {
  const headers = assetResponseHeaders(asset.path, asset);
  if (
    asset.renderIntent === "mcp-app" &&
    !asset.download &&
    headers["Content-Type"] === "text/html; charset=utf-8"
  ) {
    const bytes = yield* readMcpAppHtml(asset.path);
    if (bytes === null) {
      return HttpServerResponse.text("MCP app is too large to preview.", { status: 413 });
    }
    const body = pipe(
      new TextDecoder().decode(bytes),
      injectMcpAppThemeBootstrap,
      injectMcpAppCookieBootstrap,
      (html) => new TextEncoder().encode(html),
    );
    headers["Content-Length"] = String(body.byteLength);
    return method === "HEAD"
      ? HttpServerResponse.empty({ status: 200, headers })
      : HttpServerResponse.uint8Array(body, { headers });
  }
  if (
    asset.renderIntent === "file-preview" &&
    !asset.download &&
    headers["Content-Type"] === "text/html; charset=utf-8"
  ) {
    const bytes = yield* readMcpAppHtml(asset.path);
    // A page too large to buffer is served as is, without scroll restoration.
    if (bytes !== null) {
      const script = new TextEncoder().encode(FILE_PREVIEW_SCROLL_SCRIPT);
      const body = new Uint8Array(bytes.byteLength + script.byteLength);
      body.set(bytes);
      body.set(script, bytes.byteLength);
      headers["Content-Length"] = String(body.byteLength);
      return method === "HEAD"
        ? HttpServerResponse.empty({ status: 200, headers })
        : HttpServerResponse.uint8Array(body, { headers });
    }
  }
  const mediaFile = asset.file;
  const mediaInfo = mediaFile ? yield* statMediaFile(asset.path, mediaFile) : undefined;
  const isMedia = /^(?:audio|video)\//i.test(headers["Content-Type"] ?? "");
  if (isMedia) {
    // Without file identity, validators cannot guarantee byte equality; attachments must also expire with their URL.
    headers["Cache-Control"] = "private, no-store";
  }
  let status = 200;
  let offset = 0n;
  let bytesToRead: bigint | undefined;
  {
    headers["Accept-Ranges"] = "bytes";
    // If-Range requires a matching validator. A full response is safe when we cannot validate it.
    if (method === "GET" && rangeHeader && ifRangeHeader === undefined) {
      const fs = yield* FileSystem.FileSystem;
      const info = mediaInfo ?? (yield* fs.stat(asset.path));
      const range = assetByteRange(rangeHeader, info.size);
      if (range?._tag === "Unsatisfiable") {
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${info.size}` },
        });
      }
      if (range?._tag === "Range") {
        status = 206;
        offset = range.offset;
        bytesToRead = range.bytesToRead;
        headers["Content-Range"] = range.contentRange;
      }
    }
  }
  if (mediaFile && mediaInfo) {
    const size = bytesToRead ?? mediaInfo.size;
    headers["Content-Type"] ??= Option.getOrElse(
      Mime.getType(asset.path),
      () => "application/octet-stream",
    );
    headers["Content-Length"] = String(size);
    if (!isMedia) {
      headers["Last-Modified"] = mediaInfo.mtime.toUTCString();
      headers.ETag = `W/"${mediaInfo.size.toString(16)}-${mediaInfo.mtimeMs.toString(16)}"`;
    }
    if (method === "HEAD" || size === 0n) {
      return HttpServerResponse.empty({ status, headers });
    }
    const body = streamMediaFile(mediaFile, offset, size);
    if (!body) {
      return HttpServerResponse.text("File is too large to preview.", { status: 413 });
    }
    return HttpServerResponse.stream(body, {
      status,
      headers,
    });
  }
  return yield* HttpServerResponse.file(asset.path, { status, offset, bytesToRead, headers });
});

export const layerHttpCompression = HttpRouter.middleware(HttpMiddleware.compression(), {
  global: true,
});

export const layerBrowserApiCors = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const devOrigin = config.devUrl?.origin;
    // Credentialed dev requests need explicit Vite/Electron origins; packaged desktop uses the default wildcard.
    const cors = HttpMiddleware.cors({
      ...(devOrigin
        ? {
            allowedOrigins: [devOrigin, ...DESKTOP_RENDERER_ORIGINS, ...config.devAllowedOrigins],
            credentials: true,
          }
        : {}),
      allowedMethods: browserApiCorsAllowedMethods,
      allowedHeaders: browserApiCorsAllowedHeaders,
      maxAge: 600,
    });
    return HttpRouter.middleware(
      (httpEffect) => {
        const withCors = cors(httpEffect);
        return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          request.url.split("?", 1)[0] === MCP_HTTP_PATH ? httpEffect : withCors,
        );
      },
      { global: true },
    );
  }),
);

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

function normalizePathForPlatform(value: string): string {
  return hostProcessPlatform === "win32" ? value.toLowerCase() : value;
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

  const requireFromPlaywright = NodeModule.createRequire(requireFromHttp.resolve("playwright"));
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
  readonly videos: ReadonlyArray<BrowserHarnessVideo>;
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
  const raw = await NodeFSP.readFile(summaryPath, "utf8").catch(() => null);
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
    videos: Array.isArray(parsed.videos) ? parsed.videos : [],
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
    const entries = await NodeFSP.readdir(runsDir, { withFileTypes: true }).catch((error) => {
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

const authenticateRawRouteWithScope =
  /* Request instrumentation already owns the span; keep this helper in that context. */
  Effect.fnUntraced(function* (
    scope: typeof AuthOrchestrationReadScope | typeof AuthOrchestrationOperateScope,
  ) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
      Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
        failEnvironmentAuthInvalid(
          EnvironmentAuth.serverAuthCredentialReason(error),
          EnvironmentAuth.serverAuthDpopFailureReason(error),
        ),
      ),
      Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
        failEnvironmentInternal("internal_error", error),
      ),
    );
    if (!session.scopes.includes(scope)) {
      return yield* failEnvironmentScopeRequired(scope);
    }
  });

export const layerServerEnvironmentHttpApi = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "metadata",
  Effect.fnUntraced(function* (handlers) {
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    return handlers.handle(
      "descriptor",
      Effect.fn("environment.metadata.descriptor")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        return yield* serverEnvironment.getDescriptor;
      }, traceRelayRequest),
    );
  }),
);

class DecodeOtlpTraceRecordsError extends Schema.TaggedError<DecodeOtlpTraceRecordsError>()(
  "DecodeOtlpTraceRecordsError",
  { cause: Schema.Defect() },
) {}

class ListTestHarnessRunsError extends Schema.TaggedError<ListTestHarnessRunsError>()(
  "ListTestHarnessRunsError",
  { cause: Schema.Unknown },
) {}

// Tracing once-per-second renderer exports would create more spans than it forwards.
export const layerOtlpTracesProxyRoute = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const otlpHeaders = config.otlpTracesExport.headers;
    const browserTraceCollector = yield* BrowserTraceCollector.BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const serialization = yield* OtlpSerialization.OtlpSerialization;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) => Effect.logWarning("Failed to decode browser OTLP traces", { cause })),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: serialization.traces(bodyJson),
        headers: otlpHeaders,
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
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Trace export failed.", { status: 502 }),
        ),
      );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
    Effect.withTracerEnabled(false),
  ),
);

const UNTRACED_REQUEST_PATHS: ReadonlySet<string> = new Set([OTLP_TRACES_PROXY_PATH]);

// HttpRouter.serve builds routes privately; provide the server-wide TracerDisabledWhen to the served layer.
const layerUntracedRequests = Layer.succeed(HttpMiddleware.TracerDisabledWhen)((request) => {
  const queryIndex = request.url.indexOf("?");
  const path = queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
  // Signed URLs carry bearer tokens in the path, so they never reach a trace.
  return (
    UNTRACED_REQUEST_PATHS.has(path) ||
    path.startsWith(`${WEBHOOK_ROUTE_PREFIX}/`) ||
    path.startsWith(`${ASSET_ROUTE_PREFIX}/`) ||
    path.startsWith(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`)
  );
});

export const withUntracedRequests = Layer.provide(layerUntracedRequests);

// Request spans otherwise parent to the server's lifetime span, so every request shares one trace id.
export const withRootRequestSpans = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.fromBuild((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      // ParentSpan is optional to every reader, so removing it leaves R satisfied.
      Effect.updateContext(
        (context: Context.Context<R>) =>
          Context.omit(Tracer.ParentSpan)(context) as Context.Context<R>,
      ),
    ),
  );

export const layerAssetRoute = HttpRouter.add(
  "GET",
  `${ASSET_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const suffix = url.value.pathname.slice(`${ASSET_ROUTE_PREFIX}/`.length);
    const separatorIndex = suffix.indexOf("/");
    if (separatorIndex <= 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const asset = yield* resolveAsset(
      suffix.slice(0, separatorIndex),
      suffix.slice(separatorIndex + 1),
    );
    if (!asset) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    if (asset.kind === "bytes") {
      return HttpServerResponse.uint8Array(asset.bytes, {
        contentType: asset.mimeType,
        headers: { "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
      });
    }
    if (asset.kind === "source-control-media") {
      return yield* sourceControlMediaResponse(asset, request.headers).pipe(
        Effect.tapError((cause) =>
          // The URL can carry a token in its query string, and the error keeps the request it
          // failed on; the host and the failure kind are enough to diagnose.
          Effect.logWarning("Failed to fetch source control media.", {
            host: URL.canParse(asset.url) ? new URL(asset.url).host : undefined,
            reason: cause.reason._tag,
          }),
        ),
        Effect.orElseSucceed(() =>
          HttpServerResponse.empty({
            status: 502,
            headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
          }),
        ),
      );
    }
    return yield* assetFileResponse(
      asset,
      request.method === "GET" ? request.headers.range : undefined,
      request.headers["if-range"],
      request.method === "HEAD" ? "HEAD" : "GET",
    ).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
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
    const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const testHarnessTraceViewerRouteLayer = HttpRouter.add(
  "GET",
  `${TEST_HARNESS_TRACE_VIEWER_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
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
    const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Option.getOrElse(Mime.getType(filePath), () => "application/octet-stream");
    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    }).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const testHarnessArtifactRouteLayer = HttpRouter.add(
  "GET",
  TEST_HARNESS_ARTIFACT_ROUTE_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const requestedPath = url.value.searchParams.get("path");
    if (!requestedPath) {
      return HttpServerResponse.text("Missing path parameter", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;
    const filePath = resolveTestHarnessArtifactPath({
      stateDir: config.stateDir,
      artifactPath: requestedPath,
    });
    if (!filePath) {
      return HttpServerResponse.text("Invalid artifact path", { status: 403 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentType = Option.getOrElse(Mime.getType(filePath), () => "application/octet-stream");
    const filename = NodePath.basename(filePath).replace(/"/g, "");
    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      contentType,
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    }).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const testHarnessRunsRouteLayer = HttpRouter.add(
  "GET",
  TEST_HARNESS_RUNS_ROUTE_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const cwd = url.value.searchParams.get("cwd");
    if (!cwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;
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
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
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
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const layerAttachmentUploadRoute = HttpRouter.add(
  "POST",
  `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const token = url.value.pathname.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
    if (!token) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const claims = yield* validateAttachmentUploadToken(token);
    if (!claims) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentLengthHeader = request.headers["content-length"];
    if (
      contentLengthHeader !== undefined &&
      (!Number.isInteger(Number(contentLengthHeader)) ||
        Number(contentLengthHeader) !== claims.sizeBytes)
    ) {
      return HttpServerResponse.text("Content-Length must match the upload size.", {
        status: 400,
      });
    }

    // Keep the request stream in the route scope until the response is sent.
    const bodyPull = yield* Stream.toPull(request.stream);
    const stored = yield* storeAttachmentUpload(claims, Stream.fromPull(Effect.succeed(bodyPull)));
    return stored.ok
      ? HttpServerResponse.empty({ status: 204 })
      : HttpServerResponse.text(stored.detail, { status: stored.status });
  }),
);

const decodeBuildManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        file: Schema.String,
        css: Schema.optional(Schema.Array(Schema.String)),
        assets: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
);

const loadImmutableBuildAssets = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const staticDir =
    config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);
  if (!staticDir) return new Set<string>();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem.readFileString(path.join(staticDir, ".vite", "manifest.json")).pipe(
    Effect.flatMap(decodeBuildManifest),
    Effect.map(
      (manifest) =>
        new Set(
          Object.values(manifest).flatMap((entry) => [
            entry.file,
            ...(entry.css ?? []),
            ...(entry.assets ?? []),
          ]),
        ),
    ),
    Effect.orElseSucceed(() => new Set<string>()),
  );
});

const openStaticFile = Effect.fn("openStaticFile")(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
  if (pathInfo?.type !== "File") return null;
  const file = yield* fileSystem.open(filePath, { flag: "r" }).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
    }),
  );
  // Electron asar can stat and read files even when opening a handle returns NotFound.
  // Refresh path metadata because the file may have been replaced since the first stat.
  const info = yield* file === null ? fileSystem.stat(filePath) : file.stat;
  return info.type === "File" ? { file, info } : null;
});

const streamStaticFile = (file: FileSystem.File, size: bigint) =>
  Stream.unfold(
    0n,
    Effect.fnUntraced(function* (offset: bigint) {
      if (offset >= size) return;
      const remaining = size - offset;
      const bytes = yield* file.readAlloc(Number(remaining < 65_536n ? remaining : 65_536n));
      if (Option.isNone(bytes)) return;
      return [bytes.value, offset + BigInt(bytes.value.byteLength)] as const;
    }),
  );

// The app can approve agents and start threads in one click, so no other site may frame it.
const SPA_FRAME_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

const handleStaticAndDevRequest = Effect.fn("handleStaticAndDevRequest")(
  function* (immutableBuildAssets: ReadonlySet<string>) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;
    if (config.devUrl && isDevProxiedPath(url.value.pathname)) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: "Not found.",
        },
        { status: 404, headers: browserApiCorsHeaders },
      );
    }

    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir =
      config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);
    if (!staticDir && config.devUrl) {
      // `vp run dev --share --built` prints the pairing URL before its first
      // web build lands in apps/web/dist. Reload until it does.
      return HttpServerResponse.text(
        '<!doctype html><meta http-equiv="refresh" content="2"><p>Waiting for the first web build. This page reloads by itself.</p>',
        { status: 503, contentType: "text/html", headers: { "Retry-After": "2" } },
      );
    }
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

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
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    let opened = yield* openStaticFile(filePath);
    if (!opened) {
      filePath = path.resolve(staticRoot, "index.html");
      opened = yield* openStaticFile(filePath);
      if (!opened) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
    }
    const fileInfo = opened.info;
    const mimeType = Option.getOrElse(Mime.getType(filePath), () => "application/octet-stream");
    const isHtml = mimeType === "text/html";

    // A hash-like name is not enough: custom static files can use the same naming pattern.
    const relativePath = path.relative(staticRoot, filePath).replaceAll("\\", "/");
    const immutable =
      !isHtml &&
      /^assets\/.+-[\w-]{8}\.[^/]+$/.test(relativePath) &&
      immutableBuildAssets.has(relativePath);
    const cacheControl = immutable ? "public, max-age=31536000, immutable" : "no-cache";
    const validators = (info: FileSystem.File.Info) => {
      // Deployments can preserve HTML size and mtime while changing its bundle URLs.
      const modifiedAt = isHtml ? undefined : Option.getOrUndefined(info.mtime);
      return modifiedAt
        ? {
            ETag: `W/"${info.size.toString(16)}-${modifiedAt.getTime().toString(16)}"`,
            "Last-Modified": modifiedAt.toUTCString(),
          }
        : {};
    };
    const headers: Record<string, string> = {
      "Cache-Control": cacheControl,
      ...(isHtml ? SPA_FRAME_HEADERS : {}),
      ...validators(fileInfo),
    };
    const etag = headers.ETag;
    const lastModified = headers["Last-Modified"];

    // If-None-Match precedes dates and uses weak GET/HEAD comparison even across compression.
    const ifNoneMatch = request.headers["if-none-match"];
    const ifModifiedSince = request.headers["if-modified-since"];
    const unchanged =
      ifNoneMatch !== undefined
        ? ifNoneMatch.split(",").some((value) => {
            const candidate = value.trim();
            return (
              candidate === "*" ||
              (etag !== undefined && candidate.replace(/^W\//i, "") === etag.slice(2))
            );
          })
        : ifModifiedSince !== undefined &&
          lastModified !== undefined &&
          Date.parse(lastModified) <= Date.parse(ifModifiedSince);
    if (!isHtml && unchanged) {
      return HttpServerResponse.empty({
        status: 304,
        headers: { ...headers, Vary: "Accept-Encoding" },
      });
    }

    const contentType = isHtml ? "text/html; charset=utf-8" : mimeType;
    if (opened.file === null && request.method !== "HEAD") {
      const fileSystem = yield* FileSystem.FileSystem;
      // Complete fallback reads before success headers; stream errors arrive too late for a 500.
      const bytes = yield* fileSystem.readFile(filePath);
      const info = yield* fileSystem.stat(filePath);
      return HttpServerResponse.uint8Array(bytes, {
        headers: {
          "Cache-Control": cacheControl,
          ...(isHtml ? SPA_FRAME_HEADERS : {}),
          ...validators({ ...info, size: ByteSize.bytes(bytes.byteLength) }),
        },
        contentType,
      });
    }
    // The request scope closes the handle for GET, HEAD, 304, errors, and cancellation.
    // HEAD still passes through compression, which selects headers without reading the stream.
    return HttpServerResponse.stream(
      opened.file === null ? Stream.empty : streamStaticFile(opened.file, fileInfo.size),
      {
        headers,
        contentType,
        contentLength: Number(fileInfo.size),
      },
    );
  },
  Effect.catchTags({
    PlatformError: () =>
      Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
  }),
);

export const layerStaticAndDevRoute = Layer.unwrap(
  loadImmutableBuildAssets.pipe(
    Effect.map((assets) => HttpRouter.add("GET", "*", handleStaticAndDevRequest(assets))),
  ),
);
