# Codex

This guide is for people who want to use more than one Codex account in KamiCode.

Common reasons:

- use a work account for work projects
- use a personal account for personal projects
- switch to another account when one account hits limits
- keep one shared Codex history instead of maintaining two separate Codex setups

## I Only Use One Codex Account

Use the default provider.

In Settings, your Codex provider can stay like this:

```text
Display name: Codex
CODEX_HOME path: ~/.codex
Shadow home path: empty
```

Log in with Codex normally:

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

## I Want Work And Personal Codex Accounts

Use one real Codex home and one shadow home.

Recommended setup:

```text
~/.codex      shared Codex home
~/.codex_p    second account auth
```

The idea is:

- both accounts can see the same T3/Codex sessions
- each account keeps its own login
- existing threads can continue with either account

### Set Up The First Account

Log in normally:

```bash
codex login
```

This is the account used by `~/.codex`.

In KamiCode Settings, name it something obvious:

```text
Display name: Codex Work
CODEX_HOME path: ~/.codex
Shadow home path: empty
```

### Set Up The Second Account

Log in with a separate Codex home:

```bash
mkdir -p ~/.codex_p
CODEX_HOME=~/.codex_p codex login
```

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

That means separate sessions and less account switching inside old threads. Most dual-account users
should use the shared-home plus shadow-home setup instead.
