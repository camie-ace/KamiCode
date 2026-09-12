# Project memory retention and injection

KamiCode reads `.camie/project-memory.md` from the session working directory, walking
up through ancestors until it finds an existing file. A provider session takes one
snapshot at establishment. It does not reread the file on every user turn.

## Budget and visibility

`KAMICODE_PROJECT_MEMORY_MAX_CHARS` accepts a positive safe integer. Its default is
40,000 characters; invalid values produce a warning and use the default. Set it in
the server environment and restart that server to apply deployment configuration.

Above 80% of the configured budget, each new provider session emits a warning to
the server log and the existing work-log activity stream. Above the budget, only
complete newest lines are injected, preceded by a count of omitted earlier lines.
The retained content is at most the budget; the marker is additional overhead.
A line larger than the whole budget is omitted rather than split. Small files are
returned verbatim. JavaScript string length measures UTF-16 code units.

The cap limits injected memory, not file growth. Keep memory below 80% by curating
and archiving it. The two sections are:

```markdown
## Standing facts

Durable paths, commands, constraints, preferences, and operational gotchas.

## Recent activity

Dated summaries that can be deduplicated and archived when obsolete.
```

Standing facts must never be automatically evicted during maintenance. Emergency
injection truncation still keeps the tail of the complete file: it does not yet
reserve a separate budget for standing facts. A truncation warning therefore
requires maintenance; the format convention alone cannot guarantee retention.

## Worktrees and Git

Keep `.camie/` local and ignored. Stage explicit paths and review the index.
CI rejects tracked files beneath any `.camie/` directory.

A child worktree with no local memory file inherits its parent workspace memory
through the existing ancestor walk. Before removing an old fork from the lookup
path, archive its exact bytes and merge unique facts into the parent. Historical
branches can restore tracked memory when checked out until they incorporate the
ignore/untracking change. Worktrees outside the parent directory hierarchy cannot
inherit it via this walk; no Git-common-directory inference is implemented.

## Injection positions

| Provider | Current injection position                          | Evidence in this checkout                                                                |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Codex    | `collaborationMode.settings.developer_instructions` | `buildCodexCollaborationMode` in `CodexSessionRuntime.ts`                                |
| Claude   | Prefix on the first ordinary user message           | `buildUserMessageEffect` in `ClaudeAdapter.ts`; Claude Code system preset remains in use |
| OpenCode | Text part in the first SDK session prompt           | `sendTurn` in `OpenCodeAdapter.ts`                                                       |
| Cursor   | Text part in the first ACP prompt                   | `sendTurn` in `CursorAdapter.ts`                                                         |

Grok and Antigravity currently do not call the shared project-memory reader; this change does not introduce memory injection for them.

The positions are verified in source; the original design rationale is not
documented. The adapters already use different native prompt contracts, so moving
memory into system-level fields would change precedence and may alter caching.
The cache impact has not been measured. No injection position was changed by this
remediation. Memory is subordinate to the user's current instructions by policy,
although that text does not itself change native provider message roles.

## Session recreation and stale facts

`ProviderCommandReactor.ensureSession` restarts sessions for runtime mode,
interaction mode, working directory, provider instance, unsupported model
switches, and Claude model-selection changes. `ProviderService` can recover a
missing in-memory session from its stored binding. Process restart loses those
in-memory contexts and the next recovery rereads memory. Claude also replaces an
existing context when `startSession` is called again. A browser reconnect alone
does not necessarily recreate a healthy provider session. No generic idle-timeout
recreation trigger was found in these paths.

The original implementation reproduced two unversioned snapshots after a corrected
file was reread. Clearing the file emitted no replacement block, leaving older
facts available without a supersession notice.

Each injection now carries a SHA-256 content revision and a policy that the latest
snapshot in conversation order supersedes all earlier memory blocks, including
legacy unversioned ones. An explicitly empty snapshot also replaces earlier facts.
Missing facts must be reread from the canonical file before reuse, which covers
both deletion and emergency truncation. The hash identifies content; ordering comes
from the conversation, so clock skew and process restarts cannot reset a counter.

The shared helper regression and a mocked Claude adapter resume test cover
correction, deletion, and empty memory. These verify the prompts sent to a provider;
they do not prove that a language model will obey supersession, nor do they erase
old messages from a provider's history. No live conversation was modified to test
this behavior.

## Compaction safeguards

Archive original bytes before writing a sibling candidate. Replacement must reject
missing operational literals, removed caution lines without human review, output
outside 10–90% of original size, and a file above the headroom target. Check for a
concurrent writer before replacement. Archives are immutable by convention and
must not be committed.

Some accumulated files cannot satisfy these rules: protected caution lines alone
may exceed the entire cap, and a file above 400,000 characters cannot fit below
40,000 while retaining at least 10%. In that case preserve the live original and
report the failed gates; do not silently weaken the loss check.
