import { describe, expect, it } from "@effect/vitest";

import {
  buildLocalMediaSearchResultSet,
  DEFAULT_LOCAL_MEDIA_SEARCH_SCOPE,
  describeLocalMediaSearchScope,
  extensionFromLocalMediaPath,
  isCommonLocalMediaExtension,
  isExplicitBroadPcLocalMediaSearchScope,
  mediaKindForLocalExtension,
  rankLocalMediaCandidates,
  withDefaultLocalMediaSearchScope,
  type ExplicitBroadPcLocalMediaSearchScope,
} from "./localMediaSearch.ts";

describe("localMediaSearch", () => {
  it("classifies safe common media extensions", () => {
    expect(extensionFromLocalMediaPath("assets/Hero Shot.WEBP")).toBe("webp");
    expect(extensionFromLocalMediaPath("assets/archive.tar.gz")).toBeNull();
    expect(isCommonLocalMediaExtension(".mp4")).toBe(true);
    expect(isCommonLocalMediaExtension(".exe")).toBe(false);
    expect(mediaKindForLocalExtension("png")).toBe("image");
    expect(mediaKindForLocalExtension(".mp3")).toBe("audio");
    expect(mediaKindForLocalExtension("webm")).toBe("video");
  });

  it("defaults local search scope to the current workspace and makes broad PC scope explicit", () => {
    expect(withDefaultLocalMediaSearchScope()).toEqual(DEFAULT_LOCAL_MEDIA_SEARCH_SCOPE);

    const scope: ExplicitBroadPcLocalMediaSearchScope = {
      scope: "explicit-broad-pc",
      rootHints: ["C:/Users/example/Pictures"],
    };

    expect(isExplicitBroadPcLocalMediaSearchScope(scope)).toBe(true);
  });

  it("ranks exact filename matches ahead of newer weaker matches", () => {
    const ranked = rankLocalMediaCandidates(
      [
        {
          path: "assets/hero.png",
          modifiedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
          sizeBytes: 1_024,
          width: 800,
          height: 600,
        },
        {
          path: "assets/newest-hero.png",
          modifiedAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
          sizeBytes: 1_024,
          width: 800,
          height: 600,
        },
        {
          path: "assets/hero.txt",
          modifiedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
        },
      ],
      { query: "hero" },
    );

    expect(ranked.map((candidate) => candidate.path)).toEqual([
      "assets/hero.png",
      "assets/newest-hero.png",
    ]);
    expect(ranked[0]).toMatchObject({
      extension: "png",
      kind: "image",
    });
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("uses recency as the tiebreaker for equally relevant filenames", () => {
    const ranked = rankLocalMediaCandidates(
      [
        {
          path: "a/logo.png",
          modifiedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
        },
        {
          path: "b/logo.png",
          modifiedAtMs: Date.parse("2026-03-01T00:00:00.000Z"),
        },
      ],
      { query: "logo" },
    );

    expect(ranked.map((candidate) => candidate.path)).toEqual(["b/logo.png", "a/logo.png"]);
  });

  it("builds UI-ready ranked local search result sets with scope and confidence cues", () => {
    const resultSet = buildLocalMediaSearchResultSet({
      query: "hero",
      scope: {
        scope: "explicit-broad-pc",
        rootHints: ["C:/Users/example/Pictures", "D:/Media"],
      },
      candidates: [
        {
          path: "D:/Media/old-hero.png",
          modifiedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
          width: 640,
          height: 480,
        },
        {
          path: "C:/Users/example/Pictures/hero.png",
          modifiedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
          width: 1600,
          height: 900,
        },
      ],
    });

    expect(resultSet).toMatchObject({
      kind: "local-media-search-results",
      query: "hero",
      total: 2,
      scope: {
        kind: "explicit-broad-pc",
        label: "Broad PC search",
        broadPc: true,
        rootHints: ["C:/Users/example/Pictures", "D:/Media"],
      },
    });
    expect(resultSet.scope.refinements.map((refinement) => refinement.label)).toEqual([
      "Current workspace",
      "Pictures",
      "Media",
    ]);
    expect(resultSet.results[0]).toMatchObject({
      rank: 1,
      title: "hero.png",
      confidence: "high",
      modifiedAt: "2026-05-01T00:00:00.000Z",
      kind: "image",
      extension: "png",
    });
    expect(resultSet.results[0]!.score).toBeGreaterThan(resultSet.results[1]!.score);
  });

  it("describes scoped workspace searches as refinable without implying a broad PC scan", () => {
    expect(describeLocalMediaSearchScope({ scope: "current-workspace" })).toMatchObject({
      label: "Current workspace",
      broadPc: false,
      refinements: [
        {
          id: "broaden-to-pc",
          label: "Broaden to PC",
          scope: { scope: "explicit-broad-pc" },
        },
      ],
    });
  });
});
