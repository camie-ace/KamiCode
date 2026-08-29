const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

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
