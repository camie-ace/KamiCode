import { useEffect, useRef } from "react";

import { useStore } from "../store";
import {
  collectNewlyCompletedTurns,
  getTurnCompletionAlertVolume,
  isApplicationInFocus,
  TURN_COMPLETION_ALERT_DURATION_MS,
  TURN_COMPLETION_ALERT_INTERVAL_MS,
} from "../lib/turnCompletionAlert";

function playCompletionChirp(audioContext: AudioContext, volume: number) {
  const startAt = audioContext.currentTime;
  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  const overtone = audioContext.createOscillator();

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.32);

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(880, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(1174.66, startAt + 0.16);

  overtone.type = "sine";
  overtone.frequency.setValueAtTime(1320, startAt);
  overtone.frequency.exponentialRampToValueAtTime(1760, startAt + 0.16);

  oscillator.connect(gain);
  overtone.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(startAt);
  overtone.start(startAt);
  oscillator.stop(startAt + 0.34);
  overtone.stop(startAt + 0.34);

  const cleanup = () => {
    oscillator.disconnect();
    overtone.disconnect();
    gain.disconnect();
  };
  oscillator.addEventListener("ended", cleanup, { once: true });
}

export function TurnCompletionSoundCoordinator() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousStateRef = useRef(useStore.getState());
  const stopAlertRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const getAudioContext = () => {
      if (audioContextRef.current) {
        return audioContextRef.current;
      }
      if (typeof window.AudioContext !== "function") {
        return null;
      }
      const audioContext = new window.AudioContext();
      audioContextRef.current = audioContext;
      return audioContext;
    };

    const stopAlert = () => {
      stopAlertRef.current?.();
      stopAlertRef.current = null;
    };

    const ensureAudioReady = async () => {
      const audioContext = getAudioContext();
      if (!audioContext) {
        return null;
      }
      if (audioContext.state !== "running") {
        try {
          await audioContext.resume();
        } catch {
          return null;
        }
      }
      return audioContext.state === "running" ? audioContext : null;
    };

    const startAlert = () => {
      stopAlert();
      if (isApplicationInFocus(document)) {
        return;
      }

      const startedAt = Date.now();
      let timeoutId: number | null = null;
      let disposed = false;

      const tick = async () => {
        if (disposed || isApplicationInFocus(document)) {
          stopAlert();
          return;
        }

        const audioContext = await ensureAudioReady();
        if (audioContext) {
          playCompletionChirp(audioContext, getTurnCompletionAlertVolume(Date.now() - startedAt));
        }

        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= TURN_COMPLETION_ALERT_DURATION_MS) {
          stopAlert();
          return;
        }

        timeoutId = window.setTimeout(tick, TURN_COMPLETION_ALERT_INTERVAL_MS);
      };

      stopAlertRef.current = () => {
        disposed = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      void tick();
    };

    const handleFocusStateChange = () => {
      if (isApplicationInFocus(document)) {
        stopAlert();
      }
    };

    const primeAudio = () => {
      void ensureAudioReady();
    };

    const unsubscribe = useStore.subscribe((nextState) => {
      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;
      if (collectNewlyCompletedTurns(previousState, nextState).length === 0) {
        return;
      }
      if (isApplicationInFocus(document)) {
        return;
      }
      startAlert();
    });

    document.addEventListener("visibilitychange", handleFocusStateChange);
    window.addEventListener("focus", handleFocusStateChange);
    window.addEventListener("pointerdown", primeAudio, { passive: true });
    window.addEventListener("keydown", primeAudio);

    return () => {
      unsubscribe();
      stopAlert();
      document.removeEventListener("visibilitychange", handleFocusStateChange);
      window.removeEventListener("focus", handleFocusStateChange);
      window.removeEventListener("pointerdown", primeAudio);
      window.removeEventListener("keydown", primeAudio);
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, []);

  return null;
}
