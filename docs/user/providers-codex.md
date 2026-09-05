# Codex

This guide is for people who want to use more than one Codex account in KamiCode.
For Claude, see [Claude](./providers-claude.md).

## Use multiple accounts

A shared Codex home with a shadow home lets work and personal accounts continue
the same threads. The accounts share Codex sessions and configuration while keeping
their own login and available models.

Keep your first account in `~/.codex`. On the environment's machine, sign the
second account into a fresh directory:

```bash
codex login
```

## GPT-5.6 Models

KamiCode asks `codex app-server` for the model list for each configured account. Models appear in
the picker when Codex reports them for that account, so rollout state and workspace admin policy can
change what you see.

As of July 9, 2026, OpenAI docs list these GPT-5.6 Codex model slugs:

- `gpt-5.6`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

KamiCode defaults new Codex sessions to `gpt-5.6` and defaults internal git/title/PR helper
generation to `gpt-5.6-terra`.

Short aliases are accepted in custom model fields and model-selection inputs:

```text
5.6        -> gpt-5.6
sol        -> gpt-5.6-sol
terra      -> gpt-5.6-terra
luna       -> gpt-5.6-luna
5.6-sol    -> gpt-5.6-sol
5.6-terra  -> gpt-5.6-terra
5.6-luna   -> gpt-5.6-luna
```

Local Codex config can also pin a model:

```toml
model = "gpt-5.6"
model_reasoning_effort = "medium"
```

For a named variant:

```toml
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
```

If Codex reports service tiers for a model, KamiCode shows a Service Tier control and forwards the
selected tier to Codex for the thread or turn.

## Send feedback to OpenAI

In an existing Codex thread, send `/feedback` or `/feedback` followed by a description of the
issue. KamiCode uploads the thread and Codex logs to OpenAI and shows a thread ID that you can copy
and share with OpenAI employees.

## Sub-agent models

The web and desktop Agents panel shows each sub-agent's model and reasoning effort when Codex
reports them. If Codex does not report either value, T3 Code leaves it out instead of using the
parent agent's settings.

## Browser and computer activity

Browser and Computer Use calls show their user-facing task title when Codex provides one. Expanded
activity groups show an icon for every call. Website calls use the active page's favicon when it is
available, and desktop app calls use the app's native icon on macOS when available. Other hosts use
a generic fallback glyph.

Collapsed activity groups are summarized by source, such as `Used Chrome integration`, instead of
showing the underlying tool name. Website favicons and native app icons keep their original colors;
integrations that provide separate light and dark logos use the logo for the current appearance.

## Approve access to other apps

When a Codex tool needs access to an app such as Safari, KamiCode shows the app name and asks for
approval. You can approve, decline, or cancel the request from the desktop app, web app, or mobile
app. Some tools also offer approval for the current session or permanent approval.

## I Want Work And Personal Codex Accounts

Use one real Codex home and one shadow home.

Recommended setup:

```text
~/.codex      shared Codex home
~/.codex_p    second account auth
```

Then add a second Codex instance in **Settings > Providers**:

| Instance       | CODEX_HOME path | Shadow home path    |
| -------------- | --------------- | ------------------- |
| Codex Work     | `~/.codex`      | Leave empty         |
| Codex Personal | `~/.codex`      | `~/.codex_personal` |

Both instances must use the same **CODEX_HOME path**. T3 Code prepares the shared
state in the shadow directory; do not populate it by copying your whole Codex
home.

The shadow account needs its own `auth.json` file. If Codex uses an OS credential
store, configure file storage for this setup. See
[OpenAI's credential storage guide](https://learn.chatgpt.com/docs/auth#credential-storage).

Use a completely separate **CODEX_HOME path**, with no shadow home, when you want
separate Codex sessions and configuration. That instance cannot continue threads
from the other home.

## Switch accounts in an existing thread

In KamiCode Settings, name it something obvious:

If the account is missing from the picker, compare the home paths in provider
settings. If two instances show the same unexpected account or models, check their
reported accounts, refresh provider status, and confirm the second instance has
its own shadow path and login. A shadow-home conflict usually means the directory
contains a copied Codex setup. Use a fresh shadow directory and sign in again.

## Answer questions while Codex works

Codex can ask a question and keep working. Answer it in the thread's question
panel. The answer becomes a new message: it reaches the active turn, or starts
another turn if Codex has finished. Unanswered questions survive reconnects.
This requires a Codex version that supports async questions.

## Approve app access

In KamiCode Settings, add another Codex provider:

```text
Display name: Codex Personal
CODEX_HOME path: ~/.codex
Shadow home path: ~/.codex_p
```

The important part is that both providers use the same `CODEX_HOME path`, but only the second one
has a `Shadow home path`.

## Which Account Am I Using?

Open Settings and look at the provider row.

KamiCode shows the authenticated email for providers that report one. Emails are blurred by default;
click the blurred email to reveal it.

Use display names and accent colors to make accounts easy to tell apart in the model picker.

## I Need A Different API Key Or Endpoint

Use the provider's Environment variables section in Settings.

This is useful when a Codex-compatible setup needs account-specific variables. Add the variables to
the provider instance that should receive them, and mark API keys or tokens as sensitive. Sensitive
values are stored as server secrets and are not sent back to the app after saving.

## Can I Switch Accounts In An Existing Thread?

Yes, when both Codex providers share the same `CODEX_HOME path`.

For example:

```text
Codex Work      CODEX_HOME path: ~/.codex
Codex Personal  CODEX_HOME path: ~/.codex, Shadow home path: ~/.codex_p
```

Those two providers are considered compatible for continuation, so the locked model picker can show
both.

If you add a third Codex provider with a completely different `CODEX_HOME path`, KamiCode treats it
as a different workspace. It will not be offered for existing threads created under `~/.codex`.

## If Both Accounts Look The Same

If two Codex providers show the same account or the same unexpected model list:

1. Check the email in Settings.
2. Refresh provider status.
3. Confirm the second provider has `Shadow home path` set.
4. Confirm the shadow directory has its own `auth.json`.
5. If you copied `~/.codex` into the shadow directory, remove everything except `auth.json`.

Example cleanup:

```bash
find ~/.codex_p -mindepth 1 ! -name auth.json -exec rm -rf {} +
```

## When To Use A Separate CODEX_HOME

Use a totally separate `CODEX_HOME path` only when you want a separate Codex workspace.

In an existing Codex thread, send `/feedback` with an optional description, for
example `/feedback The agent stopped before finishing the tests`. This uploads
the conversation and Codex logs to OpenAI. The returned thread ID can be shared
with OpenAI support.
