# Local speech transcription

KamiCode can turn composer recordings of up to five minutes into text through a private, persistent
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) server. The browser rotates the microphone
into independently decodable 20-second parts and transcribes them serially while recording
continues. Each part uses KamiCode's authenticated, validated upload route and a loopback-only
`/inference` endpoint. The model stays warm in memory, and model work is serialized so concurrent
requests do not saturate the host.

This setup is intended for a Linux web server. An 8-vCPU, 24-GB host has ample memory for
`tiny.en` (about 273 MB at runtime). CPU speed, not memory, is normally the constraint. Benchmark
the actual host before enabling the capability; for the bundled 11-second sample, a warm response
under ten seconds is a reasonable CPU-only target.

## Install whisper.cpp

The following pins the runtime to `v1.9.1`, enables OpenBLAS on CPU, and downloads the English
`tiny` model. Run it as an administrator on Debian or Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y build-essential cmake ffmpeg git libopenblas-dev

sudo git clone --branch v1.9.1 --depth 1 \
  https://github.com/ggml-org/whisper.cpp.git \
  /opt/kamicode-whisper

sudo cmake -S /opt/kamicode-whisper -B /opt/kamicode-whisper/build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_BLAS=ON \
  -DGGML_BLAS_VENDOR=OpenBLAS \
  -DWHISPER_BUILD_TESTS=OFF
sudo cmake --build /opt/kamicode-whisper/build --config Release --parallel 8
sudo sh /opt/kamicode-whisper/models/download-ggml-model.sh tiny.en
```

Verify the downloaded model before starting it:

```sh
printf '%s  %s\n' \
  c78c86eb1a8faa21b369bcd33207cc90d64ae9df \
  /opt/kamicode-whisper/models/ggml-tiny.en.bin | sha1sum --check
```

## Run the sandboxed service

Copy [`infra/speech/kamicode-whisper.service`](../../infra/speech/kamicode-whisper.service) to
`/etc/systemd/system/kamicode-whisper.service`, then start it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now kamicode-whisper.service
sudo systemctl status kamicode-whisper.service
curl --fail --silent http://127.0.0.1:8087/ >/dev/null
```

The unit binds only to `127.0.0.1`, runs under a dynamic unprivileged identity, limits inference to
seven CPU cores and 1 GB of memory, and gives ffmpeg only a private runtime directory. Do not expose
the whisper server on a public or Tailnet interface. Its upload endpoint is deliberately behind
KamiCode's authenticated, size-limited route.

The unit reads an optional `/etc/kamicode/whisper.env` so a benchmark winner can replace the model
without editing the unit:

```ini
KAMICODE_WHISPER_MODEL=/opt/kamicode-whisper/models/ggml-base.en.bin
KAMICODE_WHISPER_THREADS=7
```

Create the directory and file with administrator-only write access, then run `systemctl daemon-reload`
and restart the service. Larger models may also need a deliberate `MemoryMax` override; do not raise
that guard until the selected model's measured peak memory is known.

## Enable it in KamiCode

For a foreground server, export the endpoint before starting KamiCode:

```sh
export T3CODE_SPEECH_TRANSCRIPTION_URL=http://127.0.0.1:8087/inference
export T3CODE_SPEECH_TRANSCRIPTION_PROMPT='Nigerian English. KamiCode, TypeScript, JavaScript, React, GitHub, Playwright, Docker, API, CLI.'
```

For the Linux background service, add a systemd user override:

```sh
systemctl --user edit t3code.service
```

```ini
[Service]
Environment="T3CODE_SPEECH_TRANSCRIPTION_URL=http://127.0.0.1:8087/inference"
Environment="T3CODE_SPEECH_TRANSCRIPTION_PROMPT=Nigerian English. KamiCode, TypeScript, JavaScript, React, GitHub, Playwright, Docker, API, CLI."
```

Then restart the backend after active work finishes:

```sh
systemctl --user daemon-reload
systemctl --user restart t3code.service
```

The environment advertises voice dictation only when this setting is present, so older and
unconfigured servers simply hide the microphone.

The optional prompt is vocabulary and locale context, not accent training. Keep it short and use it
for product names, frameworks, commands, and other words the model commonly misspells. KamiCode
normalizes whitespace and limits the prompt to 1,000 characters before forwarding it to Whisper.

