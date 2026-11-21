import type { AssetResource, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { useAssetUrls } from "~/assets/assetUrls";
import type { MediaArtifact } from "~/mediaArtifacts";

export interface MediaArtifactAssetResolutionTarget {
  readonly artifactIndex: number;
  readonly resource: AssetResource;
}

export function mediaArtifactRequiresResolvedAsset(artifact: MediaArtifact): boolean {
  return Boolean(
    !artifact.previewUrl && !artifact.url && artifact.path && artifact.source !== "local",
  );
}

export function mediaArtifactAssetResolutionTargets(
  artifacts: ReadonlyArray<MediaArtifact>,
  threadRef: ScopedThreadRef | null,
): MediaArtifactAssetResolutionTarget[] {
  if (!threadRef) return [];

  return artifacts.flatMap((artifact, artifactIndex) =>
    mediaArtifactRequiresResolvedAsset(artifact) && artifact.path
      ? [
          {
            artifactIndex,
            resource: {
              _tag: "workspace-file" as const,
              threadId: threadRef.threadId,
              path: artifact.path,
            },
          },
        ]
      : [],
  );
}

export function applyResolvedMediaArtifactUrls<T extends MediaArtifact>(
  artifacts: ReadonlyArray<T>,
  targets: ReadonlyArray<MediaArtifactAssetResolutionTarget>,
  urls: ReadonlyArray<string | null>,
): T[] {
  const urlByArtifactIndex = new Map<number, string>();
  targets.forEach((target, index) => {
    const url = urls[index];
    if (url) {
      urlByArtifactIndex.set(target.artifactIndex, url);
    }
  });

  return artifacts.flatMap((artifact, artifactIndex) => {
    if (!mediaArtifactRequiresResolvedAsset(artifact)) {
      return [artifact];
    }
    const resolvedUrl = urlByArtifactIndex.get(artifactIndex);
    return resolvedUrl ? [{ ...artifact, previewUrl: resolvedUrl } as T] : [];
  });
}

export function useDisplayableMediaArtifacts<T extends MediaArtifact>(input: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly artifacts: ReadonlyArray<T>;
}): ReadonlyArray<T> {
  const targets = (() => mediaArtifactAssetResolutionTargets(input.artifacts, input.threadRef))();
  const resources = (() => targets.map((target) => target.resource))();
  const urls = useAssetUrls(input.environmentId, resources);

  return (() => applyResolvedMediaArtifactUrls(input.artifacts, targets, urls))();
}
