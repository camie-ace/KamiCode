# Claude

This guide is for people who want to use more than one Claude setup in KamiCode.
For Codex, see [Codex](./providers-codex.md).

## Separate accounts or configurations

Use a separate Claude config directory for each account. This also works for named
presets that need different Claude settings or a router connection.

## I Only Use One Claude Account

Use the default provider.

Log in with Claude Code normally:

```bash
claude auth login
```

In KamiCode Settings, your Claude provider can stay like this:

```text
Display name: Claude
Binary path: claude
CLAUDE_CONFIG_DIR path: empty
```

An empty `CLAUDE_CONFIG_DIR path` means KamiCode uses Claude Code's normal config directory.

When you set this field, KamiCode points Claude Code at that directory with the
`CLAUDE_CONFIG_DIR` environment variable. It does not change `HOME`, so your system keychain and
the rest of your environment stay as they are.

## Reduce Context Usage

In Settings, open your Claude provider and set **Auto-compact after** to a token count between
`100000` and `1000000`. For example, `300000` compacts the conversation into a summary once it
reaches about 300,000 tokens, without changing the model's context window. Leave the field
empty to keep Claude Code's default behavior.

On web and desktop, when you return to an older Claude thread with a large context, T3 Code
offers to compact the conversation before you continue. You can also select **Compact context**
from the context meter. On every client, you can enter `/compact` in the message composer, and
Claude can show its own resume prompt when you continue an old session.

## Where Claude Skills Are Loaded

T3 Code looks for Claude skills in the Claude config directory's `skills` folder and
`<workspace>/.claude/skills`, the two places Claude Code loads them from.

If the same skill name exists in more than one folder, the one in the Claude config directory
wins, the same way Claude Code resolves it.

A skill set to `off` in Claude Code's `skillOverrides` is left out of both composer menus. A skill
marked `disable-model-invocation` still appears, because you start it yourself when you pick it.
Claude Code runs one skill per message; when a message names several, the last one runs directly and
Claude starts the others through its Skill tool, which refuses skills marked
`disable-model-invocation`.

## I Want Work And Personal Claude Accounts

Use a different Claude config directory for each account.

Example:

```text
default config dir           work account
~/.claude_personal_home      personal account
```

### Set Up The First Account

Log in normally:

```bash
claude auth login
```

In KamiCode Settings:

```text
Display name: Claude Work
Binary path: claude
CLAUDE_CONFIG_DIR path: empty
```

### Set Up The Second Account

Log in with a separate config directory:

```bash
mkdir -p ~/.claude_personal_home
CLAUDE_CONFIG_DIR=~/.claude_personal_home claude auth login
```

Use `CLAUDE_CONFIG_DIR`, not `HOME`. Setting `HOME` writes the login to
`~/.claude_personal_home/.claude`, which is not where KamiCode looks.

Then add another Claude provider in KamiCode:

```text
Display name: Claude Personal
Binary path: claude
CLAUDE_CONFIG_DIR path: ~/.claude_personal_home
```

Use the email shown in Settings to confirm each provider is using the intended account. Emails are
blurred by default; click the blurred email to reveal it.

## Can I Switch Claude Accounts In An Existing Thread?

Usually, no.

KamiCode only offers Claude providers that use the same config directory for an existing thread. A
different config directory is treated as a different Claude environment.

This is different from the recommended Codex setup. Claude Code keeps account and local state across
multiple files under its config directory, so KamiCode keeps separate config directories isolated
instead of trying to share part of the state.

## I Want To Use OpenRouter

Use this when you want Claude Code to talk to OpenRouter directly, without running a local router.
This is the simplest external-provider setup.

OpenRouter provides a Claude Code integration through Claude's Anthropic-compatible environment
variables.

### Configure A Claude OpenRouter Provider

Add or edit a Claude provider in KamiCode Settings:

```text
Display name: Claude OpenRouter
Binary path: claude
CLAUDE_CONFIG_DIR path: ~/.claude_openrouter_home
```

In that provider's Environment variables section, add:

```text
ANTHROPIC_BASE_URL   https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN sk-or-...                Sensitive
ANTHROPIC_API_KEY                              Empty value
```

Mark `ANTHROPIC_AUTH_TOKEN` as sensitive. KamiCode stores the value as a server secret and does not
send it back to the app after saving.

If you want this setup isolated from your normal Claude account, create that home first:

```bash
mkdir -p ~/.claude_personal
CLAUDE_CONFIG_DIR=~/.claude_personal claude auth login
```

Add another Claude instance in **Settings > Providers**:

| Instance        | Binary path | CLAUDE_CONFIG_DIR path |
| --------------- | ----------- | ---------------------- |
| Claude Work     | `claude`    | Leave empty            |
| Claude Personal | `claude`    | `~/.claude_personal`   |

On mobile, tap **Add Claude account** in **Settings > Providers** and enter a name and the
config folder. The login itself still happens on the environment's machine.

An empty config-directory setting uses Claude Code's normal configuration. The
custom setting changes `CLAUDE_CONFIG_DIR`, leaving `HOME` and the system keychain
location intact. Use the same variable for the login command. Setting `HOME`
instead can put credentials where this provider will not find them.

Check the account reported in provider settings after signing in. Existing
threads can switch only between Claude instances with the same config directory.
Separate account directories stay isolated, including their local conversation
state. Claude does not have Codex's shared-home and shadow-home arrangement.

For presets that differ only in API keys or endpoints, use the instance's
**Environment variables**. Variable assignments do not belong in **Launch arguments**.

