import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

const FALLBACK_ASSET_RESOURCE: AssetResource = {
  _tag: "project-favicon",
  cwd: ".",
};

export function useAssetUrl(environmentId: EnvironmentId, resource: AssetResource): string | null {
  const preparedConnection = usePreparedConnection(environmentId);
  const result = useAtomValue(
    assetEnvironment.createUrl({
      environmentId,
      input: { resource },
    }),
  );
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return null;
  }
  return resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
}

export function useOptionalAssetUrl(
  environmentId: EnvironmentId,
  resource: AssetResource | null,
): string | null {
  const resolved = useAssetUrl(environmentId, resource ?? FALLBACK_ASSET_RESOURCE);
  return resource ? resolved : null;
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const preparedConnection = usePreparedConnection(environmentId);
  const results = useAtomValue(
    assetEnvironment.createUrls({
      environmentId,
      resources,
    }),
  );
  return useMemo(
    () =>
      preparedConnection._tag === "None"
        ? resources.map(() => null)
        : results.map((result) =>
            AsyncResult.isSuccess(result)
              ? resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl)
              : null,
          ),
    [preparedConnection, resources, results],
  );
}
