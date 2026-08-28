"use client";

import type {
  HostedPreviewControlAction,
  HostedPreviewFrameResult,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { LoaderCircle, MonitorUp } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  hostedFramePoint,
  hostedKeyboardAction,
  hostedMouseButton,
  resolveHostedFramePresentation,
  type HostedFramePresentation,
} from "./hostedBrowserRemoteView.logic";

const ACTIVE_FRAME_POLL_MS = 100;
const IDLE_FRAME_POLL_MS = 350;
const POINTER_MOVE_INTERVAL_MS = 40;

interface FrameViewState {
  readonly src: string | null;
  readonly width: number;
  readonly height: number;
  readonly sequence: number;
  readonly remoteState: HostedPreviewFrameResult["state"];
  readonly message: string | null;
  readonly loading: boolean;
}

const INITIAL_FRAME_STATE: FrameViewState = {
  src: null,
  width: 0,
  height: 0,
  sequence: 0,
  remoteState: "pending",
  message: null,
  loading: false,
};

export function HostedBrowserRemoteView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly visible: boolean;
  readonly className?: string;
}) {
  const { threadRef, tabId, visible, className } = props;
  const requestFrame = useAtomCommand(previewEnvironment.hostedFrame, {
    reportFailure: false,
    reportDefect: false,
  });
  const sendControl = useAtomCommand(previewEnvironment.hostedControl, {
    reportFailure: false,
    reportDefect: false,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sequenceRef = useRef(0);
  const presentationRef = useRef<HostedFramePresentation | null>(null);
  const lastPointerMoveAtRef = useRef(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<FrameViewState>(INITIAL_FRAME_STATE);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const presentation = resolveHostedFramePresentation({
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    frameWidth: frame.width,
    frameHeight: frame.height,
  });
  presentationRef.current = presentation;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      const result = await requestFrame({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          tabId,
          afterSequence: sequenceRef.current,
        },
      });
      if (cancelled) return;
      if (result._tag === "Success") {
        const next = result.value;
        sequenceRef.current = Math.max(sequenceRef.current, next.sequence);
        setFrame((current) => {
          const updated = {
            src: next.frame ? `data:${next.frame.mimeType};base64,${next.frame.data}` : current.src,
            width: next.frame?.width ?? current.width,
            height: next.frame?.height ?? current.height,
            sequence: next.sequence,
            remoteState: next.state,
            message: next.message ?? null,
            loading: next.loading,
          };
          return updated.src === current.src &&
            updated.width === current.width &&
            updated.height === current.height &&
            updated.sequence === current.sequence &&
            updated.remoteState === current.remoteState &&
            updated.message === current.message &&
            updated.loading === current.loading
            ? current
            : updated;
        });
      }
      const delay =
        result._tag === "Success" && (result.value.loading || result.value.frame !== null)
          ? ACTIVE_FRAME_POLL_MS
          : IDLE_FRAME_POLL_MS;
      timer = window.setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [requestFrame, tabId, threadRef.environmentId, threadRef.threadId, visible]);

  const dispatch = useCallback(
    (action: HostedPreviewControlAction) => {
      void sendControl({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, tabId, action },
      });
    },
    [sendControl, tabId, threadRef.environmentId, threadRef.threadId],
  );

  const pointFor = useCallback((clientX: number, clientY: number) => {
    const element = containerRef.current;
    const currentPresentation = presentationRef.current;
    if (!element || !currentPresentation) return null;
    const rect = element.getBoundingClientRect();
    return hostedFramePoint({
      clientX,
      clientY,
      containerLeft: rect.left,
      containerTop: rect.top,
      presentation: currentPresentation,
    });
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const now = performance.now();
      if (now - lastPointerMoveAtRef.current < POINTER_MOVE_INTERVAL_MS) return;
      const point = pointFor(event.clientX, event.clientY);
      if (!point) return;
      lastPointerMoveAtRef.current = now;
      dispatch({ _tag: "pointerMove", ...point });
    },
    [dispatch, pointFor],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = pointFor(event.clientX, event.clientY);
      const button = hostedMouseButton(event.button);
      if (!point || !button) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      dispatch({ _tag: "pointerDown", ...point, button });
    },
    [dispatch, pointFor],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = pointFor(event.clientX, event.clientY);
      const button = hostedMouseButton(event.button);
      if (!point || !button) return;
      event.preventDefault();
      dispatch({ _tag: "pointerUp", ...point, button });
    },
    [dispatch, pointFor],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const point = pointFor(event.clientX, event.clientY);
      const currentPresentation = presentationRef.current;
      if (!point || !currentPresentation) return;
      event.preventDefault();
      dispatch({
        _tag: "wheel",
        ...point,
        deltaX: Math.max(-3_840, Math.min(3_840, event.deltaX / currentPresentation.scale)),
        deltaY: Math.max(-3_840, Math.min(3_840, event.deltaY / currentPresentation.scale)),
      });
    },
    [dispatch, pointFor],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const action = hostedKeyboardAction(event.nativeEvent);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      dispatch(action);
    },
    [dispatch],
  );

  const unavailable = frame.remoteState === "unavailable" || frame.remoteState === "not-found";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="VPS-hosted shared browser"
      className={cn(
        "relative overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => event.preventDefault()}
      data-hosted-browser-view
    >
      {frame.src && presentation ? (
        <img
          src={frame.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{
            left: presentation.left,
            top: presentation.top,
            width: presentation.width,
            height: presentation.height,
          }}
        />
      ) : null}
      {!frame.src && !unavailable ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-zinc-300">
          <LoaderCircle className="size-4 animate-spin" />
          Starting VPS browser…
        </div>
      ) : null}
      {unavailable ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-zinc-200">
          <MonitorUp className="size-6 text-zinc-400" />
          <p className="max-w-sm text-sm">
            {frame.message ?? "The VPS-hosted browser is unavailable."}
          </p>
        </div>
      ) : null}
      {frame.loading && frame.src ? (
        <div className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/65 p-1.5 text-white shadow-sm">
          <LoaderCircle className="size-3.5 animate-spin" />
        </div>
      ) : null}
    </div>
  );
}
