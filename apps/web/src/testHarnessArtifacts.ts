export function testHarnessArtifactUrl(filePath: string): string {
  return `/api/test-harness/artifact?path=${encodeURIComponent(filePath)}`;
}

export function testHarnessTraceViewerUrl(filePath: string): string {
  const traceUrl = testHarnessArtifactUrl(filePath);
  return `/api/test-harness/trace-viewer/index.html?trace=${encodeURIComponent(traceUrl)}`;
}

export function artifactFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").at(-1) || "artifact";
}

export function formatEvidenceSummaryForDisplay(summary: string): string {
  return summary.replace(/trace recorded at\s+.*?trace\.zip\.?/giu, "trace recorded.").trim();
}
