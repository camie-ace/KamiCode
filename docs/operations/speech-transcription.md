# API speech transcription

KamiCode can turn composer recordings of up to five minutes into text through an
OpenAI-compatible transcription API. The browser rotates the microphone into independently
decodable 20-second parts and sends them serially through KamiCode's authenticated, validated upload
route. Audio is forwarded by the server; the API key is never sent to the browser.

## Configure the API

Open **Settings → Providers**, choose the environment, and save an OpenAI API key under **Speech
transcription**. KamiCode stores the key in that environment's protected server secret directory;
the settings API returns only whether a key is configured, never the key itself. Saving or replacing
the key takes effect on the next recording without restarting the server.

For unattended deployments, the environment variable remains available as a fallback:

```sh
export T3CODE_SPEECH_TRANSCRIPTION_API_KEY='your-api-key'
```

By default, KamiCode sends multipart requests to
`https://api.openai.com/v1/audio/transcriptions` with the `whisper-1` model. The request includes the
recording as `file`, `model`, `response_format=json`, and `temperature=0.0`, following the
[OpenAI transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

Use the optional settings below only when a different OpenAI-compatible endpoint or model is
required:

```sh
export T3CODE_SPEECH_TRANSCRIPTION_URL='https://api.openai.com/v1/audio/transcriptions'
export T3CODE_SPEECH_TRANSCRIPTION_MODEL='whisper-1'
export T3CODE_SPEECH_TRANSCRIPTION_PROMPT='Nigerian English. KamiCode, TypeScript, JavaScript, React, GitHub, Playwright, Docker, API, CLI.'
```

The optional prompt supplies vocabulary and locale context. KamiCode normalizes whitespace and
limits it to 1,000 characters before forwarding it. A key saved through Settings takes precedence
over `T3CODE_SPEECH_TRANSCRIPTION_API_KEY`; clearing the saved key returns to the environment value.

## Configure a background service

Keep the key in a root-readable environment file rather than the unit definition:

```sh
sudo install -d -m 0700 /etc/kamicode
sudo install -m 0600 /dev/null /etc/kamicode/speech-transcription.env
sudoedit /etc/kamicode/speech-transcription.env
```

```ini
T3CODE_SPEECH_TRANSCRIPTION_API_KEY=your-api-key
T3CODE_SPEECH_TRANSCRIPTION_MODEL=whisper-1
T3CODE_SPEECH_TRANSCRIPTION_PROMPT=Nigerian English. KamiCode, TypeScript, JavaScript, React, GitHub, Playwright, Docker, API, CLI.
```

Reference that file from the service:

```ini
[Service]
EnvironmentFile=/etc/kamicode/speech-transcription.env
```

Reload the service manager and restart KamiCode only after active work finishes. Confirm that voice
dictation can transcribe a short recording before removing any previous local runtime.

The browser caps a voice session at five minutes and rotates it every 20 seconds. The server accepts
each audio part up to 12 MB, validates common browser audio MIME types, times each API request out
after 60 seconds, and never returns audio to the client. A brief connection failure is retried once;
if any part still fails, KamiCode refuses to insert a silently incomplete transcript.
