import { describe, expect, it } from "vite-plus/test";

import {
  chooseVoiceRecordingMimeType,
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
});
