import { describe, expect, it } from "@effect/vitest";

import {
  buildLocalMediaSearchResultSetDisplayModel,
  collectThreadMediaArtifacts,
  extractLocalMediaSearchResultSetsFromText,
  extractMediaArtifactsFromText,
  mediaKindForExtension,
  normalizeLocalMediaSearchResultSet,
  stripLocalMediaSearchResultSetsFromText,
} from "./mediaArtifacts";

describe("mediaArtifacts", () => {
  it("extracts raw local media paths", () => {
    const artifacts = extractMediaArtifactsFromText(
      String.raw`Saved output: C:\dev\project\media\hero-image.png`,
    );

    expect(artifacts).toMatchObject([
      {
        kind: "image",
        title: "hero-image.png",
        path: String.raw`C:\dev\project\media\hero-image.png`,
      },
    ]);
  });

  it("extracts markdown media links and dedupes the same target", () => {
    const artifacts = extractMediaArtifactsFromText(
      "Open [demo](assets/demo.mp4) or assets/demo.mp4",
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "video",
      title: "demo.mp4",
      path: "assets/demo.mp4",
    });
  });

  it("classifies gif separately from still images", () => {
    expect(mediaKindForExtension("gif")).toBe("gif");
    expect(mediaKindForExtension(".webp")).toBe("image");
    expect(mediaKindForExtension("mov")).toBe("video");
    expect(mediaKindForExtension("pdf")).toBe("file");
    expect(mediaKindForExtension(".xlsx")).toBe("file");
  });

  it("extracts document and spreadsheet links as file artifacts", () => {
    const artifacts = extractMediaArtifactsFromText(
      "Review docs/report.pdf and [budget](reports/budget.xlsx).",
    );

    expect(artifacts).toMatchObject([
      {
        kind: "file",
        title: "budget.xlsx",
        path: "reports/budget.xlsx",
      },
      {
        kind: "file",
        title: "report.pdf",
        path: "docs/report.pdf",
      },
    ]);
  });

  it("normalizes file URI media links as local paths", () => {
    const artifacts = extractMediaArtifactsFromText(
      "See [shot](file:///C:/dev/project/screens/final%20shot.webp)",
    );

    expect(artifacts[0]).toMatchObject({
      source: "project",
      path: String.raw`C:\dev\project\screens\final shot.webp`,
    });
  });

  it("extracts angle-wrapped markdown media links with spaces in Windows paths", () => {
    const artifacts = extractMediaArtifactsFromText(
      "Saved here: [2026-07-02-268b-leak-linkedin-gpt-image-2.png](</C:/Users/THIS PC/T3 Projects/Camie AI/Camie AI Marketing/output/imagegen/2026-07-02-268b-leak-linkedin-gpt-image-2.png>)",
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "image",
      title: "2026-07-02-268b-leak-linkedin-gpt-image-2.png",
      path: "C:/Users/THIS PC/T3 Projects/Camie AI/Camie AI Marketing/output/imagegen/2026-07-02-268b-leak-linkedin-gpt-image-2.png",
    });
  });

  it("collects and dedupes thread media from assistant text and user attachments", () => {
    const artifacts = collectThreadMediaArtifacts([
      {
        id: "user-1",
        role: "user",
        text: "Use this as reference",
        createdAt: "2026-06-26T10:00:00.000Z",
        attachments: [
          {
            type: "image",
            id: "attachment-1",
            name: "reference.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            previewUrl: "blob:reference",
          },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: String.raw`Saved output: C:\dev\project\media\hero.png`,
        createdAt: "2026-06-26T10:01:00.000Z",
        updatedAt: "2026-06-26T10:01:10.000Z",
        streaming: false,
      },
      {
        id: "assistant-2",
        role: "assistant",
        text: "Same asset again: file:///C:/dev/project/media/hero.png",
        createdAt: "2026-06-26T10:02:00.000Z",
        updatedAt: "2026-06-26T10:02:10.000Z",
        streaming: false,
      },
    ]);

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      title: "hero.png",
      origin: "found",
      messageId: "assistant-2",
      path: String.raw`C:\dev\project\media\hero.png`,
    });
    expect(artifacts[1]).toMatchObject({
      title: "reference.png",
      origin: "attached",
      source: "local",
      previewUrl: "blob:reference",
      mimeType: "image/png",
      sizeBytes: 1024,
    });
  });

  it("does not collect media links from streaming assistant text", () => {
    const artifacts = collectThreadMediaArtifacts([
      {
        id: "assistant-streaming",
        role: "assistant",
        text: String.raw`Writing output to C:\dev\project\media\partial.png`,
        createdAt: "2026-06-26T10:00:00.000Z",
        streaming: true,
      },
      {
        id: "assistant-settled",
        role: "assistant",
        text: String.raw`Saved output: C:\dev\project\media\final.png`,
        createdAt: "2026-06-26T10:01:00.000Z",
        streaming: false,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      title: "final.png",
      messageId: "assistant-settled",
      path: String.raw`C:\dev\project\media\final.png`,
    });
  });

  it("collects gif, video, and file attachment metadata", () => {
    const artifacts = collectThreadMediaArtifacts([
      {
        id: "user-1",
        role: "user",
        text: "Mixed attachments",
        createdAt: "2026-06-26T10:00:00.000Z",
        attachments: [
          {
            type: "gif",
            id: "attachment-gif",
            name: "reaction.gif",
            mimeType: "image/gif",
            sizeBytes: 2048,
            previewUrl: "blob:reaction",
          },
          {
            type: "video",
            id: "attachment-video",
            name: "walkthrough",
            mimeType: "video/mp4",
            sizeBytes: 4096,
            previewUrl: "blob:walkthrough",
          },
          {
            type: "file",
            id: "attachment-file",
            name: "notes.pdf",
            mimeType: "application/pdf",
            sizeBytes: 512,
          },
        ],
      },
    ]);

    expect(artifacts).toHaveLength(3);
    expect(artifacts.find((artifact) => artifact.title === "reaction.gif")).toMatchObject({
      kind: "gif",
      origin: "attached",
      source: "local",
      extension: "gif",
      previewUrl: "blob:reaction",
      mimeType: "image/gif",
      sizeBytes: 2048,
    });
    expect(artifacts.find((artifact) => artifact.title === "walkthrough")).toMatchObject({
      kind: "video",
      origin: "attached",
      source: "local",
      extension: "mp4",
      previewUrl: "blob:walkthrough",
      mimeType: "video/mp4",
      sizeBytes: 4096,
    });
    const fileArtifact = artifacts.find((artifact) => artifact.title === "notes.pdf");
    expect(fileArtifact).toMatchObject({
      kind: "file",
      origin: "attached",
      source: "local",
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 512,
    });
    expect(fileArtifact).not.toHaveProperty("previewUrl");
  });

  it("normalizes ranked local media search result sets for display", () => {
    const resultSet = normalizeLocalMediaSearchResultSet({
      kind: "local-media-search-results",
      query: "hero",
      scope: {
        kind: "explicit-broad-pc",
        label: "Broad PC search",
        detail: String.raw`C:\Users\camie\Pictures`,
        rootHints: [String.raw`C:\Users\camie\Pictures`],
        broadPc: true,
        refinements: [
          {
            id: "current-workspace",
            label: "Current workspace",
            description: "Narrow the search back to the active workspace.",
            scope: { scope: "current-workspace" },
          },
          {
            id: "pictures",
            label: "Pictures",
            description: "Limit the broad PC search to Pictures.",
            scope: {
              scope: "explicit-broad-pc",
              rootHints: [String.raw`C:\Users\camie\Pictures`],
            },
          },
        ],
      },
      results: [
        {
          path: String.raw`C:\Users\camie\Pictures\hero.png`,
          extension: "png",
          score: 95,
          modifiedAt: "2026-06-25T10:00:00.000Z",
          width: 1200,
          height: 800,
        },
        {
          path: String.raw`C:\Users\camie\Music\ambient.wav`,
          extension: "wav",
          score: 22,
          modifiedAtMs: Date.parse("2026-06-20T10:00:00.000Z"),
        },
      ],
      total: 8,
    });

    expect(resultSet).not.toBeNull();
    expect(resultSet?.scope).toMatchObject({
      kind: "explicit-broad-pc",
      broadPc: true,
      rootHints: [String.raw`C:\Users\camie\Pictures`],
    });
    expect(resultSet?.scope.refinements).toMatchObject([
      {
        id: "current-workspace",
        scope: "current-workspace",
        rootHints: [],
      },
      {
        id: "pictures",
        scope: "explicit-broad-pc",
        rootHints: [String.raw`C:\Users\camie\Pictures`],
      },
    ]);
    expect(resultSet?.results).toMatchObject([
      {
        rank: 1,
        title: "hero.png",
        confidence: "high",
        modifiedAt: "2026-06-25T10:00:00.000Z",
      },
      {
        rank: 2,
        title: "ambient.wav",
        kind: "unknown",
        confidence: "low",
        modifiedAt: "2026-06-20T10:00:00.000Z",
      },
    ]);

    const display = buildLocalMediaSearchResultSetDisplayModel(resultSet!);
    expect(display).toMatchObject({
      title: 'Local media results for "hero"',
      summary: "2 results of 8 in Broad PC search",
      scopeLabel: "Broad PC search",
      scopeDetail: String.raw`C:\Users\camie\Pictures`,
      refinementLabel: "Refine broad scope",
    });
    expect(display.scopeWarning).toContain("Broad PC scope");
    expect(display.results[0]).toMatchObject({
      rankLabel: "#1",
      confidenceLabel: "High confidence",
      confidenceTone: "strong",
      modifiedLabel: "Jun 25, 2026",
      scoreLabel: "Score 95",
    });
  });

  it("extracts local media search result fences and strips only their payload", () => {
    const payload = {
      kind: "local-media-search-results",
      query: "logo",
      scope: "current-workspace",
      results: [
        {
          path: "assets/logo.webp",
          score: 40,
          modifiedAt: "2026-06-21T10:00:00.000Z",
        },
      ],
    };
    const text = [
      "Found a likely match.",
      "",
      "```json",
      JSON.stringify({ localMediaSearchResults: payload }, null, 2),
      "```",
      "",
      "Use the best-ranked item first.",
    ].join("\n");

    expect(extractLocalMediaSearchResultSetsFromText(text)).toHaveLength(1);
    expect(stripLocalMediaSearchResultSetsFromText(text)).toBe(
      "Found a likely match.\n\nUse the best-ranked item first.",
    );
    expect(stripLocalMediaSearchResultSetsFromText('```json\n{"ok":true}\n```')).toBe(
      '```json\n{"ok":true}\n```',
    );
  });
});
