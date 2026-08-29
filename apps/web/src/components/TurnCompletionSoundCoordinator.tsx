import { useEffect, useRef } from "react";

import {
  collectSettledCompletedTurns,
  isApplicationInFocus,
  TURN_COMPLETION_ALERT_DURATION_MS,
  TURN_COMPLETION_ALERT_VOLUME,
  turnCompletionAlertKey,
} from "../lib/turnCompletionAlert";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadShells } from "../state/threads";

const COMPLETION_ALERT_MOUNT_GRACE_MS = 2_500;

interface RunningCompletionChime {
  stop: () => void;
}

function startCompletionChime(audioContext: AudioContext): RunningCompletionChime {
  const startAt = audioContext.currentTime;
  const durationSeconds = TURN_COMPLETION_ALERT_DURATION_MS / 1_000;
  const masterGain = audioContext.createGain();
  const primary = audioContext.createOscillator();
  const harmonic = audioContext.createOscillator();
  const harmonicGain = audioContext.createGain();

  masterGain.gain.setValueAtTime(0.0001, startAt);
  masterGain.gain.linearRampToValueAtTime(TURN_COMPLETION_ALERT_VOLUME, startAt + 0.04);
  masterGain.gain.setValueAtTime(TURN_COMPLETION_ALERT_VOLUME, startAt + 1.05);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);

  primary.type = "sine";
  primary.frequency.setValueAtTime(920, startAt);
  harmonic.type = "sine";
  harmonic.frequency.setValueAtTime(1_840, startAt);
  harmonicGain.gain.setValueAtTime(0.1, startAt);

  primary.connect(masterGain);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(masterGain);
  masterGain.connect(audioContext.destination);

  primary.start(startAt);
  harmonic.start(startAt);

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    const stopAt = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(stopAt);
    masterGain.gain.setTargetAtTime(0.0001, stopAt, 0.015);
    const oscillatorStopAt = stopAt + 0.08;
    primary.stop(oscillatorStopAt);
    harmonic.stop(oscillatorStopAt);
  };

  const cleanup = () => {
    primary.disconnect();
    harmonic.disconnect();
    harmonicGain.disconnect();
    masterGain.disconnect();
  };
  primary.addEventListener("ended", cleanup, { once: true });

  return { stop };
}

export function TurnCompletionSoundCoordinator() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const mountedAtEpochMsRef = useRef(Date.now());
  const alertedTurnKeysRef = useRef(
    new Set(
      collectSettledCompletedTurns(
        appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
      ).map(turnCompletionAlertKey),
    ),
  );
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

      let chime: RunningCompletionChime | null = null;
      let timeoutId: number | null = null;
      let disposed = false;

      stopAlertRef.current = () => {
        disposed = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        chime?.stop();
        chime = null;
      };

      void ensureAudioReady().then((audioContext) => {
        if (disposed || isApplicationInFocus(document)) {
          stopAlert();
          return;
        }
        if (!audioContext) {
          return;
        }

        chime = startCompletionChime(audioContext);
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

    const unsubscribe = appAtomRegistry.subscribe(environmentThreadShells.threadShellsAtom, () => {
      const nextAlerts = collectSettledCompletedTurns(
        appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
        {
          completedAfterEpochMs: mountedAtEpochMsRef.current - COMPLETION_ALERT_MOUNT_GRACE_MS,
        },
      );
      const unannouncedAlerts = nextAlerts.filter((alert) => {
        const key = turnCompletionAlertKey(alert);
        if (alertedTurnKeysRef.current.has(key)) {
          return false;
        }
        alertedTurnKeysRef.current.add(key);
        return true;
      });
      if (unannouncedAlerts.length === 0) {
        return;
      }
      if (isApplicationInFocus(document)) {
        return;
      }
      startAlert();
    });

    document.addEventListener("visibilitychange", handleFocusStateChange);
    window.addEventListener("focus", handleFocusStateChange);
    window.addEventListener("pointerdown", primeAudio, { capture: true, passive: true });
    window.addEventListener("keydown", primeAudio, true);

    return () => {
      unsubscribe();
      stopAlert();
      document.removeEventListener("visibilitychange", handleFocusStateChange);
      window.removeEventListener("focus", handleFocusStateChange);
      window.removeEventListener("pointerdown", primeAudio, true);
      window.removeEventListener("keydown", primeAudio, true);
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, []);

  return null;
}
