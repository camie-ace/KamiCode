import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LockKeyholeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import ChatView from "./ChatView";
import { resolveDraftPromotionNavigationTarget, threadHasStarted } from "./ChatView.logic";
import { waitForDraftHeroTransition } from "./chat/draftHeroTransition";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import {
  markThreadLockAccess,
  requestThreadPasscode,
  useThreadLockAccess,
} from "./ThreadLockDialog";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import {
  useEnvironmentThreadRefs,
  useThread,
  useThreadDetail,
  useThreadRefs,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "./ui/toast";
import {
  buildThreadRouteParams,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";

/**
 * The single chat surface behind both `/draft/$draftId` and
 * `/$environmentId/$threadId`. Each draft gets its own ChatView instance (so
 * a background send's state stays with the draft it came from), and that
 * instance carries the draft through its promotion to a server thread: the
 * thread route keeps keying by the draft id while the draft record exists,
 * so the route swap only changes props and the timeline never paints an
 * empty frame. Plain server threads are unkeyed, so navigating between them
 * reuses one instance as ChatView expects.
 *
 * Rendered by the `_chat` layout rather than by the two leaf routes, since
 * an element only survives a route swap when the same parent renders it.
 */
export function ThreadRouteView({ target }: { target: ThreadRouteTarget }) {
  const navigate = useNavigate();
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const threadRefs = useThreadRefs();
  // The server thread this view is about: the route's own ref, or the draft's
  // reserved ref once the server knows it.
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef: ScopedThreadRef | null =
    target.kind === "server" ? target.threadRef : (draftSession?.promotedTo ?? inferredThreadRef);
  const serverThread = useThread(serverThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(
    target.kind === "draft" ? serverThreadRef : null,
  );
  const canonicalThreadRef =
    target.kind === "draft"
      ? resolveDraftPromotionNavigationTarget({
          serverThreadRef,
          serverThread,
          backgroundSubmissionPending,
        })
      : null;

  const shell = useEnvironmentQuery(
    serverThreadRef === null ? null : environmentShell.stateAtom(serverThreadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(serverThreadRef);
  const hasThreadAccess = useThreadLockAccess(serverThreadRef);
  const mayLoadThreadDetail =
    serverThreadRef !== null && (!serverThreadShell?.locked || hasThreadAccess);
  const serverThreadDetail = useThreadDetail(mayLoadThreadDetail ? serverThreadRef : null);
  const serverThreadStatus = useThreadStatus(serverThreadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(serverThreadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const draftThread = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftThreadByRef(serverThreadRef) : null,
  );
  const promotedDraftId = useComposerDraftStore((store) =>
    target.kind === "server" ? store.getDraftIdByRef(target.threadRef) : null,
  );
  // The draft record is removed once the promoted thread has started, which
  // is after the route swap. Latch the key so the element that carried the
  // draft keeps its identity for as long as this thread stays on screen.
  const [chatViewKey, setChatViewKey] = useState<{ threadKey: string; key: string } | null>(null);
  const serverThreadKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : null;
  const nextChatViewKey =
    serverThreadKey === null
      ? null
      : chatViewKey?.threadKey === serverThreadKey
        ? chatViewKey
        : promotedDraftId
          ? { threadKey: serverThreadKey, key: promotedDraftId }
          : null;
  if (nextChatViewKey !== chatViewKey) {
    setChatViewKey(nextChatViewKey);
  }
  const environmentHasDraftThreads = useComposerDraftStore((store) =>
    serverThreadRef ? store.hasDraftThreadsInEnvironment(serverThreadRef.environmentId) : false,
  );
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists: draftThread !== null,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const environmentHasAnyThreads = environmentThreadRefs.length > 0 || environmentHasDraftThreads;
  const unlockThread = useAtomCommand(serverEnvironment.unlockThread, { reportFailure: false });

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (target.kind !== "draft" || draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate, target.kind]);

  useEffect(() => {
    if (target.kind !== "server" || !bootstrapComplete) {
      return;
    }
    // Navigation already resolved onto this path, so a drop aimed here
    // passed its landing check; once the thread reads as missing it can
    // never be attached, release it even when there is nowhere to redirect.
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(target.threadRef);
      if (environmentHasAnyThreads) {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, renderState, target]);

  useEffect(() => {
    if (target.kind !== "server" || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(target.threadRef);
  }, [draftThread, serverThreadStarted, target]);

  let view: React.ReactNode = null;
  if (target.kind === "draft") {
    if (draftSession) {
      view = (
        <ChatView
          key={target.draftId}
          draftId={target.draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
          forceExpandedMobileComposer
        />
      );
    }
  } else if (serverThreadShell?.locked && !hasThreadAccess) {
    view = (
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
                if (!serverThreadRef) return;
                const choice = await requestThreadPasscode("open", serverThreadShell.title);
                if (!choice) return;
                const result = await unlockThread({
                  environmentId: serverThreadRef.environmentId,
                  input: {
                    threadId: serverThreadRef.threadId,
                    passcode: choice.passcode,
                    removeLock: false,
                  },
                });
                if (result._tag === "Success") {
                  markThreadLockAccess(serverThreadRef);
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
    );
  } else if (renderState === "ready" || (renderState === "loading" && serverThreadShell !== null)) {
    view = (
      <ChatView
        {...(nextChatViewKey ? { key: nextChatViewKey.key } : {})}
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
        threadSyncPhase={threadSyncPhase}
      />
    );
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {view}
    </SidebarInset>
  );
}
