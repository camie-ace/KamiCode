import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LockKeyholeIcon } from "lucide-react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef, resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  useEnvironmentThreadRefs,
  useThreadDetail,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "../components/ui/button";
import {
  markThreadLockAccess,
  requestThreadPasscode,
  useThreadLockAccess,
} from "../components/ThreadLockDialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "../components/ui/toast";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const shell = useEnvironmentQuery(
    threadRef === null ? null : environmentShell.stateAtom(threadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const hasThreadAccess = useThreadLockAccess(threadRef);
  const mayLoadThreadDetail =
    serverThreadShell !== null && (!serverThreadShell.locked || hasThreadAccess);
  const serverThreadDetail = useThreadDetail(mayLoadThreadDetail ? threadRef : null);
  const serverThreadStatus = useThreadStatus(threadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(threadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const environmentHasServerThreads = environmentThreadRefs.length > 0;
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const unlockThread = useAtomCommand(serverEnvironment.unlockThread, { reportFailure: false });

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    // Navigation already resolved onto this path, so a drop aimed here
    // passed its landing check; once the thread reads as missing it can
    // never be attached, release it even when there is nowhere to redirect.
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(threadRef);
      if (environmentHasAnyThreads) {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, renderState, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);

  if (!threadRef) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {serverThreadShell?.locked && !hasThreadAccess ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-muted p-3">
              <LockKeyholeIcon className="size-6" />
            </div>
            <div>
              <h1 className="font-medium">This thread is locked</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter its passcode to view the conversation.
              </p>
            </div>
            <Button
              onClick={() => {
                void (async () => {
                  const choice = await requestThreadPasscode("open", serverThreadShell.title);
                  if (!choice || !threadRef) return;
                  const result = await unlockThread({
                    environmentId: threadRef.environmentId,
                    input: {
                      threadId: threadRef.threadId,
                      passcode: choice.passcode,
                      removeLock: false,
                    },
                  });
                  if (result._tag === "Success") {
                    markThreadLockAccess(threadRef);
                  } else if (!isAtomCommandInterrupted(result)) {
                    const error = squashAtomCommandFailure(result);
                    toastManager.add({
                      type: "error",
                      title: "Could not open thread",
                      description: error instanceof Error ? error.message : "Incorrect passcode.",
                    });
                  }
                })();
              }}
            >
              Unlock thread
            </Button>
          </div>
        </div>
      ) : renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
        />
      ) : null}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
