import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export type LocalMediaKind = "image" | "video" | "audio";

export const IMAGE_LOCAL_MEDIA_EXTENSIONS = [
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
] as const;

export const VIDEO_LOCAL_MEDIA_EXTENSIONS = ["m4v", "mkv", "mov", "mp4", "ogv", "webm"] as const;

export const AUDIO_LOCAL_MEDIA_EXTENSIONS = [
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
] as const;

export const COMMON_LOCAL_MEDIA_EXTENSIONS = [
  ...IMAGE_LOCAL_MEDIA_EXTENSIONS,
  ...VIDEO_LOCAL_MEDIA_EXTENSIONS,
  ...AUDIO_LOCAL_MEDIA_EXTENSIONS,
] as const;

export type CommonLocalMediaExtension = (typeof COMMON_LOCAL_MEDIA_EXTENSIONS)[number];

export interface CurrentWorkspaceLocalMediaSearchScope {
  readonly scope: "current-workspace";
  readonly relativeRoot?: string | undefined;
}

export interface ProjectLocalMediaSearchScope {
  readonly scope: "project";
  readonly projectRoot: string;
  readonly relativeRoot?: string | undefined;
}

export interface ExplicitBroadPcLocalMediaSearchScope {
  readonly scope: "explicit-broad-pc";
  readonly rootHints: readonly string[];
}

export type LocalMediaSearchScope =
  | CurrentWorkspaceLocalMediaSearchScope
  | ProjectLocalMediaSearchScope
  | ExplicitBroadPcLocalMediaSearchScope;

export const DEFAULT_LOCAL_MEDIA_SEARCH_SCOPE: CurrentWorkspaceLocalMediaSearchScope = {
  scope: "current-workspace",
};

export interface LocalMediaSearchCandidate {
  readonly path: string;
  readonly extension?: string | undefined;
  readonly modifiedAtMs?: number | undefined;
  readonly sizeBytes?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly durationMs?: number | undefined;
}

export interface LocalMediaRankingOptions {
  readonly query?: string | undefined;
  readonly preferredKinds?: readonly LocalMediaKind[] | undefined;
  readonly limit?: number | undefined;
}

export interface RankedLocalMediaSearchCandidate extends LocalMediaSearchCandidate {
  readonly extension: CommonLocalMediaExtension;
  readonly kind: LocalMediaKind;
  readonly score: number;
}

export type LocalMediaSearchResultConfidence = "high" | "medium" | "low";

export interface LocalMediaSearchScopeRefinement {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: LocalMediaSearchScope;
}

export interface LocalMediaSearchScopeDescriptor {
  readonly kind: LocalMediaSearchScope["scope"];
  readonly label: string;
  readonly detail?: string | undefined;
  readonly rootHints: readonly string[];
  readonly broadPc: boolean;
  readonly refinements: readonly LocalMediaSearchScopeRefinement[];
}

export interface LocalMediaSearchResult extends RankedLocalMediaSearchCandidate {
  readonly rank: number;
  readonly title: string;
  readonly confidence: LocalMediaSearchResultConfidence;
  readonly modifiedAt?: string | undefined;
}

export interface LocalMediaSearchResultSet {
  readonly kind: "local-media-search-results";
  readonly query?: string | undefined;
  readonly scope: LocalMediaSearchScopeDescriptor;
  readonly results: readonly LocalMediaSearchResult[];
  readonly total: number;
}

const LOCAL_MEDIA_EXTENSION_SET: ReadonlySet<string> = new Set(COMMON_LOCAL_MEDIA_EXTENSIONS);

const LOCAL_MEDIA_EXTENSION_KIND: ReadonlyMap<string, LocalMediaKind> = new Map<
  string,
  LocalMediaKind
>([
  ...IMAGE_LOCAL_MEDIA_EXTENSIONS.map((extension) => [extension, "image"] as const),
  ...VIDEO_LOCAL_MEDIA_EXTENSIONS.map((extension) => [extension, "video"] as const),
  ...AUDIO_LOCAL_MEDIA_EXTENSIONS.map((extension) => [extension, "audio"] as const),
]);

