import type { ProviderInteractionMode } from "@t3tools/contracts";

export interface MobileInteractionModeOption {
  readonly id: ProviderInteractionMode;
  readonly title: string;
  readonly description: string;
}

export const MOBILE_INTERACTION_MODE_OPTIONS = [
  {
    id: "default",
    title: "Build",
    description: "Make changes normally.",
  },
  {
    id: "plan",
    title: "Plan",
    description: "Produce a decision-complete plan first.",
  },
  {
    id: "test",
    title: "Test",
    description: "Validate behavior with recorded evidence.",
  },
  {
    id: "workflow",
    title: "Workflow",
    description: "Coordinate planning, execution, review, and verification.",
  },
  {
    id: "trigger",
    title: "Trigger",
    description: "Create and manage runtime-started threads.",
  },
] as const satisfies ReadonlyArray<MobileInteractionModeOption>;

const MOBILE_INTERACTION_MODE_IDS = new Set<string>(
  MOBILE_INTERACTION_MODE_OPTIONS.map((option) => option.id),
);

export function isMobileInteractionMode(value: string): value is ProviderInteractionMode {
  return MOBILE_INTERACTION_MODE_IDS.has(value);
}

export function mobileInteractionModeLabel(mode: ProviderInteractionMode): string {
  return MOBILE_INTERACTION_MODE_OPTIONS.find((option) => option.id === mode)?.title ?? "Build";
}
