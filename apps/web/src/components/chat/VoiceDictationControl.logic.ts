const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export const VOICE_RECORDING_MAX_MS = 5 * 60 * 1_000;
export const VOICE_RECORDING_SEGMENT_MS = 20_000;

const MAX_TRANSCRIPT_OVERLAP_WORDS = 12;

export interface VoiceRecordingSegment {
  readonly blob: Blob;
  readonly mimeType: string;
}

export interface VoiceTranscriptQueueProgress {
  readonly completed: number;
  readonly queued: number;
}

export function chooseVoiceRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  return RECORDING_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType));
}

export function voiceRecordingFileExtension(mimeType: string): string {
  const baseType = mimeType.split(";", 1)[0]?.toLowerCase();
  if (baseType === "audio/mp4") return "m4a";
  if (baseType === "audio/ogg") return "ogg";
  return "webm";
}

export function formatVoiceRecordingElapsed(elapsedMs: number): string {
  const seconds = Math.min(
    VOICE_RECORDING_MAX_MS / 1_000,
    Math.max(0, Math.floor(elapsedMs / 1_000)),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function comparableTranscriptWord(word: string): string {
  return word.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");
}

function appendTranscriptSegment(transcript: string, segment: string): string {
  const currentWords = transcript.trim().split(/\s+/u);
  const segmentWords = segment.trim().split(/\s+/u);
  const maximumOverlap = Math.min(
    MAX_TRANSCRIPT_OVERLAP_WORDS,
    currentWords.length,
    segmentWords.length,
  );
  let overlap = 0;

  for (let length = maximumOverlap; length > 0; length -= 1) {
    const currentOffset = currentWords.length - length;
    const matches = segmentWords.slice(0, length).every((word, index) => {
      const segmentWord = comparableTranscriptWord(word);
      return (
        segmentWord.length > 0 &&
        segmentWord === comparableTranscriptWord(currentWords[currentOffset + index] ?? "")
      );
    });
    if (matches) {
      overlap = length;
      break;
    }
  }

  const appendedWords = segmentWords.slice(overlap);
  const mergedCurrentWords = [...currentWords];
  if (
    overlap > 0 &&
    appendedWords.length > 0 &&
    /^[^\p{L}\p{N}]*\p{Ll}/u.test(appendedWords[0] ?? "")
  ) {
    const finalWord = mergedCurrentWords.at(-1);
    if (finalWord !== undefined) {
      mergedCurrentWords[mergedCurrentWords.length - 1] = finalWord.replace(/[.!?,;:]+$/u, "");
    }
  }

  return [...mergedCurrentWords, ...appendedWords].join(" ");
}

export function mergeVoiceTranscriptSegments(segments: ReadonlyArray<string>): string {
  return segments.reduce((transcript, segment) => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return transcript;
    if (transcript.length === 0) return trimmed;
    return appendTranscriptSegment(transcript, trimmed);
  }, "");
}

export function createVoiceTranscriptQueue(options: {
  readonly onProgress: (progress: VoiceTranscriptQueueProgress) => void;
  readonly transcribe: (segment: VoiceRecordingSegment, sequence: number) => Promise<string | null>;
}) {
  let accepting = true;
  let canceled = false;
  let completed = 0;
  let hasError = false;
  let firstError: unknown = null;
  let queued = 0;
  let tail = Promise.resolve();
  const transcripts: string[] = [];

  const emitProgress = () => options.onProgress({ completed, queued });

  return {
    cancel() {
      accepting = false;
      canceled = true;
    },
    enqueue(segment: VoiceRecordingSegment) {
      if (!accepting || segment.blob.size === 0) return;
      const sequence = queued + 1;
      queued = sequence;
      emitProgress();
      tail = tail.then(async () => {
        if (canceled) return;
        try {
          const text = await options.transcribe(segment, sequence);
          if (!canceled && text !== null && text.trim().length > 0) transcripts.push(text);
        } catch (error) {
          if (!hasError) firstError = error;
          hasError = true;
        } finally {
          if (!canceled) {
            completed += 1;
            emitProgress();
          }
        }
      });
    },
    async finish(): Promise<string> {
      accepting = false;
      await tail;
      if (hasError) throw firstError;
      if (canceled) return "";
      return mergeVoiceTranscriptSegments(transcripts);
    },
  };
}