const MEDIA_FOLDER_NAMES = new Set(["asset", "assets", "media", "medias"]);
const IMAGE_FOLDER_NAMES = new Set([
  "gif",
  "gifs",
  "image",
  "images",
  "img",
  "imgs",
  "photo",
  "photos",
]);
const VIDEO_FOLDER_NAMES = new Set(["movie", "movies", "video", "videos"]);
const AUDIO_FOLDER_NAMES = new Set(["audio", "music", "sound", "sounds"]);

export function withDefaultLocalMediaSearchScope(
  scope?: LocalMediaSearchScope | undefined,
): LocalMediaSearchScope {
  return scope ?? DEFAULT_LOCAL_MEDIA_SEARCH_SCOPE;
}

export function isExplicitBroadPcLocalMediaSearchScope(
  scope: LocalMediaSearchScope,
): scope is ExplicitBroadPcLocalMediaSearchScope {
  return scope.scope === "explicit-broad-pc";
}

export function normalizeLocalMediaExtension(extension: string): string | null {
  const normalized = extension.trim().toLowerCase().replace(/^\./u, "");
  if (!/^[a-z0-9]{1,8}$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isCommonLocalMediaExtension(
  extension: string,
): extension is CommonLocalMediaExtension {
  const normalized = normalizeLocalMediaExtension(extension);
  return normalized !== null && LOCAL_MEDIA_EXTENSION_SET.has(normalized);
}

export function mediaKindForLocalExtension(extension: string): LocalMediaKind | null {
  const normalized = normalizeLocalMediaExtension(extension);
  if (normalized === null) {
    return null;
  }
  return LOCAL_MEDIA_EXTENSION_KIND.get(normalized) ?? null;
}

export function extensionFromLocalMediaPath(path: string): CommonLocalMediaExtension | null {
  const fileName = fileNameFromPath(path).split(/[?#]/u, 1)[0] ?? "";
  const match = /\.([a-z0-9]{1,8})$/iu.exec(fileName);
  const extension = match?.[1] ? normalizeLocalMediaExtension(match[1]) : null;
  return extension !== null && isCommonLocalMediaExtension(extension) ? extension : null;
}

export function isLocalMediaCandidatePath(path: string): boolean {
  return extensionFromLocalMediaPath(path) !== null;
}

export function tokenizeLocalMediaQuery(query: string): readonly string[] {
  const normalized = normalizeSearchText(query);
  return normalized.length > 0 ? normalized.split(" ") : [];
}

export function rankLocalMediaCandidates(
  candidates: readonly LocalMediaSearchCandidate[],
  options: LocalMediaRankingOptions = {},
): RankedLocalMediaSearchCandidate[] {
  const queryTokens = tokenizeLocalMediaQuery(options.query ?? "");
  const prepared = candidates.flatMap((candidate) => {
    const extension = resolveCandidateExtension(candidate);
    if (extension === null) {
      return [];
    }

    const kind = mediaKindForLocalExtension(extension);
    if (kind === null) {
      return [];
    }

    return [{ candidate, extension, kind }];
  });

  const recency = recencyBounds(prepared.map(({ candidate }) => candidate.modifiedAtMs));
  const preferredKinds = new Set(options.preferredKinds ?? []);
  const ranked = prepared
    .map(({ candidate, extension, kind }) => ({
      ...candidate,
      extension,
      kind,
      score: roundScore(
        scoreLocalMediaCandidate(candidate, {
          extension,
          kind,
          preferredKinds,
          queryTokens,
          recency,
        }),
      ),
    }))
    .toSorted(compareRankedLocalMediaCandidates);

  if (options.limit === undefined) {
    return ranked;
  }

  return ranked.slice(0, Math.max(0, Math.trunc(options.limit)));
}

export function describeLocalMediaSearchScope(
  scope: LocalMediaSearchScope = DEFAULT_LOCAL_MEDIA_SEARCH_SCOPE,
): LocalMediaSearchScopeDescriptor {
  switch (scope.scope) {
    case "current-workspace":
      return {
        kind: scope.scope,
        label: "Current workspace",
        ...(scope.relativeRoot ? { detail: scope.relativeRoot } : {}),
        rootHints: scope.relativeRoot ? [scope.relativeRoot] : [],
        broadPc: false,
        refinements: [
          {
            id: "broaden-to-pc",
            label: "Broaden to PC",
            description: "Search common local media locations outside the current workspace.",
            scope: { scope: "explicit-broad-pc", rootHints: [] },
          },
        ],
      };
    case "project":
      return {
        kind: scope.scope,
        label: "Project",
        detail: scope.relativeRoot
          ? `${scope.projectRoot} / ${scope.relativeRoot}`
          : scope.projectRoot,
        rootHints: [scope.projectRoot, ...(scope.relativeRoot ? [scope.relativeRoot] : [])],
        broadPc: false,
        refinements: [
          ...(scope.relativeRoot
            ? [
                {
                  id: "project-root",
                  label: "Project root",
                  description: "Remove the folder filter and search the whole project.",
                  scope: {
                    scope: "project" as const,
                    projectRoot: scope.projectRoot,
                  },
                },
              ]
            : []),
          {
            id: "broaden-to-pc",
            label: "Broaden to PC",
            description: "Search common local media locations outside this project.",
            scope: { scope: "explicit-broad-pc", rootHints: [scope.projectRoot] },
          },
        ],
      };
    case "explicit-broad-pc":
      return {
        kind: scope.scope,
        label: "Broad PC search",
        detail:
          scope.rootHints.length > 0
            ? scope.rootHints.join(", ")
            : "Common local media folders and selected drives",
        rootHints: scope.rootHints,
        broadPc: true,
        refinements: [
          {
            id: "current-workspace",
            label: "Current workspace",
            description: "Narrow the search back to the active workspace.",
            scope: { scope: "current-workspace" },
          },
          ...scope.rootHints.map((rootHint, index) => ({
            id: `root-${index}`,
            label: fileNameFromPath(rootHint) || rootHint,
            description: `Limit the broad PC search to ${rootHint}.`,
            scope: { scope: "explicit-broad-pc" as const, rootHints: [rootHint] },
          })),
        ],
      };
  }
}

export function buildLocalMediaSearchResultSet(input: {
  readonly candidates: readonly LocalMediaSearchCandidate[];
  readonly query?: string | undefined;
  readonly preferredKinds?: readonly LocalMediaKind[] | undefined;
  readonly limit?: number | undefined;
  readonly scope?: LocalMediaSearchScope | undefined;
  readonly total?: number | undefined;
}): LocalMediaSearchResultSet {
  const ranked = rankLocalMediaCandidates(input.candidates, {
    query: input.query,
    preferredKinds: input.preferredKinds,
    limit: input.limit,
  });
  const bestScore = ranked[0]?.score;

  return {
    kind: "local-media-search-results",
    ...(input.query !== undefined ? { query: input.query } : {}),
    scope: describeLocalMediaSearchScope(withDefaultLocalMediaSearchScope(input.scope)),
    results: ranked.map((candidate, index) => {
      const modifiedAt = toIsoTimestamp(candidate.modifiedAtMs);
      return {
        ...candidate,
        rank: index + 1,
        title: fileNameFromPath(candidate.path),
        confidence: confidenceForRankedResult(candidate.score, bestScore, index),
        ...(modifiedAt ? { modifiedAt } : {}),
      };
    }),
    total: input.total ?? ranked.length,
  };
}

function scoreLocalMediaCandidate(
  candidate: LocalMediaSearchCandidate,
  context: {
    readonly extension: CommonLocalMediaExtension;
    readonly kind: LocalMediaKind;
    readonly preferredKinds: ReadonlySet<LocalMediaKind>;
    readonly queryTokens: readonly string[];
    readonly recency: RecencyBounds | null;
  },
): number {
  const path = candidate.path;
  const fileName = fileNameFromPath(path);
  const fileStem = stripExtension(fileName);
  const normalizedPath = normalizeSearchText(path);
  const normalizedFileName = normalizeSearchText(fileName);
  const normalizedStem = normalizeSearchText(fileStem);
  const normalizedFolders = folderSegmentsFromPath(path).map(normalizeSearchText).filter(Boolean);
  const joinedQuery = context.queryTokens.join(" ");
  let score = baseKindScore(context.kind);

  if (context.preferredKinds.has(context.kind)) {
    score += 90;
  }

  if (joinedQuery.length > 0) {
    score += joinedQueryScore({
      joinedQuery,
      normalizedFileName,
      normalizedPath,
      normalizedStem,
    });

    for (const token of context.queryTokens) {
      score += tokenScore({
        token,
        extension: context.extension,
        kind: context.kind,
        normalizedFileName,
        normalizedFolders,
        normalizedPath,
        normalizedStem,
      });
    }

    if (context.queryTokens.every((token) => normalizedStem.includes(token))) {
      score += 140;
    } else if (context.queryTokens.every((token) => normalizedPath.includes(token))) {
      score += 70;
    }
  }

  score += folderRelevanceScore(normalizedFolders, context.kind);
  score += recencyScore(candidate.modifiedAtMs, context.recency);
  score += metadataScore(candidate, context.kind);
  score -= Math.max(0, pathDepth(path) - 1) * 4;
  score -= path.length / 2_000;

  return score;
}

function joinedQueryScore(input: {
  readonly joinedQuery: string;
  readonly normalizedFileName: string;
  readonly normalizedPath: string;
  readonly normalizedStem: string;
}): number {
  if (input.normalizedStem === input.joinedQuery) {
    return 1_200;
  }
  if (input.normalizedFileName === input.joinedQuery) {
    return 1_000;
  }
  if (input.normalizedStem.startsWith(input.joinedQuery)) {
    return 720;
  }
  if (input.normalizedStem.includes(input.joinedQuery)) {
    return 520;
  }
  if (input.normalizedFileName.includes(input.joinedQuery)) {
    return 420;
  }
  if (input.normalizedPath.includes(input.joinedQuery)) {
    return 220;
  }
  return 0;
}

function tokenScore(input: {
  readonly token: string;
  readonly extension: CommonLocalMediaExtension;
  readonly kind: LocalMediaKind;
  readonly normalizedFileName: string;
  readonly normalizedFolders: readonly string[];
  readonly normalizedPath: string;
  readonly normalizedStem: string;
}): number {
  let score = 0;
  if (input.token === input.extension) {
    score += 140;
  }
  if (input.token === input.kind || input.token === `${input.kind}s`) {
    score += 120;
  }
  if (input.normalizedStem === input.token) {
    score += 340;
  } else if (input.normalizedStem.startsWith(input.token)) {
    score += 230;
  } else if (input.normalizedStem.includes(input.token)) {
    score += 170;
  } else if (input.normalizedFileName.includes(input.token)) {
    score += 120;
  }

  if (input.normalizedFolders.some((folder) => folder === input.token)) {
    score += 95;
  } else if (input.normalizedFolders.some((folder) => folder.startsWith(input.token))) {
    score += 65;
  } else if (input.normalizedPath.includes(input.token)) {
    score += 35;
  }

  return score;
}

function folderRelevanceScore(folders: readonly string[], kind: LocalMediaKind): number {
  let score = 0;
  for (const folder of folders) {
    if (MEDIA_FOLDER_NAMES.has(folder)) {
      score += 28;
    }
    if (kind === "image" && IMAGE_FOLDER_NAMES.has(folder)) {
      score += 24;
    }
    if (kind === "video" && VIDEO_FOLDER_NAMES.has(folder)) {
      score += 24;
    }
    if (kind === "audio" && AUDIO_FOLDER_NAMES.has(folder)) {
      score += 24;
    }
    if (folder === "generated-media") {
      score += 18;
    }
  }
  return score;
}

function metadataScore(candidate: LocalMediaSearchCandidate, kind: LocalMediaKind): number {
  let score = 0;

  if (isPositiveFinite(candidate.sizeBytes)) {
    score += Math.min(24, Math.log2(candidate.sizeBytes + 1) / 2);
  }

  if (isPositiveFinite(candidate.width) && isPositiveFinite(candidate.height)) {
    const pixels = candidate.width * candidate.height;
    score += Math.min(36, Math.log10(pixels + 1) * 5);
    if (candidate.width >= 512 && candidate.height >= 512) {
      score += 6;
    }
  }

  if ((kind === "video" || kind === "audio") && isPositiveFinite(candidate.durationMs)) {
    score += Math.min(30, Math.log10(candidate.durationMs / 1_000 + 1) * 12);
  }

  return score;
}

function baseKindScore(kind: LocalMediaKind): number {
  switch (kind) {
    case "image":
      return 24;
    case "video":
      return 20;
    case "audio":
      return 16;
  }
}

interface RecencyBounds {
  readonly oldestMs: number;
  readonly newestMs: number;
}

function recencyBounds(values: readonly (number | undefined)[]): RecencyBounds | null {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) {
    return null;
  }
  return {
    oldestMs: Math.min(...finiteValues),
    newestMs: Math.max(...finiteValues),
  };
}

function recencyScore(modifiedAtMs: number | undefined, bounds: RecencyBounds | null): number {
  if (!isFiniteNumber(modifiedAtMs) || bounds === null) {
    return 0;
  }
  if (bounds.newestMs === bounds.oldestMs) {
    return 45;
  }
  return ((modifiedAtMs - bounds.oldestMs) / (bounds.newestMs - bounds.oldestMs)) * 90;
}

function compareRankedLocalMediaCandidates(
  left: RankedLocalMediaSearchCandidate,
  right: RankedLocalMediaSearchCandidate,
): number {
  return (
    right.score - left.score ||
    (right.modifiedAtMs ?? Number.NEGATIVE_INFINITY) -
      (left.modifiedAtMs ?? Number.NEGATIVE_INFINITY) ||
    left.path.localeCompare(right.path)
  );
}

function resolveCandidateExtension(
  candidate: LocalMediaSearchCandidate,
): CommonLocalMediaExtension | null {
  if (candidate.extension !== undefined) {
    const extension = normalizeLocalMediaExtension(candidate.extension);
    return extension !== null && isCommonLocalMediaExtension(extension) ? extension : null;
  }
  return extensionFromLocalMediaPath(candidate.path);
}

function fileNameFromPath(path: string): string {
  const segments = path.trim().replace(/\\/gu, "/").split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) return segment;
  }
  return "";
}

function folderSegmentsFromPath(path: string): string[] {
  const segments = path.trim().replace(/\\/gu, "/").split("/").filter(Boolean);
  return segments.slice(0, -1);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,8}$/iu, "");
}

function pathDepth(path: string): number {
  return path.trim().replace(/\\/gu, "/").split("/").filter(Boolean).length;
}

function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFinite(value: number | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function confidenceForRankedResult(
  score: number,
  bestScore: number | undefined,
  index: number,
): LocalMediaSearchResultConfidence {
  if (!isFiniteNumber(bestScore) || bestScore <= 0) {
    if (index === 0) return "high";
    if (index < 4) return "medium";
    return "low";
  }

  const ratio = score / bestScore;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.45) return "medium";
  return "low";
}

function toIsoTimestamp(value: number | undefined): string | undefined {
  if (!isFiniteNumber(value)) {
    return undefined;
  }
  return Option.map(DateTime.make(value), DateTime.formatIso).pipe(Option.getOrUndefined);
}

function roundScore(score: number): number {
  return Math.round(score * 1_000) / 1_000;
}
