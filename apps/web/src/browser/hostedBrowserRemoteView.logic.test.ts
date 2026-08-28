import { describe, expect, it } from "vite-plus/test";

import {
  hostedFramePoint,
  hostedKeyboardAction,
  hostedMouseButton,
  resolveHostedFramePresentation,
} from "./hostedBrowserRemoteView.logic";

describe("hosted browser frame input mapping", () => {
  it("letterboxes a remote viewport and maps client coordinates back to CSS pixels", () => {
    const presentation = resolveHostedFramePresentation({
      containerWidth: 1_000,
      containerHeight: 800,
      frameWidth: 1_280,
      frameHeight: 800,
    });
    expect(presentation).toEqual({
      left: 0,
      top: 87.5,
      width: 1_000,
      height: 625,
      scale: 0.78125,
    });
    expect(
      hostedFramePoint({
        clientX: 500,
        clientY: 400,
        containerLeft: 0,
        containerTop: 0,
        presentation: presentation!,
      }),
    ).toEqual({ x: 640, y: 400 });
    expect(
      hostedFramePoint({
        clientX: 500,
        clientY: 40,
        containerLeft: 0,
        containerTop: 0,
        presentation: presentation!,
      }),
    ).toBeNull();
  });

  it("maps pointer buttons and printable versus command keys", () => {
    expect(hostedMouseButton(2)).toBe("right");
    expect(hostedMouseButton(8)).toBeNull();
    expect(
      hostedKeyboardAction({
        key: "A",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        isComposing: false,
      }),
    ).toEqual({ _tag: "insertText", text: "A" });
    expect(
      hostedKeyboardAction({
        key: "a",
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toEqual({ _tag: "key", key: "a", modifiers: ["Control"] });
  });
});