File paths in the `--settings` and `--append-system-prompt-file` launch arguments
can start with `~` for the home directory of the machine running T3 Code. Any
other relative path is read from the thread's project folder, or its worktree.

Claude Code's verbose mode can stay enabled when you use Claude for text generation, including
thread titles, branch names, commit messages, and pull request descriptions. On a remote connection,
T3 Code uses the Claude configuration on the connected server.

## Compact long conversations

Set **Auto-compact after** in the Claude provider settings to an integer between
`100000` and `1000000`. For example, `300000` asks Claude to summarize at about
300,000 tokens. This changes when compaction happens, not the model's context
window. Leave it empty for Claude Code's default.

You can also send `/compact` in an existing conversation. Claude Code also
compacts automatically. To see context usage, see
[commands and skills](./composer.md#commands-and-skills).

When you return to a large thread after Claude's prompt cache expires, a
**Compact** chip with the thread's token count shows
next to the send button. While it is on, Enter summarizes the history first, then
sends your message. Click the chip to switch it to **Keep** and keep the full
history for that message. The mobile app shows no chip: an eligible message sent
from it summarizes first. The cache lasts about an hour on a Claude
subscription and 5 minutes with an API key, Bedrock, or Vertex. See [commands and skills](./composer.md#commands-and-skills) for using
composer commands.

**Compact idle threads** in **Settings > Providers > Advanced** controls this for threads
over 200,000 tokens. Each Claude provider's settings can override it:

- **When you return** shows the **Compact** chip described above. This is the default.
- **Before the cache expires (beta)** tries to compact an idle thread shortly before its
  prompt cache expires, while the history is still cached.
  The compaction appears in the thread as a `/compact` turn sent by T3 Code.
  If the window is missed, such as when you enable this mode after the cache has
  expired or the server restarts before compaction runs, it falls back to
  **When you return**. Switch the chip to **Keep** to keep the full history for that message.
- **Never** skips idle compaction and Claude's resume prompt. **Auto-compact after**
  still applies, and you can still compact by hand.

## Usage limits

If your Claude subscription runs out of usage mid-turn, the thread shows which
limit was reached and the remaining wait when Claude provides a reset time.
Claude Code holds the turn until that window reopens, so it can keep showing as
working. Wait for the reset, or stop the turn and continue later. The warning's
timestamp shows when the displayed wait started.

## Skills

KamiCode does not need a special Claude Code Router provider. Treat the router as a Claude
environment: give a Claude provider its own `CLAUDE_CONFIG_DIR path`, and put whatever variables
the router tells you to export into that provider's Environment variables section. Mark tokens
and API keys as sensitive.

Use `$` in the composer to select a skill. Enabled installed Claude plugins,
and plugins synced from your claude.ai account, also contribute skills under
names such as `plugin:review`. Skills marked `disable-model-invocation` can
still be started by you. Invoke those one per message: Claude directly runs only
the last named skill and may try to start earlier ones through its Skill tool,
which refuses skills reserved for manual invocation.

## Task lists

To show Claude task lists in the web and desktop apps, add
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` under **Variables** in the Claude instance's
**Environment** section in **Settings > Providers**. Each update shows as a Tasks
row in the thread; open it to see every step.

## Claude in Chrome

Claude threads can use the Claude in Chrome extension, which works in your own
Chrome with its sign-ins. T3 Code sessions load it only when asked: add `--chrome`
to **Launch arguments** in the Claude instance's settings in **Settings > Providers**.
It applies to sessions that start after you save. Set up the extension as you would
for Claude Code first; see Claude Code's [Chrome guide](https://code.claude.com/docs/en/chrome).

The instance must be signed in with `/login` on a direct Anthropic plan. Instances
that use an API key or a `claude setup-token` token don't get it, even with
`--chrome`, and neither do third-party providers such as Amazon Bedrock. Claude Code
doesn't support it in WSL.

## OpenRouter

Create a Claude instance with its own config directory, such as
`~/.claude_openrouter`, and keep **Binary path** set to `claude`. In that instance's
**Environment variables**, use:

| Variable               | Value                                     |
| ---------------------- | ----------------------------------------- |
| `ANTHROPIC_BASE_URL`   | `https://openrouter.ai/api`               |
| `ANTHROPIC_AUTH_TOKEN` | Your OpenRouter API key, marked Sensitive |
| `ANTHROPIC_API_KEY`    | An explicitly empty value                 |

If that Claude config directory has a cached Anthropic login, run `/logout` in a
Claude Code session using that directory before starting the router setup. Cached
login credentials can conflict with the router token.

Select the model you want in T3 Code. For an OpenRouter model outside the built-in
list, open that Claude instance in **Settings > Providers** and add its full model
ID with **Add custom model**. Then select it in the chat model picker.
`ANTHROPIC_DEFAULT_*_MODEL` variables map Claude Code aliases such as `sonnet`; they
do not replace the explicit model ID selected in T3 Code. Custom models may have
fewer effort, thinking, or context controls than built-in models.

Verify the model used in OpenRouter's activity dashboard. For current compatibility
requirements, use the
[OpenRouter Claude Code guide](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration).

## Other routers

A local router uses an ordinary Claude provider instance. Give it a separate
config directory and put the router's endpoint and credential variables in that
instance's **Environment variables**. The router must run where the environment
can reach it. Follow the [Claude Code Router instructions](https://github.com/musistudio/claude-code-router)
for its installation and routing configuration.
