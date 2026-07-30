import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import { publishBrowserSessionChanged } from "../browserSessionSync";
import { environmentCatalog } from "../connection/catalog";
import { completeSameOriginPairing } from "../postPairing";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status === "hosted-pairing") {
      return {
        authGateState,
      };
    }

    if (authGateState.status === "authenticated" || authGateState.status === "hosted-static") {
      throw redirect({ to: "/", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { authGateState } = Route.useRouteContext();
  const router = useRouter();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, {
    reportFailure: false,
  });
  const finishPairing = useCallback(
    () =>
      completeSameOriginPairing({
        notifySessionChanged: publishBrowserSessionChanged,
        ...(primaryEnvironmentId === null
          ? {}
          : {
              retryProjectConnection: async () => {
                await retryEnvironment(primaryEnvironmentId);
              },
            }),
        finishInApp: async () => {
          await router.invalidate();
          await router.navigate({ to: "/", replace: true });
        },
      }),
    [primaryEnvironmentId, retryEnvironment, router],
  );

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return <HostedPairingRouteSurface />;
  }

  return (
    <PairingRouteSurface
      auth={authGateState.auth}
      onAuthenticated={finishPairing}
      {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
    />
  );
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
