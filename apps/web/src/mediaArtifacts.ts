export type MediaArtifactKind = "image" | "video" | "gif" | "unknown";
export type MediaArtifactSource = "generated" | "local" | "web" | "project";
export type MediaArtifactOrigin = "generated" | "found" | "attached";

export interface MediaArtifact {
  readonly id: string;
  readonly kind: MediaArtifactKind;
  readonly source: MediaArtifactSource;
  readonly title: string;
  readonly path?: string;
  readonly url?: string;
  readonly previewUrl?: string;
  readonly extension: string;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly modifiedAt?: string;
  readonly score?: number;
  readonly origin?: MediaArtifactOrigin;
  readonly mimeType?: string;
  readonly messageId?: string;
  readonly createdAt?: string;
}

export type LocalMediaSearchScopeKind =
  | "current-workspace"
  | "project"
  | "explicit-broad-pc"
  | "unknown";
export type LocalMediaSearchConfidence = "high" | "medium" | "low";

export interface LocalMediaSearchScopeRefinementModel {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scope: LocalMediaSearchScopeKind;
  readonly rootHints: readonly string[];
}

export interface LocalMediaSearchScopeModel {
  readonly kind: LocalMediaSearchScopeKind;
  readonly label: string;
  readonly detail?: string;
  readonly rootHints: readonly string[];
  readonly broadPc: boolean;
  readonly refinements: readonly LocalMediaSearchScopeRefinementModel[];
}

export interface LocalMediaSearchResultArtifact extends MediaArtifact {
  readonly rank: number;
  readonly confidence: LocalMediaSearchConfidence;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
}

export interface LocalMediaSearchResultSet {
  readonly id: string;
  readonly kind: "local-media-search-results";
  readonly query?: string;
  readonly scope: LocalMediaSearchScopeModel;
  readonly results: readonly LocalMediaSearchResultArtifact[];
  readonly total?: number;
  readonly generatedAt?: string;
}

export type LocalMediaSearchConfidenceTone = "strong" | "medium" | "muted";

export interface LocalMediaSearchResultDisplayModel {
  readonly artifact: LocalMediaSearchResultArtifact;
  readonly key: string;
  readonly rankLabel: string;
  readonly confidenceLabel: string;
  readonly confidenceTone: LocalMediaSearchConfidenceTone;
  readonly modifiedLabel?: string;
  readonly scoreLabel?: string;
}

export interface LocalMediaSearchResultSetDisplayModel {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly scopeLabel: string;
  readonly scopeDetail?: string;
  readonly scopeWarning?: string;
  readonly refinementLabel: string;
  readonly refinements: readonly LocalMediaSearchScopeRefinementModel[];
  readonly results: readonly LocalMediaSearchResultDisplayModel[];
}

export interface ThreadMediaArtifact extends MediaArtifact {
  readonly origin: MediaArtifactOrigin;
  readonly messageId: string;
  readonly createdAt: string;
  readonly dedupeKey: string;
}

interface ThreadMediaAttachmentInput {
  readonly type: "image" | "gif" | "video" | "file";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly previewUrl?: string | undefined;
}

