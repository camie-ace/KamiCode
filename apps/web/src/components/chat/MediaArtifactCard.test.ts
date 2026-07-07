import { describe, expect, it } from "@effect/vitest";

import { deriveMediaArtifactCardAvailability } from "./MediaArtifactCard";

describe("MediaArtifactCard", () => {
  it("keeps playback and chat attachment actions available after preview rendering fails", () => {
    const state = deriveMediaArtifactCardAvailability({
      previewUrl: "/api/assets/token/demo.mp4",
      isPreviewableKind: true,
      isImageLike: false,
      isVideo: true,
      composerTargetAvailable: true,
      previewFailed: true,
      canWriteImage: false,
    });

    expect(state).toEqual({
      canOpenViewer: true,
      canRenderPreview: false,
      canUseInChat: true,
      canCopyImage: false,
    });
  });

  it("requires a resolved asset URL before enabling media actions", () => {
    const state = deriveMediaArtifactCardAvailability({
      previewUrl: null,
      isPreviewableKind: true,
      isImageLike: false,
      isVideo: true,
      composerTargetAvailable: true,
      previewFailed: false,
      canWriteImage: false,
    });

    expect(state).toEqual({
      canOpenViewer: false,
      canRenderPreview: false,
      canUseInChat: false,
      canCopyImage: false,
    });
  });

  it("allows image copy retries when an inline image preview fails", () => {
    const state = deriveMediaArtifactCardAvailability({
      previewUrl: "/api/assets/token/hero.png",
      isPreviewableKind: true,
      isImageLike: true,
      isVideo: false,
      composerTargetAvailable: false,
      previewFailed: true,
      canWriteImage: true,
    });

    expect(state.canOpenViewer).toBe(true);
    expect(state.canRenderPreview).toBe(false);
    expect(state.canCopyImage).toBe(true);
  });
});
