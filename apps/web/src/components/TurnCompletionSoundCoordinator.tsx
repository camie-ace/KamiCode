import { useEffect, useRef } from "react";

import { useStore } from "../store";
import {
  collectNewlyCompletedTurns,
  isApplicationInFocus,
  TURN_COMPLETION_ALERT_DURATION_MS,
  TURN_COMPLETION_ALERT_INITIAL_VOLUME,
  TURN_COMPLETION_ALERT_MAX_VOLUME,
} from "../lib/turnCompletionAlert";

interface RunningCompletionAlarm {
  stop: () => void;
}

function startCompletionAlarm(audioContext: AudioContext): RunningCompletionAlarm {
  const startAt = audioContext.currentTime;
  const durationSeconds = TURN_COMPLETION_ALERT_DURATION_MS / 1_000;
  const masterGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const primary = audioContext.createOscillator();
  const overtone = audioContext.createOscillator();
  const siren = audioContext.createOscillator();
  const sirenDepth = audioContext.createGain();
  const tremolo = audioContext.createOscillator();
  const tremoloDepth = audioContext.createGain();

  masterGain.gain.setValueAtTime(0.0001, startAt);
  masterGain.gain.linearRampToValueAtTime(TURN_COMPLETION_ALERT_INITIAL_VOLUME, startAt + 0.08);
  masterGain.gain.linearRampToValueAtTime(
    TURN_COMPLETION_ALERT_MAX_VOLUME,
    startAt + durationSeconds,
  );

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1_180, startAt);
  filter.Q.setValueAtTime(7, startAt);

  primary.type = "sawtooth";
  primary.frequency.setValueAtTime(740, startAt);
  overtone.type = "square";
  overtone.frequency.setValueAtTime(1_110, startAt);

  siren.type = "sine";
  siren.frequency.setValueAtTime(1.8, startAt);
  sirenDepth.gain.setValueAtTime(310, startAt);
  siren.connect(sirenDepth);
  sirenDepth.connect(primary.frequency);
  sirenDepth.connect(overtone.frequency);

  tremolo.type = "square";
  tremolo.frequency.setValueAtTime(7.5, startAt);
  tremoloDepth.gain.setValueAtTime(0.16, startAt);
  tremolo.connect(tremoloDepth);
  tremoloDepth.connect(masterGain.gain);

  primary.connect(filter);
  overtone.connect(filter);
  filter.connect(masterGain);
  masterGain.connect(audioContext.destination);

  primary.start(startAt);
  overtone.start(startAt);
  siren.start(startAt);
  tremolo.start(startAt);

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    const stopAt = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(stopAt);
    masterGain.gain.setTargetAtTime(0.0001, stopAt, 0.03);
    const oscillatorStopAt = stopAt + 0.15;
    primary.stop(oscillatorStopAt);
    overtone.stop(oscillatorStopAt);
    siren.stop(oscillatorStopAt);
    tremolo.stop(oscillatorStopAt);
  };

  const cleanup = () => {
    primary.disconnect();
    overtone.disconnect();
    siren.disconnect();
    sirenDepth.disconnect();
    tremolo.disconnect();
    tremoloDepth.disconnect();
    filter.disconnect();
    masterGain.disconnect();
  };
  primary.addEventListener("ended", cleanup, { once: true });

  return { stop };
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

      let alarm: RunningCompletionAlarm | null = null;
      let timeoutId: number | null = null;
      let disposed = false;

      stopAlertRef.current = () => {
        disposed = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        alarm?.stop();
        alarm = null;
      };

      void ensureAudioReady().then((audioContext) => {
        if (disposed || isApplicationInFocus(document)) {
          stopAlert();
          return;
        }
        if (!audioContext) {
          return;
        }

        alarm = startCompletionAlarm(audioContext);
        timeoutId = window.setTimeout(() => {
          stopAlert();
        }, TURN_COMPLETION_ALERT_DURATION_MS);
      });
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
