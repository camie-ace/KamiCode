import { describe, expect, it } from "vitest";

import {
  artifactFileName,
  formatEvidenceSummaryForDisplay,
  testHarnessArtifactUrl,
  testHarnessTraceViewerUrl,
} from "./testHarnessArtifacts";

describe("test harness artifact helpers", () => {
  it("builds artifact URLs without exposing raw paths in link text", () => {
    const filePath =
      "C:/Users/THIS PC/.t3/dev/test-harness/projects/project-1/runs/run-1/trace.zip";

    expect(testHarnessArtifactUrl(filePath)).toContain(encodeURIComponent(filePath));
    expect(artifactFileName(filePath)).toBe("trace.zip");
  });

  it("builds same-origin trace viewer URLs for saved trace artifacts", () => {
    const filePath =
      "C:/Users/THIS PC/.t3/dev/test-harness/projects/project-1/runs/run-1/trace.zip";
    const artifactUrl = testHarnessArtifactUrl(filePath);

    expect(testHarnessTraceViewerUrl(filePath)).toBe(
      `/api/test-harness/trace-viewer/index.html?trace=${encodeURIComponent(artifactUrl)}`,
    );
  });

  it("hides absolute trace paths from display summaries", () => {
    expect(
      formatEvidenceSummaryForDisplay(
        "2 observation(s), trace recorded at C:\\Users\\THIS PC\\.t3\\dev\\test-harness\\run-1\\trace.zip. Final URL: http://127.0.0.1:5733/pair.",
      ),
    ).toBe("2 observation(s), trace recorded. Final URL: http://127.0.0.1:5733/pair.");
  });
});
