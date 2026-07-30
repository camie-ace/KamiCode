const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.(?:\d+|[0-9a-f]{7,40})$/i;

export function isNightlyAppVersion(version: string | null | undefined): boolean {
  return typeof version === "string" && NIGHTLY_VERSION_PATTERN.test(version);
}

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
}): string {
  if (!input.primaryServerVersion) {
    return input.fallbackStageLabel;
  }
  if (isNightlyAppVersion(input.primaryServerVersion)) {
    return "Nightly";
  }
  return input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
}): string {
  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
  });

  return stageLabel === input.fallbackStageLabel
    ? input.fallbackDisplayName
    : formatAppDisplayName({ baseName: input.baseName, stageLabel });
}
