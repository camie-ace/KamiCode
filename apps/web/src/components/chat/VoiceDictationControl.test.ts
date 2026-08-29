import { describe, expect, it } from "vite-plus/test";

import {
  chooseVoiceRecordingMimeType,
  createVoiceTranscriptQueue,
  formatVoiceRecordingElapsed,
  mergeVoiceTranscriptSegments,
  VOICE_RECORDING_MAX_MS,
  voiceRecordingFileExtension,
} from "./VoiceDictationControl.logic";

describe("voice recording format selection", () => {
  it("prefers Opus WebM and falls back to a browser-supported container", () => {
    expect(chooseVoiceRecordingMimeType((mimeType) => mimeType === "audio/mp4")).toBe("audio/mp4");
    expect(chooseVoiceRecordingMimeType(() => false)).toBeUndefined();
  });

  it("uses extensions whisper.cpp/ffmpeg can recognize", () => {
    expect(voiceRecordingFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(voiceRecordingFileExtension("audio/mp4")).toBe("m4a");
    expect(voiceRecordingFileExtension("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("formats the five-minute recording window without rolling past the ceiling", () => {
    expect(formatVoiceRecordingElapsed(0)).toBe("0:00");
    expect(formatVoiceRecordingElapsed(61_900)).toBe("1:01");
    expect(formatVoiceRecordingElapsed(VOICE_RECORDING_MAX_MS + 10_000)).toBe("5:00");
  });

  it("merges ordered segments and removes words repeated at recording boundaries", () => {
    expect(
      mergeVoiceTranscriptSegments([
        "Please inspect the authentication handler.",
        "authentication handler and add a regression test",
        "add a regression test for Nigerian users.",
      ]),
    ).toBe(
      "Please inspect the authentication handler and add a regression test for Nigerian users.",
    );
    expect(
      mergeVoiceTranscriptSegments(["Finish this task.", "this task. Start the next one."]),
    ).toBe("Finish this task. Start the next one.");
    expect(mergeVoiceTranscriptSegments(["", "  Ship the fix.  ", ""])).toBe("Ship the fix.");
  });

  it("transcribes queued parts serially and preserves their recording order", async () => {
    let active = 0;
    let maximumActive = 0;
    const progress: Array<{ completed: number; queued: number }> = [];
    const queue = createVoiceTranscriptQueue({
      onProgress: (next) => progress.push(next),
      transcribe: async (_segment, sequence) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return sequence === 1 ? "Open the KamiCode project" : "KamiCode project and run the tests";
      },
    });

    queue.enqueue({ blob: new Blob(["first"]), mimeType: "audio/webm" });
    queue.enqueue({ blob: new Blob(["second"]), mimeType: "audio/webm" });

    await expect(queue.finish()).resolves.toBe("Open the KamiCode project and run the tests");
    expect(maximumActive).toBe(1);
    expect(progress.at(-1)).toEqual({ completed: 2, queued: 2 });
  });

  it("fails the complete transcript when any queued part fails", async () => {
    const queue = createVoiceTranscriptQueue({
      onProgress: () => undefined,
      transcribe: async (_segment, sequence) => {
        if (sequence === 1) throw new Error("segment failed");
        return "This partial result must not be inserted.";
      },
    });
    queue.enqueue({ blob: new Blob(["first"]), mimeType: "audio/webm" });
    queue.enqueue({ blob: new Blob(["second"]), mimeType: "audio/webm" });

    await expect(queue.finish()).rejects.toThrow("segment failed");
  });

  it("discards queued transcription work when the session is canceled", async () => {
    let calls = 0;
    const queue = createVoiceTranscriptQueue({
      onProgress: () => undefined,
      transcribe: async () => {
        calls += 1;
        return "This canceled text must not be inserted.";
      },
    });
    queue.enqueue({ blob: new Blob(["first"]), mimeType: "audio/webm" });
    queue.cancel();

    await expect(queue.finish()).resolves.toBe("");
    expect(calls).toBe(0);
  });
});
