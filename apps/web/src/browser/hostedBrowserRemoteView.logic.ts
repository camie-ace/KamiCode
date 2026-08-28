import type { HostedPreviewControlAction, HostedPreviewMouseButton } from "@t3tools/contracts";

export interface HostedFramePresentation {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export function resolveHostedFramePresentation(input: {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}): HostedFramePresentation | null {
  if (
    input.containerWidth <= 0 ||
    input.containerHeight <= 0 ||
    input.frameWidth <= 0 ||
    input.frameHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(
    input.containerWidth / input.frameWidth,
    input.containerHeight / input.frameHeight,
  );
  const width = input.frameWidth * scale;
  const height = input.frameHeight * scale;
  return {
    left: (input.containerWidth - width) / 2,
    top: (input.containerHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function hostedFramePoint(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly containerLeft: number;
  readonly containerTop: number;
  readonly presentation: HostedFramePresentation;
}): { readonly x: number; readonly y: number } | null {
  const x = input.clientX - input.containerLeft - input.presentation.left;
  const y = input.clientY - input.containerTop - input.presentation.top;
  if (x < 0 || y < 0 || x > input.presentation.width || y > input.presentation.height) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(x / input.presentation.scale)),
    y: Math.max(0, Math.round(y / input.presentation.scale)),
  };
}

export function hostedMouseButton(button: number): HostedPreviewMouseButton | null {
  switch (button) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return null;
  }
}

export function hostedKeyboardAction(input: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}): HostedPreviewControlAction | null {
  if (input.isComposing || input.key === "Dead" || input.key === "Process") return null;
  if (input.key.length === 1 && !input.altKey && !input.ctrlKey && !input.metaKey) {
    return { _tag: "insertText", text: input.key };
  }
  const modifiers = [
    ...(input.altKey ? (["Alt"] as const) : []),
    ...(input.ctrlKey ? (["Control"] as const) : []),
    ...(input.metaKey ? (["Meta"] as const) : []),
    ...(input.shiftKey ? (["Shift"] as const) : []),
  ];
  return {
    _tag: "key",
    key: input.key === " " ? "Space" : input.key,
    modifiers,
  };
}
