import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { LoaderCircleIcon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { transcribeSpeechCommand } from "../../state/speechTranscription";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ComposerControl } from "./ComposerControl";
import {
  chooseVoiceRecordingMimeType,
  createVoiceTranscriptQueue,
  formatVoiceRecordingElapsed,
  type VoiceTranscriptQueueProgress,
  VOICE_RECORDING_MAX_MS,
  VOICE_RECORDING_SEGMENT_MS,
  voiceRecordingFileExtension,
} from "./VoiceDictationControl.logic";

const SEGMENT_RETRY_DELAY_MS = 750;
const SEGMENT_RETRY_LIMIT = 1;

type VoiceDictationState = "idle" | "requesting" | "recording" | "transcribing";

function recordingErrorDescription(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Allow microphone access in this browser, then try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone is available on this device.";
    }
    if (error.name === "SecurityError") {
      return "Microphone access requires a secure HTTPS connection.";
    }
  }
  return "The browser could not start the microphone.";
}

function transcriptionErrorDescription(error: unknown): string {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    if (error._tag === "RemoteEnvironmentAuthTimeoutError") {
      return "The local speech model took too long to process part of the recording.";
    }
    if (
      (error._tag === "EnvironmentHttpBadRequestError" ||
        error._tag === "SpeechTranscriptionValidationError") &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  }
  return "The local speech service could not process this recording. Try again.";
}

function isRetryableTranscriptionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return false;
  return (
    error._tag === "RemoteEnvironmentAuthFetchError" ||
    error._tag === "SpeechTranscriptionConnectionError"
  );
}

function waitForSegmentRetry(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SEGMENT_RETRY_DELAY_MS));
}