export interface ThreadMediaMessageInput {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt?: string | undefined;
  readonly streaming?: boolean | undefined;
  readonly attachments?: ReadonlyArray<ThreadMediaAttachmentInput> | undefined;
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
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
]);
const GIF_EXTENSIONS = new Set(["gif"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogg", "ogv", "webm"]);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...GIF_EXTENSIONS, ...VIDEO_EXTENSIONS]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "opus", "wav", "weba"]);
const LOCAL_SEARCH_MEDIA_EXTENSIONS = new Set([...MEDIA_EXTENSIONS, ...AUDIO_EXTENSIONS]);

const MARKDOWN_ANGLE_LINK_RE =
  /\[[^\]]*?\]\(<(?<target>[^>\r\n]*?\.(?<ext>[a-z0-9]{2,5})(?:[#?][^>\r\n]*)?)>\)/giu;
const MARKDOWN_LINK_RE =
  /\[[^\]]*?\]\((?<target>[^)\s]+?\.(?<ext>[a-z0-9]{2,5})(?:[#?][^)]*)?)\)/giu;
const RAW_MEDIA_RE =
  /(?<target>(?:file:\/\/\/|https?:\/\/|[A-Za-z]:[\\/]|\.{1,2}[\\/]|[/\\]|[\w .@()[\]-]+[\\/])[^"'`<>\]\s]+?\.(?<ext>[a-z0-9]{2,5})(?:[#?][^\s"'`<>\]]*)?)/giu;
const LOCAL_MEDIA_SEARCH_TAG_RE =
  /<local_media_search_results\b[^>]*>(?<payload>[\s\S]*?)<\/local_media_search_results>/giu;
const LOCAL_MEDIA_SEARCH_FENCE_RE =
  /```(?:local-media-search-results|local_media_search_results)\s+(?<payload>[\s\S]*?)```/giu;
const JSON_CODE_FENCE_RE = /```(?:json|jsonc)\s+(?<payload>[\s\S]*?)```/giu;

export function mediaKindForExtension(extension: string): MediaArtifactKind {
  const normalized = normalizeMediaExtension(extension);
  if (GIF_EXTENSIONS.has(normalized)) return "gif";
  if (IMAGE_EXTENSIONS.has(normalized)) return "image";
  if (VIDEO_EXTENSIONS.has(normalized)) return "video";
  return "unknown";
}

export function normalizeMediaExtension(extension: string): string {
  return extension.toLowerCase().replace(/^\./, "");
}

export function isSupportedMediaExtension(extension: string): boolean {
  return MEDIA_EXTENSIONS.has(normalizeMediaExtension(extension));
}

export function isPreviewableMediaArtifactKind(kind: MediaArtifactKind): boolean {
  return kind === "image" || kind === "gif" || kind === "video";
}

export function isImageMediaArtifactKind(kind: MediaArtifactKind): boolean {
  return kind === "image" || kind === "gif";
}

export function basenameFromMediaTarget(target: string): string {
  const withoutQuery = target.split(/[?#]/, 1)[0] ?? target;
  const normalized = withoutQuery.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function extensionFromMediaTarget(target: string): string | null {
  const withoutQuery = target.split(/[?#]/, 1)[0] ?? target;
  const match = /\.([a-z0-9]{1,8})$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? null;
}

export function createMediaArtifact(input: {
  readonly id: string;
  readonly target: string;
  readonly source?: MediaArtifactSource;
  readonly title?: string;
  readonly extension?: string;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly modifiedAt?: string;
  readonly score?: number;
  readonly previewUrl?: string;
}): MediaArtifact | null {
  const extension = normalizeMediaExtension(
    input.extension ?? extensionFromMediaTarget(input.target) ?? "",
  );
  if (!isSupportedMediaExtension(extension)) {
    return null;
  }

  const isHttpUrl = /^https?:\/\//i.test(input.target);
  const filePath = input.target.startsWith("file:///")
    ? decodeFileUriPath(input.target)
    : input.target;
  const source = input.source ?? sourceForMediaTarget(input.target, isHttpUrl);

  return {
    id: input.id,
    kind: mediaKindForExtension(extension),
    source,
    title: input.title ?? basenameFromMediaTarget(input.target),
    extension,
    ...(isHttpUrl ? { url: input.target } : { path: filePath }),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.modifiedAt !== undefined ? { modifiedAt: input.modifiedAt } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.previewUrl !== undefined ? { previewUrl: input.previewUrl } : {}),
  };
}

export function extractMediaArtifactsFromText(text: string): MediaArtifact[] {
  const artifacts: MediaArtifact[] = [];
  const seenTargets = new Set<string>();
  const markdownLinkRanges: Array<readonly [number, number]> = [];

  const collect = (match: RegExpExecArray, options: { readonly markdownLink?: boolean } = {}) => {
    const groups = match.groups;
    const target = groups?.target?.trim();
    const extension = groups?.ext?.toLowerCase();
    if (!target || !extension || !isSupportedMediaExtension(extension)) return;

    const rawNormalizedTarget = target.replace(/^[(<]+|[)>]+$/g, "");
    const markdownTargetStart = rawNormalizedTarget.lastIndexOf("](");
    const markdownNormalizedTarget =
      markdownTargetStart >= 0
        ? rawNormalizedTarget.slice(markdownTargetStart + 2)
        : rawNormalizedTarget;
    const normalizedTarget = normalizeExtractedMediaTarget(markdownNormalizedTarget);
    if (seenTargets.has(normalizedTarget)) return;
    seenTargets.add(normalizedTarget);

    const artifact = createMediaArtifact({
      id: `media:${artifacts.length}:${normalizedTarget}`,
      target: normalizedTarget,
      extension,
      source: /^https?:\/\//i.test(normalizedTarget) ? "web" : "project",
    });
    if (artifact) {
      artifacts.push(artifact);
      if (options.markdownLink && match.index !== undefined) {
        markdownLinkRanges.push([match.index, match.index + match[0].length]);
      }
    }
  };

  for (const match of text.matchAll(MARKDOWN_ANGLE_LINK_RE)) {
    collect(match, { markdownLink: true });
  }
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    collect(match, { markdownLink: true });
  }
  for (const match of text.matchAll(RAW_MEDIA_RE)) {
    if (match.index !== undefined && isInsideRange(match.index, markdownLinkRanges)) {
      continue;
    }
    collect(match);
  }

  return artifacts;
}

export function normalizeMediaArtifact(value: unknown): MediaArtifact | null {
  const record = asRecord(value);
  if (!record) return null;

  const path = asNonEmptyString(record.path);
  const url = asNonEmptyString(record.url);
  const previewUrl = asNonEmptyString(record.previewUrl);
  const target = url ?? path ?? previewUrl;
  if (!target) return null;

  const extension = asNonEmptyString(record.extension) ?? extensionFromMediaTarget(target);
  if (!extension || !isSupportedMediaExtension(extension)) return null;

  const source = normalizeMediaArtifactSource(
    record.source,
    sourceForMediaTarget(target, Boolean(url)),
  );
  const id = asNonEmptyString(record.id) ?? `media:${source}:${target}`;
  const title = asNonEmptyString(record.title) ?? basenameFromMediaTarget(target);
  const sizeBytes = asNonNegativeFiniteNumber(record.sizeBytes);
  const width = asNonNegativeFiniteNumber(record.width);
  const height = asNonNegativeFiniteNumber(record.height);
  const durationMs = asNonNegativeFiniteNumber(record.durationMs);
  const score = asFiniteNumber(record.score);
  const modifiedAt = asNonEmptyString(record.modifiedAt);

  return {
    id,
    kind: mediaKindForExtension(extension),
    source,
    title,
    extension: normalizeMediaExtension(extension),
    ...(url ? { url } : path ? { path } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(sizeBytes !== null ? { sizeBytes } : {}),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(score !== null ? { score } : {}),
  };
}

export function normalizeMediaArtifacts(value: unknown): MediaArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeMediaArtifact(entry))
    .filter((entry): entry is MediaArtifact => entry !== null);
}

export function normalizeLocalMediaSearchResultSet(
  value: unknown,
): LocalMediaSearchResultSet | null {
  const record = asRecord(value);
  if (!record || !recordLooksLikeLocalMediaSearchResultSet(record)) {
    return null;
  }

  const entries = firstArrayValue(record, ["results", "items", "artifacts", "media", "matches"]);
  if (!entries) {
    return null;
  }

  const drafts = entries
    .map((entry, index) => normalizeLocalMediaSearchResultDraft(entry, index))
    .filter((entry): entry is LocalMediaSearchResultDraft => entry !== null);
  if (drafts.length === 0) {
    return null;
  }

  const sortedDrafts = drafts.toSorted(compareLocalMediaSearchResultDrafts);
  const bestScore = sortedDrafts.find((entry) => entry.score !== undefined)?.score;
  const results = sortedDrafts.map((draft, index) => {
    const { confidence, explicitRank, originalIndex, ...artifact } = draft;
    void explicitRank;
    void originalIndex;
    return {
      ...artifact,
      rank: index + 1,
      confidence: confidence ?? deriveLocalMediaSearchConfidence(artifact.score, bestScore, index),
    };
  });
  const query = asNonEmptyString(record.query) ?? asNonEmptyString(record.searchQuery);
  const rootHints = rootHintsFromRecord(record);
  const scope = normalizeLocalMediaSearchScope(record.scope ?? record.searchScope, {
    rootHints,
    broadPc: asBoolean(record.broadPc),
  });
  const total =
    asPositiveInteger(record.total) ??
    asPositiveInteger(record.totalResults) ??
    asPositiveInteger(record.totalCount);
  const generatedAt = normalizeTimestamp(record.generatedAt ?? record.createdAt);
  const id =
    asNonEmptyString(record.id) ??
    `local-media-search:${query ?? scope.label}:${results
      .map((artifact) => mediaArtifactDedupKey(artifact))
      .join("|")}`;

  return {
    id,
    kind: "local-media-search-results",
    ...(query ? { query } : {}),
    scope,
    results,
    ...(total !== null ? { total } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
}

export function normalizeLocalMediaSearchResultSets(value: unknown): LocalMediaSearchResultSet[] {
  const resultSets: LocalMediaSearchResultSet[] = [];
  const seenObjects = new Set<object>();

  const visit = (entry: unknown, depth: number) => {
    if (depth > 5) return;

    const parsed = typeof entry === "string" ? parseJsonPayload(entry) : null;
    if (parsed !== null) {
      visit(parsed, depth + 1);
      return;
    }

    const resultSet = normalizeLocalMediaSearchResultSet(entry);
    if (resultSet) {
      resultSets.push(resultSet);
      return;
    }

    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = asRecord(entry);
    if (!record || seenObjects.has(record)) {
      return;
    }
    seenObjects.add(record);

    for (const key of [
      "localMediaSearch",
      "localMediaSearchResults",
      "local_media_search",
      "local_media_search_results",
      "mediaSearch",
      "mediaSearchResults",
      "output",
      "result",
      "toolOutput",
    ]) {
      if (key in record) {
        visit(record[key], depth + 1);
      }
    }
  };

  visit(value, 0);
  return dedupeLocalMediaSearchResultSets(resultSets);
}

export function extractLocalMediaSearchResultSetsFromText(
  text: string,
): LocalMediaSearchResultSet[] {
  const resultSets: LocalMediaSearchResultSet[] = [];

  const collectPayload = (payload: string | undefined) => {
    if (!payload) return;
    resultSets.push(...extractLocalMediaSearchResultSetsFromJsonPayload(payload));
  };

  for (const match of text.matchAll(LOCAL_MEDIA_SEARCH_TAG_RE)) {
    collectPayload(match.groups?.payload);
  }
  for (const match of text.matchAll(LOCAL_MEDIA_SEARCH_FENCE_RE)) {
    collectPayload(match.groups?.payload);
  }
  for (const match of text.matchAll(JSON_CODE_FENCE_RE)) {
    collectPayload(match.groups?.payload);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    resultSets.push(...extractLocalMediaSearchResultSetsFromJsonPayload(trimmed));
  }

  return dedupeLocalMediaSearchResultSets(resultSets);
}

function extractLocalMediaSearchResultSetsFromJsonPayload(
  payload: string,
): LocalMediaSearchResultSet[] {
  const parsed = parseJsonPayload(payload);
  return parsed === null ? [] : normalizeLocalMediaSearchResultSets(parsed);
}

export function stripLocalMediaSearchResultSetsFromText(text: string): string {
  return text
    .replace(LOCAL_MEDIA_SEARCH_TAG_RE, "")
    .replace(LOCAL_MEDIA_SEARCH_FENCE_RE, "")
    .replace(JSON_CODE_FENCE_RE, (match: string, payload: string | undefined) =>
      payload && extractLocalMediaSearchResultSetsFromJsonPayload(payload).length > 0 ? "" : match,
    )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function buildLocalMediaSearchResultSetDisplayModel(
  resultSet: LocalMediaSearchResultSet,
): LocalMediaSearchResultSetDisplayModel {
  const resultCount = resultSet.results.length;
  const total = resultSet.total ?? resultCount;
  const resultLabel = `${resultCount.toLocaleString()} ${pluralize("result", resultCount)}`;
  const totalLabel = total > resultCount ? `of ${total.toLocaleString()}` : "";
  const queryLabel = resultSet.query ? ` for "${resultSet.query}"` : "";
  const summary = [resultLabel, totalLabel, `in ${resultSet.scope.label}`]
    .filter(Boolean)
    .join(" ");

  return {
    id: resultSet.id,
    title: `Local media results${queryLabel}`,
    summary,
    scopeLabel: resultSet.scope.label,
    ...(resultSet.scope.detail ? { scopeDetail: resultSet.scope.detail } : {}),
    ...(resultSet.scope.broadPc
      ? {
          scopeWarning:
            "Broad PC scope can include personal folders and files outside this workspace. Refine before opening sensitive paths.",
        }
      : {}),
    refinementLabel: resultSet.scope.broadPc ? "Refine broad scope" : "Refine search scope",
    refinements: resultSet.scope.refinements,
    results: resultSet.results.map((artifact) => ({
      artifact,
      key: `${artifact.rank}:${mediaArtifactDedupKey(artifact)}`,
      rankLabel: `#${artifact.rank}`,
      confidenceLabel: localMediaSearchConfidenceLabel(artifact.confidence),
      confidenceTone: localMediaSearchConfidenceTone(artifact.confidence),
      ...(formatLocalMediaSearchModifiedAt(artifact.modifiedAt)
        ? { modifiedLabel: formatLocalMediaSearchModifiedAt(artifact.modifiedAt)! }
        : {}),
      ...(formatLocalMediaSearchScore(artifact.score)
        ? { scoreLabel: formatLocalMediaSearchScore(artifact.score)! }
        : {}),
    })),
  };
}

export function localMediaSearchConfidenceLabel(confidence: LocalMediaSearchConfidence): string {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
  }
}

export function localMediaSearchConfidenceTone(
  confidence: LocalMediaSearchConfidence,
): LocalMediaSearchConfidenceTone {
  switch (confidence) {
    case "high":
      return "strong";
    case "medium":
      return "medium";
    case "low":
      return "muted";
  }
}

export function formatLocalMediaSearchModifiedAt(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
}

function formatLocalMediaSearchScore(score: number | undefined): string | null {
  if (score === undefined || !Number.isFinite(score)) {
    return null;
  }
  const rounded =
    Math.abs(score) >= 10 ? Math.round(score).toString() : score.toFixed(2).replace(/\.?0+$/u, "");
  return `Score ${rounded}`;
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

export function normalizeLocalMediaSearchScope(
  value: unknown,
  fallback: {
    readonly rootHints?: readonly string[] | undefined;
    readonly broadPc?: boolean | undefined;
  } = {},
): LocalMediaSearchScopeModel {
  const record = asRecord(value);
  const stringValue = asNonEmptyString(value);
  const kind = normalizeLocalMediaSearchScopeKind(
    stringValue ??
      asNonEmptyString(record?.kind) ??
      asNonEmptyString(record?.scope) ??
      asNonEmptyString(record?.type),
    fallback.broadPc,
  );
  const rootHints = dedupeStrings([...rootHintsFromRecord(record), ...(fallback.rootHints ?? [])]);
  const broadPc = asBoolean(record?.broadPc) ?? fallback.broadPc ?? kind === "explicit-broad-pc";
  const label = asNonEmptyString(record?.label) ?? defaultLocalMediaSearchScopeLabel(kind, broadPc);
  const detail =
    asNonEmptyString(record?.detail) ??
    asNonEmptyString(record?.description) ??
    (rootHints.length > 0 ? rootHints.join(", ") : undefined);
  const refinements = normalizeLocalMediaSearchScopeRefinements(record?.refinements);

  return {
    kind: broadPc ? "explicit-broad-pc" : kind,
    label,
    ...(detail ? { detail } : {}),
    rootHints,
    broadPc,
    refinements:
      refinements.length > 0
        ? refinements
        : defaultLocalMediaSearchScopeRefinements(broadPc ? "explicit-broad-pc" : kind, rootHints),
  };
}

export function collectThreadMediaArtifacts(
  messages: ReadonlyArray<ThreadMediaMessageInput>,
): ThreadMediaArtifact[] {
  const latestByKey = new Map<string, ThreadMediaArtifact>();

  for (const message of messages) {
    const createdAt = message.updatedAt ?? message.createdAt;
    if (message.role === "assistant" && !message.streaming && message.text) {
      const localSearchResultSets = extractLocalMediaSearchResultSetsFromText(message.text);
      const visibleText = stripLocalMediaSearchResultSetsFromText(message.text);

      for (const resultSet of localSearchResultSets) {
        for (const artifact of resultSet.results) {
          upsertLatestArtifact(latestByKey, {
            ...artifact,
            id: `thread-media:${message.id}:${resultSet.id}:${artifact.id}`,
            origin: "found",
            messageId: message.id,
            createdAt,
            dedupeKey: mediaArtifactDedupKey(artifact),
          });
        }
      }

      for (const artifact of extractMediaArtifactsFromText(visibleText)) {
        upsertLatestArtifact(latestByKey, {
          ...artifact,
          id: `thread-media:${message.id}:${artifact.id}`,
          origin: artifact.source === "generated" ? "generated" : "found",
          messageId: message.id,
          createdAt,
          dedupeKey: mediaArtifactDedupKey(artifact),
        });
      }
    }

    for (const attachment of message.attachments ?? []) {
      const artifact = mediaArtifactFromAttachment(message, attachment);
      if (artifact) {
        upsertLatestArtifact(latestByKey, artifact);
      }
    }
  }

  return [...latestByKey.values()].toSorted((left, right) => {
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    return byCreatedAt === 0 ? right.title.localeCompare(left.title) : byCreatedAt;
  });
}

export function mediaArtifactReference(artifact: MediaArtifact): string {
  return artifact.path ?? artifact.url ?? artifact.previewUrl ?? artifact.title;
}

export function isImageLikeMediaArtifact(artifact: Pick<MediaArtifact, "kind">): boolean {
  return artifact.kind === "image" || artifact.kind === "gif";
}

export function isGeneratedMediaTarget(target: string): boolean {
  const normalized = target.replace(/\\/g, "/").toLowerCase();
  return /(?:^|\/)\.kamicode\/generated-media(?:\/|$)/u.test(normalized);
}

export function isLocalFilesystemMediaPath(target: string): boolean {
  return /^(?:file:\/\/\/|[A-Za-z]:[\\/]|[/\\])/i.test(target.trim());
}

export function mediaArtifactCanReveal(
  artifact: MediaArtifact,
  desktopLocalMediaRevealAvailable: boolean,
): boolean {
  return Boolean(
    desktopLocalMediaRevealAvailable && artifact.path && isLocalFilesystemMediaPath(artifact.path),
  );
}

export function mediaArtifactExternalTarget(
  artifact: MediaArtifact,
  previewUrl: string | null | undefined,
  options: { readonly desktopBridgeAvailable: boolean },
): string | null {
  if (artifact.url && isSafeBrowserExternalUrl(artifact.url)) {
    return artifact.url;
  }

  void options.desktopBridgeAvailable;

  if (previewUrl && isSafeBrowserExternalUrl(previewUrl)) {
    return previewUrl;
  }

  return null;
}

export function localFilesystemPathToFileUrl(target: string): string {
  const trimmed = target.trim();
  if (/^file:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\\/g, "/");
  if (/^\/\/[^/]+\/[^/]+/.test(normalized)) {
    return `file:${encodePathname(normalized)}`;
  }
  return `file://${encodePathname(normalized.startsWith("/") ? normalized : `/${normalized}`)}`;
}

export function mediaArtifactDedupKey(artifact: MediaArtifact): string {
  const target = artifact.path ?? artifact.url ?? artifact.previewUrl;
  if (target) {
    return canonicalMediaTargetKey(target);
  }
  return [
    "attachment",
    artifact.title.trim().toLowerCase(),
    artifact.mimeType?.trim().toLowerCase() ?? "",
    artifact.sizeBytes?.toString() ?? "",
  ].join(":");
}

function mediaArtifactFromAttachment(
  message: ThreadMediaMessageInput,
  attachment: ThreadMediaAttachmentInput,
): ThreadMediaArtifact | null {
  const extension = extensionFromAttachment(attachment);
  const kind = mediaKindForAttachment(attachment, extension);
  const base: MediaArtifact = {
    id: `attachment:${message.id}:${attachment.id}`,
    kind,
    source: "local",
    origin: "attached",
    title: attachment.name,
    extension,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.width !== undefined ? { width: attachment.width } : {}),
    ...(attachment.height !== undefined ? { height: attachment.height } : {}),
    ...(attachment.durationMs !== undefined ? { durationMs: attachment.durationMs } : {}),
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
  return {
    ...base,
    origin: "attached",
    messageId: message.id,
    createdAt: message.updatedAt ?? message.createdAt,
    dedupeKey: `attachment:${attachment.id}:${mediaArtifactDedupKey(base)}`,
  };
}

function mediaKindForAttachment(
  attachment: Pick<ThreadMediaAttachmentInput, "mimeType" | "type">,
  extension: string,
): MediaArtifactKind {
  const mimeType = attachment.mimeType.toLowerCase();
  if (attachment.type === "gif" || mimeType === "image/gif") return "gif";
  if (attachment.type === "video" || mimeType.startsWith("video/")) return "video";
  if (attachment.type === "image" || mimeType.startsWith("image/")) {
    const extensionKind = mediaKindForExtension(extension);
    return extensionKind === "unknown" ? "image" : extensionKind;
  }
  if (attachment.type === "file") return mediaKindForExtension(extension);
  return "unknown";
}

function extensionFromAttachment(
  attachment: Pick<ThreadMediaAttachmentInput, "name" | "mimeType" | "type">,
) {
  const nameExtension = extensionFromMediaTarget(attachment.name);
  if (nameExtension) {
    return nameExtension;
  }

  switch (attachment.mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "video/ogg":
      return "ogg";
    default:
      return attachment.mimeType.split("/", 2)[1]?.split("+", 1)[0] ?? attachment.type;
  }
}

function decodeFileUriPath(uri: string): string {
  try {
    const url = new URL(uri);
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1).replace(/\//g, "\\");
    }
    return pathname;
  } catch {
    return uri;
  }
}

function isSafeBrowserExternalUrl(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function encodePathname(pathname: string): string {
  const encoded = pathname
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return encoded.replace(/^\/([A-Za-z])%3A\//u, "/$1:/");
}

function normalizeProsePrefixedTarget(target: string): string {
  if (/^(?:https?:\/\/|file:\/\/\/|[A-Za-z]:[\\/]|\.{1,2}[\\/]|[/\\])/i.test(target)) {
    return target;
  }
  const firstSeparator = target.search(/[\\/]/);
  if (firstSeparator <= 0) return target;
  const prefix = target.slice(0, firstSeparator);
  const lastWhitespace = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\t"));
  return lastWhitespace >= 0 ? target.slice(lastWhitespace + 1) : target;
}

function normalizeExtractedMediaTarget(target: string): string {
  const normalized = normalizeProsePrefixedTarget(target);
  const decoded = isLocalFilesystemMediaPath(normalized)
    ? safeDecodeMediaTarget(normalized)
    : normalized;
  return decoded.replace(/^\/([A-Za-z]:[\\/])/u, "$1");
}

function safeDecodeMediaTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function isInsideRange(index: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function sourceForMediaTarget(target: string, isHttpUrl: boolean): MediaArtifactSource {
  if (isHttpUrl) return "web";
  return isGeneratedMediaTarget(target) ? "generated" : "project";
}

function canonicalMediaTargetKey(target: string): string {
  const withoutQuery = target.split(/[?#]/, 1)[0] ?? target;
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  if (decoded.startsWith("file:///")) {
    const artifact = createMediaArtifact({
      id: "canonical",
      target: decoded,
      extension: extensionFromMediaTarget(decoded) ?? "",
    });
    decoded = artifact?.path ?? decoded;
  }
  return decoded.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function upsertLatestArtifact(
  latestByKey: Map<string, ThreadMediaArtifact>,
  artifact: ThreadMediaArtifact,
) {
  const existing = latestByKey.get(artifact.dedupeKey);
  if (!existing || artifact.createdAt.localeCompare(existing.createdAt) >= 0) {
    latestByKey.set(artifact.dedupeKey, artifact);
  }
}

interface LocalMediaSearchResultDraft extends Omit<
  LocalMediaSearchResultArtifact,
  "confidence" | "rank"
> {
  readonly confidence?: LocalMediaSearchConfidence;
  readonly explicitRank: number | null;
  readonly originalIndex: number;
}

function normalizeLocalMediaSearchResultDraft(
  value: unknown,
  originalIndex: number,
): LocalMediaSearchResultDraft | null {
  const record = asRecord(value);
  if (!record) return null;

  const url = asNonEmptyString(record.url);
  const rawTarget =
    url ??
    firstNonEmptyString([
      record.path,
      record.filePath,
      record.absolutePath,
      record.relativePath,
      record.target,
      record.uri,
    ]);
  if (!rawTarget) return null;

  const extension = normalizeMediaExtension(
    asNonEmptyString(record.extension) ?? extensionFromMediaTarget(rawTarget) ?? "",
  );
  if (!isSupportedLocalSearchMediaExtension(extension)) {
    return null;
  }

  const isHttpUrl = /^https?:\/\//i.test(rawTarget);
  const filePath = rawTarget.startsWith("file:///") ? decodeFileUriPath(rawTarget) : rawTarget;
  const previewUrl = firstNonEmptyString([
    record.previewUrl,
    record.thumbnailUrl,
    record.thumbnail,
    record.posterUrl,
  ]);
  const sizeBytes = asNonNegativeFiniteNumberLike(record.sizeBytes);
  const width = asNonNegativeFiniteNumberLike(record.width);
  const height = asNonNegativeFiniteNumberLike(record.height);
  const durationMs = asNonNegativeFiniteNumberLike(record.durationMs);
  const score =
    asFiniteNumberLike(record.score) ??
    asFiniteNumberLike(record.rankingScore) ??
    asFiniteNumberLike(record.confidenceScore);
  const confidence = normalizeLocalMediaSearchConfidence(record.confidence);
  const modifiedAt = normalizeTimestamp(
    record.modifiedAt ?? record.modified_at ?? record.modifiedAtMs ?? record.mtimeMs,
  );

  return {
    id: asNonEmptyString(record.id) ?? `local-media:${rawTarget}`,
    kind: mediaKindForExtension(extension),
    source: normalizeMediaArtifactSource(record.source, isHttpUrl ? "web" : "local"),
    title:
      asNonEmptyString(record.title) ??
      asNonEmptyString(record.name) ??
      basenameFromMediaTarget(rawTarget),
    extension,
    ...(isHttpUrl ? { url: rawTarget } : { path: filePath }),
    ...(previewUrl ? { previewUrl } : {}),
    ...(sizeBytes !== null ? { sizeBytes } : {}),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(score !== null ? { score } : {}),
    ...(confidence ? { confidence } : {}),
    explicitRank:
      asPositiveInteger(record.rank) ??
      asPositiveInteger(record.position) ??
      asPositiveInteger(record.index),
    originalIndex,
  };
}

function compareLocalMediaSearchResultDrafts(
  left: LocalMediaSearchResultDraft,
  right: LocalMediaSearchResultDraft,
): number {
  const leftRank = left.explicitRank ?? Number.POSITIVE_INFINITY;
  const rightRank = right.explicitRank ?? Number.POSITIVE_INFINITY;
  return (
    leftRank - rightRank ||
    (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY) ||
    (right.modifiedAt ?? "").localeCompare(left.modifiedAt ?? "") ||
    left.originalIndex - right.originalIndex
  );
}

function deriveLocalMediaSearchConfidence(
  score: number | undefined,
  bestScore: number | undefined,
  index: number,
): LocalMediaSearchConfidence {
  if (score !== undefined && bestScore !== undefined && bestScore > 0) {
    const ratio = score / bestScore;
    if (ratio >= 0.75) return "high";
    if (ratio >= 0.45) return "medium";
    return "low";
  }
  if (index === 0) return "high";
  if (index < 4) return "medium";
  return "low";
}

function isSupportedLocalSearchMediaExtension(extension: string): boolean {
  return LOCAL_SEARCH_MEDIA_EXTENSIONS.has(normalizeMediaExtension(extension));
}

function normalizeLocalMediaSearchConfidence(
  value: unknown,
): LocalMediaSearchConfidence | undefined {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  switch (normalized) {
    case "high":
    case "medium":
    case "low":
      return normalized;
    default:
      return undefined;
  }
}

function recordLooksLikeLocalMediaSearchResultSet(record: Record<string, unknown>): boolean {
  const tag = normalizeLooseToken(
    asNonEmptyString(record.kind) ??
      asNonEmptyString(record.type) ??
      asNonEmptyString(record._tag) ??
      asNonEmptyString(record.tag) ??
      "",
  );
  if (
    tag === "localmediasearchresults" ||
    tag === "localmediasearch" ||
    tag === "mediasearchresults"
  ) {
    return true;
  }

  return (
    firstArrayValue(record, ["results", "items", "artifacts", "media", "matches"]) !== null &&
    (record.scope !== undefined ||
      record.searchScope !== undefined ||
      record.query !== undefined ||
      record.searchQuery !== undefined ||
      record.rootHints !== undefined ||
      record.broadPc !== undefined)
  );
}

function normalizeLocalMediaSearchScopeKind(
  value: string | null,
  fallbackBroadPc: boolean | undefined,
): LocalMediaSearchScopeKind {
  const token = normalizeLooseToken(value ?? "");
  if (
    token === "currentworkspace" ||
    token === "workspace" ||
    token === "cwd" ||
    token === "currentproject"
  ) {
    return "current-workspace";
  }
  if (token === "project" || token === "projectroot" || token === "repository") {
    return "project";
  }
  if (
    token === "explicitbroadpc" ||
    token === "broadpc" ||
    token === "pc" ||
    token === "computer" ||
    token === "alllocaldrives" ||
    token === "entirepc"
  ) {
    return "explicit-broad-pc";
  }
  return fallbackBroadPc ? "explicit-broad-pc" : "unknown";
}

function defaultLocalMediaSearchScopeLabel(
  kind: LocalMediaSearchScopeKind,
  broadPc: boolean,
): string {
  if (broadPc || kind === "explicit-broad-pc") return "Broad PC search";
  switch (kind) {
    case "current-workspace":
      return "Current workspace";
    case "project":
      return "Project";
    case "unknown":
      return "Local media search";
  }
}

function defaultLocalMediaSearchScopeRefinements(
  kind: LocalMediaSearchScopeKind,
  rootHints: readonly string[],
): LocalMediaSearchScopeRefinementModel[] {
  if (kind === "explicit-broad-pc") {
    return [
      {
        id: "current-workspace",
        label: "Current workspace",
        description: "Narrow results to the active workspace.",
        scope: "current-workspace",
        rootHints: [],
      },
      ...rootHints.map((rootHint, index) => ({
        id: `root-${index}`,
        label: basenameFromMediaTarget(rootHint) || rootHint,
        description: `Limit results to ${rootHint}.`,
        scope: "explicit-broad-pc" as const,
        rootHints: [rootHint],
      })),
      {
        id: "choose-folder",
        label: "Choose folder",
        description: "Refine the broad PC search to a specific folder.",
        scope: "explicit-broad-pc",
        rootHints: [],
      },
    ];
  }

  return [
    {
      id: "broaden-to-pc",
      label: "Broaden to PC",
      description: "Search common local media folders outside this scope.",
      scope: "explicit-broad-pc",
      rootHints: rootHints.length > 0 ? rootHints : [],
    },
    {
      id: "choose-folder",
      label: "Choose folder",
      description: "Refine the search to a specific local folder.",
      scope: kind,
      rootHints: [],
    },
  ];
}

function normalizeLocalMediaSearchScopeRefinements(
  value: unknown,
): LocalMediaSearchScopeRefinementModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): LocalMediaSearchScopeRefinementModel[] => {
    const record = asRecord(entry);
    const label = asNonEmptyString(entry) ?? asNonEmptyString(record?.label);
    if (!label) return [];
    const scopeRecord = asRecord(record?.scope);
    const scope = normalizeLocalMediaSearchScopeKind(
      asNonEmptyString(record?.scope) ??
        asNonEmptyString(record?.kind) ??
        asNonEmptyString(scopeRecord?.scope) ??
        asNonEmptyString(scopeRecord?.kind),
      asBoolean(record?.broadPc) ?? asBoolean(scopeRecord?.broadPc),
    );
    const rootHints = dedupeStrings([
      ...rootHintsFromRecord(record),
      ...rootHintsFromRecord(scopeRecord),
    ]);
    const description = asNonEmptyString(record?.description);
    const normalizedLabelId = normalizeLooseToken(label);
    const id = asNonEmptyString(record?.id) ?? (normalizedLabelId || `refinement-${index}`);
    return [
      {
        id,
        label,
        ...(description ? { description } : {}),
        scope,
        rootHints,
      },
    ];
  });
}

function rootHintsFromRecord(record: Record<string, unknown> | null): string[] {
  if (!record) return [];
  return dedupeStrings([
    ...asStringArray(record.rootHints),
    ...asStringArray(record.roots),
    ...asStringArray(record.rootPaths),
    ...asStringArray(record.searchRoots),
    ...asStringArray(record.root),
    ...asStringArray(record.rootPath),
    ...asStringArray(record.projectRoot),
  ]);
}

function firstArrayValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): readonly unknown[] | null {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function firstNonEmptyString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const string = asNonEmptyString(value);
    if (string) return string;
  }
  return null;
}

function parseJsonPayload(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: unknown): string | null {
  const numericValue = asFiniteNumberLike(value);
  if (numericValue !== null) {
    const date = new Date(numericValue);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const stringValue = asNonEmptyString(value);
  if (!stringValue) return null;
  const parsed = Date.parse(stringValue);
  return Number.isNaN(parsed) ? stringValue : new Date(parsed).toISOString();
}

function dedupeLocalMediaSearchResultSets(
  resultSets: readonly LocalMediaSearchResultSet[],
): LocalMediaSearchResultSet[] {
  const seen = new Set<string>();
  const deduped: LocalMediaSearchResultSet[] = [];
  for (const resultSet of resultSets) {
    if (seen.has(resultSet.id)) continue;
    seen.add(resultSet.id);
    deduped.push(resultSet);
  }
  return deduped;
}

function normalizeLooseToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const string = asNonEmptyString(entry);
      return string ? [string] : [];
    });
  }
  const string = asNonEmptyString(value);
  return string ? [string] : [];
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asFiniteNumberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/u.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function asNonNegativeFiniteNumberLike(value: unknown): number | null {
  const number = asFiniteNumberLike(value);
  return number !== null && number >= 0 ? number : null;
}

function asPositiveInteger(value: unknown): number | null {
  const number = asFiniteNumberLike(value);
  return number !== null && number > 0 ? Math.trunc(number) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegativeFiniteNumber(value: unknown): number | null {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizeMediaArtifactSource(
  value: unknown,
  fallback: MediaArtifactSource,
): MediaArtifactSource {
  switch (value) {
    case "generated":
    case "local":
    case "project":
    case "web":
      return value;
    default:
      return fallback;
  }
}
