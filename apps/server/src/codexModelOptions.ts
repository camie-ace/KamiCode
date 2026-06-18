import type { ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  const serviceTier = getModelSelectionStringOptionValue(modelSelection, "serviceTier");
  if (serviceTier && serviceTier !== "default") {
    return serviceTier;
  }
  return getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true
    ? "fast"
    : undefined;
}