export function VoiceDictationControl(props: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceDictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [segmentProgress, setSegmentProgress] = useState<VoiceTranscriptQueueProgress>({
    completed: 0,
    queued: 0,
  });
  const mountedRef = useRef(true);
  const environmentIdRef = useRef(props.environmentId);
  const onTranscriptRef = useRef(props.onTranscript);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRequestedRef = useRef(false);
  const discardRequestedRef = useRef(false);
  const rotationPendingRef = useRef(false);
  const finalizingRef = useRef(false);
  const segmentQueueRef = useRef<ReturnType<typeof createVoiceTranscriptQueue> | null>(null);
  const generationRef = useRef(0);
  const startedAtRef = useRef(0);
  const segmentStartedAtRef = useRef(0);

  environmentIdRef.current = props.environmentId;
  onTranscriptRef.current = props.onTranscript;

  const stopTracks = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    recorderRef.current = null;
    stopRequestedRef.current = false;
    discardRequestedRef.current = false;
    rotationPendingRef.current = false;
    finalizingRef.current = false;
    segmentQueueRef.current?.cancel();
    segmentQueueRef.current = null;
    stopTracks();
  }, [stopTracks]);

  const stopCurrentRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") {
      try {
        recorder.stop();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  const abortRecording = useCallback(
    (generation: number, description: string) => {
      if (!mountedRef.current || generationRef.current !== generation) return;
      generationRef.current += 1;
      discardRequestedRef.current = true;
      stopCurrentRecorder();
      resetSession();
      setElapsedMs(0);
      setSegmentProgress({ completed: 0, queued: 0 });
      setState("idle");
      toastManager.add({
        type: "error",
        title: "Microphone recording stopped",
        description,
      });
    },
    [resetSession, stopCurrentRecorder],
  );

  const transcribeSegment = useCallback(
    async (
      blob: Blob,
      mimeType: string,
      sequence: number,
      generation: number,
      environmentId: EnvironmentId,
    ): Promise<string | null> => {
      const extension = voiceRecordingFileExtension(mimeType);
      const file = new File(
        [blob],
        `voice-prompt-${String(sequence).padStart(2, "0")}.${extension}`,
        {
          type: mimeType,
          lastModified: Date.now(),
        },
      );

      for (let attempt = 0; attempt <= SEGMENT_RETRY_LIMIT; attempt += 1) {
        const result = await runAtomCommand(
          appAtomRegistry,
          transcribeSpeechCommand,
          { environmentId, file },
          { reportFailure: false, reportDefect: false },
        );
        if (
          !mountedRef.current ||
          generationRef.current !== generation ||
          environmentIdRef.current !== environmentId ||
          discardRequestedRef.current
        ) {
          return null;
        }
        if (result._tag === "Success") return result.value.text.trim();

        const error = squashAtomCommandFailure(result);
        if (attempt === SEGMENT_RETRY_LIMIT || !isRetryableTranscriptionError(error)) {
          throw error;
        }
        await waitForSegmentRetry();
      }
      return null;
    },
    [],
  );

  const finalizeSession = useCallback(
    async (generation: number, environmentId: EnvironmentId) => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;
      stopTracks();
      if (mountedRef.current && generationRef.current === generation) setState("transcribing");

      let failed = false;
      let error: unknown;
      let text = "";
      try {
        text = (await segmentQueueRef.current?.finish()) ?? "";
      } catch (cause) {
        failed = true;
        error = cause;
      }
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        environmentIdRef.current !== environmentId ||
        discardRequestedRef.current
      ) {
        return;
      }

      resetSession();
      setElapsedMs(0);
      setSegmentProgress({ completed: 0, queued: 0 });
      setState("idle");
      if (failed) {
        toastManager.add({
          type: "error",
          title: "Could not transcribe the complete recording",
          description: transcriptionErrorDescription(error),
        });
        return;
      }
      if (text.length === 0) {
        toastManager.add({
          type: "info",
          title: "No speech detected",
          description: "Try again and speak a little closer to the microphone.",
        });
        return;
      }
      onTranscriptRef.current(text);
    },
    [resetSession, stopTracks],
  );

  const startRecorderSegment = useCallback(
    function startRecorderSegment(
      stream: MediaStream,
      mimeType: string,
      generation: number,
      environmentId: EnvironmentId,
    ) {
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      rotationPendingRef.current = false;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
          if (recorderRef.current === recorder) recorderRef.current = null;
          rotationPendingRef.current = false;
          if (
            !mountedRef.current ||
            generationRef.current !== generation ||
            environmentIdRef.current !== environmentId ||
            discardRequestedRef.current
          ) {
            return;
          }

          const resolvedMimeType = recorder.mimeType || chunks[0]?.type || mimeType || "audio/webm";
          segmentQueueRef.current?.enqueue({
            blob: new Blob(chunks, { type: resolvedMimeType }),
            mimeType: resolvedMimeType,
          });

          if (stopRequestedRef.current) {
            void finalizeSession(generation, environmentId);
            return;
          }
          try {
            startRecorderSegment(stream, mimeType, generation, environmentId);
          } catch {
            abortRecording(
              generation,
              "The browser could not continue this recording after an audio segment.",
            );
          }
        },
        { once: true },
      );
      recorder.addEventListener(
        "error",
        () => {
          abortRecording(generation, "The browser could not finish this recording. Try again.");
        },
        { once: true },
      );
      segmentStartedAtRef.current = Date.now();
      recorder.start(250);
    },
    [abortRecording, finalizeSession],
  );

  const finishRecording = useCallback(() => {
    if (stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    if (mountedRef.current) setState("transcribing");
    if (rotationPendingRef.current) return;
    if (!stopCurrentRecorder()) {
      void finalizeSession(generationRef.current, environmentIdRef.current);
    }
  }, [finalizeSession, stopCurrentRecorder]);

  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    discardRequestedRef.current = true;
    if (!rotationPendingRef.current) stopCurrentRecorder();
    resetSession();
    setElapsedMs(0);
    setSegmentProgress({ completed: 0, queued: 0 });
    setState("idle");
  }, [resetSession, stopCurrentRecorder]);

  const startRecording = useCallback(async () => {
    if (props.disabled || state !== "idle") return;
    if (
      typeof MediaRecorder === "undefined" ||
      typeof navigator === "undefined" ||
      navigator.mediaDevices?.getUserMedia === undefined
    ) {
      toastManager.add({
        type: "error",
        title: "Voice dictation is unavailable",
        description: "This browser does not support microphone recording.",
      });
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const environmentId = props.environmentId;
    resetSession();
    setState("requesting");
    setElapsedMs(0);
    setSegmentProgress({ completed: 0, queued: 0 });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        environmentIdRef.current !== environmentId
      ) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      const mimeType =
        chooseVoiceRecordingMimeType((candidate) =>
          typeof MediaRecorder.isTypeSupported === "function"
            ? MediaRecorder.isTypeSupported(candidate)
            : false,
        ) ?? "";
      segmentQueueRef.current = createVoiceTranscriptQueue({
        onProgress: (progress) => {
          if (
            mountedRef.current &&
            generationRef.current === generation &&
            environmentIdRef.current === environmentId
          ) {
            setSegmentProgress(progress);
          }
        },
        transcribe: ({ blob, mimeType: segmentMimeType }, sequence) =>
          transcribeSegment(blob, segmentMimeType, sequence, generation, environmentId),
      });
      startedAtRef.current = Date.now();
      startRecorderSegment(stream, mimeType, generation, environmentId);
      setState("recording");
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      resetSession();
      setState("idle");
      toastManager.add({
        type: "error",
        title: "Could not start microphone",
        description: recordingErrorDescription(error),
      });
    }
  }, [
    props.disabled,
    props.environmentId,
    resetSession,
    startRecorderSegment,
    state,
    transcribeSegment,
  ]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const nextElapsedMs = now - startedAtRef.current;
      setElapsedMs(Math.min(nextElapsedMs, VOICE_RECORDING_MAX_MS));
      if (nextElapsedMs >= VOICE_RECORDING_MAX_MS) {
        finishRecording();
        return;
      }
      const recorder = recorderRef.current;
      if (
        now - segmentStartedAtRef.current >= VOICE_RECORDING_SEGMENT_MS &&
        !rotationPendingRef.current &&
        recorder !== null &&
        recorder.state === "recording"
      ) {
        rotationPendingRef.current = true;
        recorder.stop();
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [finishRecording, state]);

  useEffect(() => {
    generationRef.current += 1;
    discardRequestedRef.current = true;
    stopCurrentRecorder();
    resetSession();
    setElapsedMs(0);
    setSegmentProgress({ completed: 0, queued: 0 });
    setState("idle");
  }, [props.environmentId, resetSession, stopCurrentRecorder]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      discardRequestedRef.current = true;
      stopCurrentRecorder();
      resetSession();
    };
  }, [resetSession, stopCurrentRecorder]);

  const browserSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined;
  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "transcribing";
  const canCancel = isRecording || state === "transcribing";
  const label = isRecording
    ? "Stop and transcribe recording"
    : state === "requesting"
      ? "Starting microphone"
      : state === "transcribing"
        ? `Finishing voice transcript (${segmentProgress.completed} of ${segmentProgress.queued} parts)`
        : "Dictate prompt";
  const recordingProgress =
    segmentProgress.queued === 0
      ? "Recording locally"
      : `${segmentProgress.completed} of ${segmentProgress.queued} parts transcribed`;
  const tooltip = !browserSupported
    ? "Voice dictation is not supported in this browser"
    : props.disabled && state === "idle"
      ? "Voice dictation is unavailable while the environment is disconnected"
      : isRecording
        ? `${recordingProgress}. Stop and insert transcript.`
        : state === "transcribing"
          ? `Finishing transcript (${segmentProgress.completed} of ${segmentProgress.queued} parts)`
          : "Dictate prompt (up to 5 minutes)";

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-voice-dictation-completed-segments={segmentProgress.completed}
      data-voice-dictation-queued-segments={segmentProgress.queued}
      data-voice-dictation-state={state}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              aria-label={label}
              aria-pressed={isRecording}
              className={
                isRecording
                  ? "gap-1.5 px-2 text-destructive hover:text-destructive"
                  : "px-2 text-muted-foreground/70 hover:text-foreground/80"
              }
              disabled={isBusy || (!isRecording && (props.disabled || !browserSupported))}
              onClick={() => (isRecording ? finishRecording() : void startRecording())}
              type="button"
            />
          }
        >
          {isBusy ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : isRecording ? (
            <>
              <SquareIcon className="size-3.5 fill-current" aria-hidden="true" />
              <span className="min-w-7 text-xs tabular-nums">
                {formatVoiceRecordingElapsed(elapsedMs)}
              </span>
            </>
          ) : (
            <MicIcon className="size-4" aria-hidden="true" />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{tooltip}</TooltipPopup>
      </Tooltip>

      {canCancel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={isRecording ? "Discard voice recording" : "Cancel voice transcription"}
                className="size-7 shrink-0 text-muted-foreground"
                onClick={cancelRecording}
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {isRecording ? "Discard recording" : "Cancel transcription"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
