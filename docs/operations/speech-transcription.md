# Local speech transcription

KamiCode can turn short composer recordings into text through a private, persistent
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) server. The browser uploads one authenticated
recording to KamiCode; KamiCode validates it and forwards it to a loopback-only `/inference`
endpoint. The model stays warm in memory, and model work is serialized so concurrent requests do
not saturate the host.

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

## Enable it in KamiCode

For a foreground server, export the endpoint before starting KamiCode:

```sh
export T3CODE_SPEECH_TRANSCRIPTION_URL=http://127.0.0.1:8087/inference
```

For the Linux background service, add a systemd user override:

```sh
systemctl --user edit t3code.service
```

```ini
[Service]
Environment="T3CODE_SPEECH_TRANSCRIPTION_URL=http://127.0.0.1:8087/inference"
```

Then restart the backend after active work finishes:

```sh
systemctl --user daemon-reload
systemctl --user restart t3code.service
```

The environment advertises voice dictation only when this setting is present, so older and
unconfigured servers simply hide the microphone.

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

Useful diagnostics:

```sh
journalctl -u kamicode-whisper.service --since '10 minutes ago'
systemctl show kamicode-whisper.service -p MemoryCurrent -p CPUUsageNSec
```

The browser caps recordings at 60 seconds. The server accepts one audio part up to 12 MB, validates
common browser audio MIME types, times model requests out after 60 seconds, and never returns audio
to the client.
