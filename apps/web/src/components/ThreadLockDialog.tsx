import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export type ThreadLockDialogMode = "lock" | "open" | "remove";
type Choice = { readonly passcode: string };
type Request = {
  readonly mode: ThreadLockDialogMode;
  readonly threadTitle: string;
  readonly resolve: (choice: Choice | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));
const useAccess = create<{ unlocked: ReadonlySet<string> }>(() => ({ unlocked: new Set() }));

export function useThreadLockAccess(threadRef: ScopedThreadRef | null): boolean {
  return useAccess((state) => threadRef !== null && state.unlocked.has(scopedThreadKey(threadRef)));
}

export function hasThreadLockAccess(threadRef: ScopedThreadRef): boolean {
  return useAccess.getState().unlocked.has(scopedThreadKey(threadRef));
}

export function markThreadLockAccess(threadRef: ScopedThreadRef) {
  useAccess.setState((state) => ({
    unlocked: new Set(state.unlocked).add(scopedThreadKey(threadRef)),
  }));
}

export function forgetThreadLockAccess(threadRef: ScopedThreadRef) {
  useAccess.setState((state) => {
    const unlocked = new Set(state.unlocked);
    unlocked.delete(scopedThreadKey(threadRef));
    return { unlocked };
  });
}

export function requestThreadPasscode(
  mode: ThreadLockDialogMode,
  threadTitle: string,
): Promise<Choice | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { mode, threadTitle, resolve } }));
}

function finish(choice: Choice | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(choice);
}

export function ThreadLockDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => finish(null), []);
  return request ? <ThreadLockDialog request={request} /> : null;
}

function ThreadLockDialog({ request }: { readonly request: Request }) {
  const id = useId();
  const [passcode, setPasscode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const isLock = request.mode === "lock";
  const mismatch = isLock && confirmation.length > 0 && passcode !== confirmation;
  const valid =
    passcode.length >= 4 && passcode.length <= 128 && (!isLock || passcode === confirmation);
  const title = isLock
    ? "Lock thread"
    : request.mode === "remove"
      ? "Remove thread lock"
      : "Open locked thread";
  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogPopup className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) finish({ passcode });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {isLock
                ? `Set a passcode for "${request.threadTitle}". You will need it to open this thread.`
                : `Enter the passcode for "${request.threadTitle}".`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Label htmlFor={`${id}-passcode`} className="space-y-1.5">
              <span>Passcode</span>
              <Input
                nativeInput
                id={`${id}-passcode`}
                type="password"
                autoFocus
                autoComplete={isLock ? "new-password" : "current-password"}
                minLength={4}
                maxLength={128}
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
              />
            </Label>
            {isLock ? (
              <Label htmlFor={`${id}-confirm`} className="space-y-1.5">
                <span>Confirm passcode</span>
                <Input
                  nativeInput
                  id={`${id}-confirm`}
                  type="password"
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={128}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Label>
            ) : null}
            {mismatch ? <p className="text-sm text-destructive">Passcodes do not match.</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {isLock ? "Lock thread" : request.mode === "remove" ? "Remove lock" : "Open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
