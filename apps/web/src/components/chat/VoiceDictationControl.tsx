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
  voiceRecordingFileExtension,
} from "./VoiceDictationControl.logic";

const MAX_RECORDING_MS = 60_000;

type VoiceDictationState = "idle" | "requesting" | "recording" | "transcribing";

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.min(60, Math.floor(elapsedMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

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
      return "Transcription took too long. Try a shorter prompt.";
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

export function VoiceDictationControl(props: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceDictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const mountedRef = useRef(true);
  const environmentIdRef = useRef(props.environmentId);
  const onTranscriptRef = useRef(props.onTranscript);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldTranscribeRef = useRef(false);
  const generationRef = useRef(0);
  const startedAtRef = useRef(0);

  environmentIdRef.current = props.environmentId;
  onTranscriptRef.current = props.onTranscript;

  const stopTracks = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    shouldTranscribeRef.current = false;
    stopTracks();
  }, [stopTracks]);

  const finishRecording = useCallback((transcribe: boolean) => {
    const recorder = recorderRef.current;
    if (recorder === null || recorder.state === "inactive") return;
    shouldTranscribeRef.current = transcribe;
    recorder.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    shouldTranscribeRef.current = false;
    finishRecording(false);
  }, [finishRecording]);

  const transcribeRecording = useCallback(
    async (blob: Blob, mimeType: string, generation: number, environmentId: EnvironmentId) => {
      const extension = voiceRecordingFileExtension(mimeType);
      const file = new File([blob], `voice-prompt.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });
      const result = await runAtomCommand(
        appAtomRegistry,
        transcribeSpeechCommand,
        { environmentId, file },
        { reportFailure: false, reportDefect: false },
      );
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        environmentIdRef.current !== environmentId
      ) {
        return;
      }
      setState("idle");
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not transcribe recording",
          description: transcriptionErrorDescription(error),
        });
        return;
      }
      const text = result.value.text.trim();
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
    [],
  );

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
    setState("requesting");
    setElapsedMs(0);
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

      // Keep the stream reachable before constructing MediaRecorder so the
      // catch path can always release the microphone if construction fails.
      streamRef.current = stream;
      const mimeType = chooseVoiceRecordingMimeType((candidate) =>
        typeof MediaRecorder.isTypeSupported === "function"
          ? MediaRecorder.isTypeSupported(candidate)
          : false,
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      shouldTranscribeRef.current = false;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
          const shouldTranscribe = shouldTranscribeRef.current;
          const chunks = chunksRef.current;
          const resolvedMimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
          const blob = new Blob(chunks, { type: resolvedMimeType });
          resetRecorder();
          if (!mountedRef.current || generationRef.current !== generation) return;
          if (!shouldTranscribe) {
            setState("idle");
            return;
          }
          setState("transcribing");
          void transcribeRecording(blob, resolvedMimeType, generation, environmentId);
        },
        { once: true },
      );
      recorder.addEventListener(
        "error",
        () => {
          resetRecorder();
          if (!mountedRef.current || generationRef.current !== generation) return;
          setState("idle");
          toastManager.add({
            type: "error",
            title: "Microphone recording stopped",
            description: "The browser could not finish this recording. Try again.",
          });
        },
        { once: true },
      );
      startedAtRef.current = Date.now();
      recorder.start(250);
      setState("recording");
    } catch (error) {
      resetRecorder();
      if (!mountedRef.current || generationRef.current !== generation) return;
      setState("idle");
      toastManager.add({
        type: "error",
        title: "Could not start microphone",
        description: recordingErrorDescription(error),
      });
    }
  }, [props.disabled, props.environmentId, resetRecorder, state, transcribeRecording]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const nextElapsedMs = Date.now() - startedAtRef.current;
      setElapsedMs(nextElapsedMs);
      if (nextElapsedMs >= MAX_RECORDING_MS) {
        finishRecording(true);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [finishRecording, state]);

  useEffect(() => {
    generationRef.current += 1;
    if (recorderRef.current?.state !== "inactive") {
      shouldTranscribeRef.current = false;
      recorderRef.current?.stop();
    }
    stopTracks();
    setState("idle");
  }, [props.environmentId, stopTracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (recorderRef.current?.state !== "inactive") {
        shouldTranscribeRef.current = false;
        recorderRef.current?.stop();
      }
      stopTracks();
    };
  }, [stopTracks]);

  const browserSupported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined;
  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "transcribing";
  const label = isRecording
    ? "Stop and transcribe recording"
    : state === "requesting"
      ? "Starting microphone"
      : state === "transcribing"
        ? "Transcribing recording"
        : "Dictate prompt";
  const tooltip = !browserSupported
    ? "Voice dictation is not supported in this browser"
    : props.disabled && state === "idle"
      ? "Voice dictation is unavailable while the environment is disconnected"
      : isRecording
        ? "Stop and insert transcript"
        : state === "transcribing"
          ? "Transcribing locally…"
          : "Dictate prompt (up to 60 seconds)";

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-voice-dictation-state={state}>
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
              onClick={() => (isRecording ? finishRecording(true) : void startRecording())}
              type="button"
            />
          }
        >
          {isBusy ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : isRecording ? (
            <>
              <SquareIcon className="size-3.5 fill-current" aria-hidden="true" />
              <span className="min-w-7 text-xs tabular-nums">{formatElapsed(elapsedMs)}</span>
            </>
          ) : (
            <MicIcon className="size-4" aria-hidden="true" />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{tooltip}</TooltipPopup>
      </Tooltip>

      {isRecording ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Discard voice recording"
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
          <TooltipPopup side="top">Discard recording</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
