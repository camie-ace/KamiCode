#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8087/inference";
const DEFAULT_TIMEOUT_MS = 90_000;

const MIME_TYPES = new Map([
  [".aac", "audio/aac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".mp4", "audio/mp4"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"],
  [".webm", "audio/webm"],
]);

export function normalizeTranscript(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

export function wordErrorCount(reference, hypothesis) {
  const expected = Array.isArray(reference) ? reference : normalizeTranscript(reference);
  const actual = Array.isArray(hypothesis) ? hypothesis : normalizeTranscript(hypothesis);
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    const current = [expectedIndex];
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      const substitutionCost = expected[expectedIndex - 1] === actual[actualIndex - 1] ? 0 : 1;
      current[actualIndex] = Math.min(
        (previous[actualIndex] ?? 0) + 1,
        (current[actualIndex - 1] ?? 0) + 1,
        (previous[actualIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[actual.length] ?? expected.length;
}

function emptyTotals(accent) {
  return {
    accent,
    audioSeconds: 0,
    elapsedSeconds: 0,
    failed: 0,
    referenceWords: 0,
    samples: 0,
    severeFailures: 0,
    wordErrors: 0,
  };
}

function addResult(totals, result) {
  totals.samples += 1;
  totals.audioSeconds += result.durationSeconds ?? 0;
  totals.elapsedSeconds += result.elapsedSeconds;
  totals.referenceWords += result.referenceWords;
  totals.wordErrors += result.wordErrors;
  if (result.error !== undefined) totals.failed += 1;
  if (result.error !== undefined || result.wer >= 0.5) totals.severeFailures += 1;
}

function finalizeTotals(totals) {
  return {
    ...totals,
    realtimeFactor:
      totals.audioSeconds > 0
        ? Number((totals.elapsedSeconds / totals.audioSeconds).toFixed(3))
        : null,
    severeFailureRate:
      totals.samples > 0 ? Number((totals.severeFailures / totals.samples).toFixed(4)) : 0,
    wer:
      totals.referenceWords > 0
        ? Number((totals.wordErrors / totals.referenceWords).toFixed(4))
        : 0,
  };
}

export function summarizeBenchmark(results) {
  const overall = emptyTotals("overall");
  const byAccent = new Map();

  for (const result of results) {
    addResult(overall, result);
    const accent = result.accent || "unspecified";
    const totals = byAccent.get(accent) ?? emptyTotals(accent);
    addResult(totals, result);
    byAccent.set(accent, totals);
  }

  return {
    overall: finalizeTotals(overall),
    accents: [...byAccent.values()]
      .map(finalizeTotals)
      .sort(
        (left, right) => right.samples - left.samples || left.accent.localeCompare(right.accent),
      ),
  };
}

function parseManifestLine(line, lineNumber, manifestDirectory) {
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Manifest line ${lineNumber} is not valid JSON: ${String(error)}`, {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`Manifest line ${lineNumber} must be an object.`);
  }
  if (typeof value.audio !== "string" || value.audio.trim().length === 0) {
    throw new Error(`Manifest line ${lineNumber} needs a non-empty audio path.`);
  }
  if (typeof value.reference !== "string" || value.reference.trim().length === 0) {
    throw new Error(`Manifest line ${lineNumber} needs a non-empty reference transcript.`);
  }
  if (normalizeTranscript(value.reference).length === 0) {
    throw new Error(`Manifest line ${lineNumber} has no scorable words in its reference.`);
  }
  if (
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds <= 0
  ) {
    throw new Error(`Manifest line ${lineNumber} needs a positive durationSeconds value.`);
  }

  const audio = NodePath.isAbsolute(value.audio)
    ? value.audio
    : NodePath.resolve(manifestDirectory, value.audio);
  return {
    accent:
      typeof value.accent === "string" && value.accent.trim() ? value.accent.trim() : "unspecified",
    audio,
    durationSeconds: value.durationSeconds,
    reference: value.reference,
  };
}

async function loadManifest(manifestPath) {
  const contents = await NodeFSP.readFile(manifestPath, "utf8");
  const manifestDirectory = NodePath.resolve(manifestPath, "..");
  return contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line, index) => parseManifestLine(line, index + 1, manifestDirectory));
}

function mimeTypeForPath(path) {
  const extension = NodePath.extname(path).toLocaleLowerCase("en");
  const mimeType = MIME_TYPES.get(extension);
  if (mimeType === undefined) {
    throw new Error(`Unsupported audio extension "${extension || "(none)"}" for ${path}.`);
  }
  return mimeType;
}

async function transcribeSample(sample, options) {
  const referenceWords = normalizeTranscript(sample.reference);
  const startedAt = NodePerfHooks.performance.now();

  try {
    const mimeType = mimeTypeForPath(sample.audio);
    const audio = await NodeFS.openAsBlob(sample.audio, { type: mimeType });
    const payload = new FormData();
    payload.append("file", audio, NodePath.basename(sample.audio));
    payload.append("response_format", "json");
    payload.append("temperature", "0.0");
    if (options.model) payload.append("model", options.model);
    if (options.prompt) {
      payload.append("prompt", options.prompt);
      if (new URL(options.endpoint).pathname.endsWith("/inference")) {
        payload.append("carry_initial_prompt", "true");
      }
    }

    const response = await fetch(options.endpoint, {
      body: payload,
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    if (typeof body !== "object" || body === null || typeof body.text !== "string") {
      throw new Error("The transcription endpoint returned an invalid response.");
    }

    const elapsedSeconds = (NodePerfHooks.performance.now() - startedAt) / 1_000;
    const hypothesisWords = normalizeTranscript(body.text);
    const wordErrors = wordErrorCount(referenceWords, hypothesisWords);
    return {
      accent: sample.accent,
      audio: sample.audio,
      durationSeconds: sample.durationSeconds,
      elapsedSeconds,
      hypothesis: body.text.trim(),
      referenceWords: referenceWords.length,
      wer: referenceWords.length > 0 ? wordErrors / referenceWords.length : 0,
      wordErrors,
    };
  } catch (error) {
    return {
      accent: sample.accent,
      audio: sample.audio,
      durationSeconds: sample.durationSeconds,
      elapsedSeconds: (NodePerfHooks.performance.now() - startedAt) / 1_000,
      error: error instanceof Error ? error.message : String(error),
      hypothesis: "",
      referenceWords: referenceWords.length,
      wer: 1,
      wordErrors: referenceWords.length,
    };
  }
}

function printUsage() {
  process.stdout.write(`Usage:
  node infra/speech/benchmark-transcription.mjs --manifest <samples.jsonl> [options]

Options:
  --endpoint <url>       Whisper-compatible endpoint (default: ${DEFAULT_ENDPOINT})
  --label <name>         model/runtime label stored in the report
  --model <id>           model identifier for multi-model runtimes
  --output <path>        write the full JSON report
  --prompt <text>        initial vocabulary/context prompt
  --timeout-ms <number>  timeout for each sample (default: ${DEFAULT_TIMEOUT_MS})
  --help                 show this help

Manifest JSONL fields:
  {"audio":"clips/sample.wav","reference":"expected words","accent":"yoruba","durationSeconds":8.4}
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = NodeUtil.parseArgs({
    args: argv,
    options: {
      endpoint: { type: "string", default: DEFAULT_ENDPOINT },
      help: { type: "boolean", default: false },
      label: { type: "string" },
      manifest: { type: "string" },
      model: { type: "string" },
      output: { type: "string" },
      prompt: { type: "string" },
      "timeout-ms": { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    return;
  }
  if (!values.manifest) {
    printUsage();
    throw new Error("--manifest is required.");
  }

  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  const endpoint = new URL(values.endpoint).toString();
  const manifestPath = NodePath.resolve(values.manifest);
  const samples = await loadManifest(manifestPath);
  if (samples.length === 0) throw new Error("The benchmark manifest is empty.");

  const results = [];
  for (const [index, sample] of samples.entries()) {
    process.stderr.write(
      `[${index + 1}/${samples.length}] ${sample.accent}: ${NodePath.basename(sample.audio)}\n`,
    );
    results.push(
      await transcribeSample(sample, {
        endpoint,
        model: values.model?.trim() || undefined,
        prompt: values.prompt?.trim() || undefined,
        timeoutMs,
      }),
    );
  }

  const summary = summarizeBenchmark(results);
  const report = {
    createdAt: new Date().toISOString(),
    endpoint,
    label: values.label ?? endpoint,
    manifest: manifestPath,
    model: values.model?.trim() || null,
    prompt: values.prompt?.trim() || null,
    summary,
    results,
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        label: report.label,
        overall: summary.overall,
        accents: summary.accents,
      },
      null,
      2,
    )}\n`,
  );
  if (values.output) {
    await NodeFSP.writeFile(
      NodePath.resolve(values.output),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
  if (summary.overall.failed > 0) process.exitCode = 1;
}

const entrypoint = process.argv[1]
  ? NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