KamiCode can also target a loopback Whisper-compatible runtime that hosts multiple models. Set
`T3CODE_SPEECH_TRANSCRIPTION_MODEL` to the model identifier that runtime expects; KamiCode then adds
the `model` field to every multipart request. Leave it unset for the bundled `whisper.cpp` service,
whose model is selected by the systemd unit instead. This allows a benchmark winner such as a
CPU-INT8 `faster-whisper` model to replace `whisper.cpp` without changing the browser or API route.

## Benchmark and tune

Warm the model once, then measure the bundled sample (roughly 11 seconds of speech):

```sh
curl --silent --show-error http://127.0.0.1:8087/inference \
  --form file=@/opt/kamicode-whisper/samples/jfk.wav \
  --form temperature=0.0 \
  --form response_format=json >/dev/null

curl --silent --show-error --output /tmp/kamicode-whisper-result.json \
  --write-out 'warm transcription: %{time_total}s\n' \
  http://127.0.0.1:8087/inference \
  --form file=@/opt/kamicode-whisper/samples/jfk.wav \
  --form temperature=0.0 \
  --form response_format=json
```

If accuracy is insufficient and a slower response is acceptable, download `base.en`, verify its
published checksum, change the unit's model path, raise `MemoryMax` if needed, and restart it.
`base.en` needs about 388 MB and is more accurate but materially slower on CPU-only hosts. Integer
quantization can reduce disk and memory use, but benchmark it: it does not improve latency on every
CPU. If `tiny.en` itself misses the target, use a CPU accelerator/GPU or leave the capability
disabled instead of making the composer feel unresponsive.

### Benchmark Nigerian English

Do not choose a production model from a generic English sample alone. The checked-in benchmark
harness reports weighted word error rate (WER), real-time factor, severe failures, and results split
by accent group:

```sh
node infra/speech/benchmark-transcription.mjs \
  --manifest /srv/kamicode-speech-benchmark/nigerian-english.jsonl \
  --endpoint http://127.0.0.1:8087/inference \
  --label whisper-cpp-tiny-en \
  --prompt 'Nigerian English. KamiCode, TypeScript, GitHub, Playwright.' \
  --output /tmp/whisper-cpp-tiny-en.json
```

For a multi-model runtime, add the same model identifier used in server configuration:

```sh
node infra/speech/benchmark-transcription.mjs \
  --manifest /srv/kamicode-speech-benchmark/nigerian-english.jsonl \
  --endpoint http://127.0.0.1:8088/v1/audio/transcriptions \
  --model Systran/faster-whisper-small.en \
  --label faster-whisper-small-en-int8 \
  --output /tmp/faster-whisper-small-en-int8.json
```

The manifest is newline-delimited JSON. Audio paths may be absolute or relative to the manifest;
`durationSeconds` is required so real-time factor comparisons remain valid:

```json
{"audio":"clips/yoruba-001.wav","reference":"Open the KamiCode project and run the TypeScript tests.","accent":"yoruba","durationSeconds":6.8}
{"audio":"clips/igbo-001.wav","reference":"Please inspect the GitHub workflow before deploying.","accent":"igbo","durationSeconds":5.9}
```

Use a speaker-disjoint, stratified sample covering at least Yoruba-, Igbo-, Hausa-, Ijaw-, and
Pidgin-influenced English, plus opt-in KC recordings with real phone microphones and coding terms.
[`AfriSpeech-Countries`](https://huggingface.co/datasets/intronhealth/afrispeech-countries) includes a
Nigeria benchmark subset, and
[`AfriSpeech-200`](https://huggingface.co/datasets/intronhealth/afrispeech-200) contains broader
Nigerian accent coverage. Both publish licensing terms that must be reviewed before downloading,
redistributing, or using the recordings for production training.

Compare the current `tiny.en` baseline with `base.en` and `small.en`, plus CPU INT8
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) candidates. An African-accent-tuned
model may be included as an accuracy reference, but it must still pass the actual host's latency and
licensing gates. A reasonable launch gate is at least 20% lower WER than the current baseline with
no major Nigerian accent group regressing materially. Also inspect named-entity and code-term errors;
aggregate WER can hide the mistakes that make a coding prompt unusable.

Useful diagnostics:

```sh
journalctl -u kamicode-whisper.service --since '10 minutes ago'
systemctl show kamicode-whisper.service -p MemoryCurrent -p CPUUsageNSec
```

The browser caps a voice session at five minutes and rotates it every 20 seconds. The server accepts
each audio part up to 12 MB, validates common browser audio MIME types, times each model request out
after 60 seconds, and never returns audio to the client. A brief connection failure is retried once;
if any part still fails, KamiCode refuses to insert a silently incomplete transcript.
