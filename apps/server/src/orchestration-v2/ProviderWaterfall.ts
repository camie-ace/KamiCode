import {
  CommandId,
  MessageId,
  isProviderAvailable,
  type ProviderInstanceId,
  type RunId,
  type ServerProvider,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";

export function selectNextWaterfallProvider(input: {
  readonly sequence: ReadonlyArray<ProviderInstanceId>;
  readonly failedInstanceId: ProviderInstanceId;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** Instances already tried for the same request; they are never retried. */
  readonly attemptedInstanceIds?: ReadonlySet<ProviderInstanceId>;
}) {
  // Settings written outside the UI can repeat an instance; keep its first slot.
  const sequence = [...new Set(input.sequence)];
  const failedIndex = sequence.indexOf(input.failedInstanceId);
  // Later instances come first, then earlier ones whose limit may have reset.
  // A failure outside the sequence starts from the top.
  const candidates =
    failedIndex < 0
      ? sequence
      : [...sequence.slice(failedIndex + 1), ...sequence.slice(0, failedIndex)];
  return candidates
    .filter(
      (instanceId) =>
        instanceId !== input.failedInstanceId && !input.attemptedInstanceIds?.has(instanceId),
    )
    .map((instanceId) => input.providers.find((provider) => provider.instanceId === instanceId))
    .find(
      (provider) =>
        provider !== undefined &&
        provider.enabled &&
        provider.installed &&
        isProviderAvailable(provider) &&
        provider.models.length > 0,
    );
}

/** Persisted run links bound a fallback chain across retries and server restarts. */
export function waterfallContinuation(input: {
  projection: OrchestrationV2ThreadProjection;
  sequence: ReadonlyArray<ProviderInstanceId>;
  providers: ReadonlyArray<ServerProvider>;
}): Extract<OrchestrationV2Command, { type: "message.dispatch" }> | null {
  const { projection } = input;
  const failed = latestExecutedRun(projection.runs);
  if (
    !failed ||
    failed.status !== "failed" ||
    latestRootProviderFailure(failed, projection.turnItems)?.class !== "usage_limit" ||
    projection.thread.archivedAt !== null ||
    projection.thread.deletedAt !== null ||
    projection.thread.settledOverride === "settled" ||
    projection.thread.providerInstanceId !== failed.providerInstanceId ||
    projection.runs.some((run) =>
      ["preparing", "starting", "running", "waiting"].includes(run.status),
    ) ||
    projection.runtimeRequests.some((request) => request.status === "pending")
  )
    return null;
  const attempted = new Set<ProviderInstanceId>();
  const visited = new Set<string>();
  let source: typeof failed | undefined = failed;
  while (source && !visited.has(source.id)) {
    visited.add(source.id);
    attempted.add(source.providerInstanceId);
    const parent: RunId | undefined = source.waterfallOfRunId;
    source = parent === undefined ? undefined : projection.runs.find((run) => run.id === parent);
  }
  const next = selectNextWaterfallProvider({
    sequence: input.sequence,
    failedInstanceId: failed.providerInstanceId,
    providers: input.providers,
    attemptedInstanceIds: attempted,
  });
  if (!next) return null;
  const selected =
    next.models.find((model) => model.slug === failed.modelSelection.model) ??
    next.models.find((model) => model.isDefault) ??
    next.models.find((model) => !model.isLegacy) ??
    next.models[0]!;
  const oldDriver = input.providers.find(
    (provider) => provider.instanceId === failed.providerInstanceId,
  )?.driver;
  const identity = `waterfall:${projection.thread.id}:${failed.id}:${next.instanceId}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: projection.thread.id,
    manualContinuationOfRunId: failed.id,
    waterfallOfRunId: failed.id,
    modelSelection: {
      instanceId: next.instanceId,
      model: selected.slug,
      ...(oldDriver === next.driver &&
      selected.slug === failed.modelSelection.model &&
      failed.modelSelection.options !== undefined
        ? { options: failed.modelSelection.options }
        : {}),
    },
    text: "Continue where you left off. The previous provider reached its usage limit.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "system",
    creationSource: "server",
  };
}
