# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On web and desktop, HEIC and HEIF photos are automatically converted to JPEG when you drag them into
the composer or paste them into a message.

## Voice dictation

When the connected environment has local speech transcription enabled, the composer shows a
microphone beside the attachment button. Select it, speak for up to five minutes, then select the
stop button. KamiCode processes the recording in short parts while you continue speaking, then
inserts the complete transcript at the cursor so you can edit it before sending. It never sends a
dictated prompt automatically.

While recording, select **Discard recording** to cancel without uploading more audio. You can also
cancel while KamiCode is finishing a longer transcript. The browser asks for microphone permission
the first time. If the control is missing, the connected environment has not enabled transcription;
if it is disabled, reconnect the environment first.

Audio is sent over the existing authenticated environment connection and transcribed by that
environment's loopback speech service. KamiCode does not send it to a third-party transcription API.
The recording is temporary; the resulting text becomes part of the normal composer draft. If any
part cannot be transcribed after a brief retry, KamiCode reports the failure instead of inserting an
incomplete transcript.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.

When a turn finishes while the app is not focused, web and desktop play a neutral 1.5-second
completion chime. Returning to the app stops it immediately.
