import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

import {
  applyResolvedMediaArtifactUrls,
  mediaArtifactAssetResolutionTargets,
  mediaArtifactRequiresResolvedAsset,
} from "./mediaArtifactAssets";
import type { MediaArtifact } from "./mediaArtifacts";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("mediaArtifactAssets", () => {
  it("requires resolver proof for path-only project artifacts", () => {
    expect(
      mediaArtifactRequiresResolvedAsset({
        id: "project-image",
        kind: "image",
        source: "project",
        title: "hero.png",
        path: "/marketing/hero.png",
        extension: "png",
      }),
    ).toBe(true);
    expect(
      mediaArtifactRequiresResolvedAsset({
        id: "web-image",
        kind: "image",
        source: "web",
        title: "hero.png",
        url: "https://example.com/hero.png",
        extension: "png",
      }),
    ).toBe(false);
    expect(
      mediaArtifactRequiresResolvedAsset({
        id: "local-search-result",
        kind: "image",
        source: "local",
        title: "hero.png",
        path: String.raw`C:\Users\camie\Pictures\hero.png`,
        extension: "png",
      }),
    ).toBe(false);
  });

  it("drops unresolved project artifacts and attaches resolved asset URLs", () => {
    const artifacts: MediaArtifact[] = [
      {
        id: "missing-image",
        kind: "image",
        source: "project",
        title: "missing.png",
        path: "/marketing/missing.png",
        extension: "png",
      },
      {
        id: "existing-document",
        kind: "file",
        source: "project",
        title: "budget.xlsx",
        path: "reports/budget.xlsx",
        extension: "xlsx",
      },
      {
        id: "local-search-result",
        kind: "image",
        source: "local",
        title: "hero.png",
        path: String.raw`C:\Users\camie\Pictures\hero.png`,
        extension: "png",
      },
    ];
    const targets = mediaArtifactAssetResolutionTargets(artifacts, threadRef);

    expect(targets).toMatchObject([
      {
        artifactIndex: 0,
        resource: {
          _tag: "workspace-file",
          threadId: threadRef.threadId,
          path: "/marketing/missing.png",
        },
      },
      {
        artifactIndex: 1,
        resource: {
          _tag: "workspace-file",
          threadId: threadRef.threadId,
          path: "reports/budget.xlsx",
        },
      },
    ]);
    expect(
      applyResolvedMediaArtifactUrls(artifacts, targets, [null, "/api/assets/token/budget.xlsx"]),
    ).toEqual([
      {
        ...artifacts[1],
        previewUrl: "/api/assets/token/budget.xlsx",
      },
      artifacts[2],
    ]);
  });
});
