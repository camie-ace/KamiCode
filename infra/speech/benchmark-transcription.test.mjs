import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  normalizeTranscript,
  summarizeBenchmark,
  wordErrorCount,
} from "./benchmark-transcription.mjs";

NodeTest.describe("Nigerian-English transcription benchmark metrics", () => {
  NodeTest.it("normalizes case and punctuation without discarding Nigerian names", () => {
    NodeAssert.deepEqual(normalizeTranscript("  Ọlá said, “Open KamiCode!”  "), [
      "ọlá",
      "said",
      "open",
      "kamicode",
    ]);
  });

  NodeTest.it("counts substitutions, insertions, and deletions at word level", () => {
    NodeAssert.equal(wordErrorCount("please open the terminal", "please close terminal now"), 3);
    NodeAssert.equal(wordErrorCount("ship this change", "ship this change"), 0);
  });

  NodeTest.it("reports weighted overall and per-accent WER", () => {
    const summary = summarizeBenchmark([
      {
        accent: "yoruba",
        elapsedSeconds: 2,
        durationSeconds: 4,
        referenceWords: 10,
        wordErrors: 1,
        wer: 0.1,
      },
      {
        accent: "igbo",
        elapsedSeconds: 3,
        durationSeconds: 6,
        referenceWords: 5,
        wordErrors: 2,
        wer: 0.4,
      },
    ]);

    NodeAssert.equal(summary.overall.wer, 0.2);
    NodeAssert.equal(summary.overall.realtimeFactor, 0.5);
    NodeAssert.deepEqual(
      summary.accents.map(({ accent, wer }) => ({ accent, wer })),
      [
        { accent: "igbo", wer: 0.4 },
        { accent: "yoruba", wer: 0.1 },
      ],
    );
  });
});
