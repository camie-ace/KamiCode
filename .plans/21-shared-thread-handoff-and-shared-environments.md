# Shared Thread Handoff and Shared Environments

## Purpose

Let a thread survive source-machine loss and let another teammate continue it without needing
network access to the original PC.

This is not LAN access, Tailscale access, or live process migration. A shared thread is a portable
handoff package that lets a different execution environment reconstruct enough state to continue
the same KamiCode thread with a new local provider runtime.

## Product Model

Thread visibility/execution states:

- `local`: thread state and worktree live only on the current machine.
- `sharing`: KamiCode is packaging transcript, repo state, untracked files, and memory.
- `shared`: canonical handoff state exists on the shared backend/VPS.
- `out-of-sync`: local state changed after the last successful shared snapshot.
- `vps-ready`: VPS managed clone/worktree has applied and verified the shared snapshot.
- `vps-active`: a web/mobile or teammate session is continuing the thread on VPS.

The thread context menu should add:

- `Share thread`
- `Sync shared thread now` when already shared and dirty
- `Open shared copy` when a VPS copy exists
- `Stop sharing` when the user has permission

## Core Rule

Do not try to move the running Codex, Claude Code, Cursor, or OpenCode process.

At a turn boundary, persist the conversation and workspace state, then start a new provider runtime
in the target environment using the shared canonical thread record.

## Handoff Package

The package should include:

- thread id, title, project/workspace id, author, source environment id, and timestamps
- provider/model/runtime settings needed for the next turn
- conversation transcript and structured turn/event history
- repo identity, branch, base commit, working tree path mapping, and staged state
- tracked file changes as patches or a structured file delta
- untracked files as a bounded file bundle with checksums
- ignored files only after explicit user approval
- CAMI project memory snapshot and memory write metadata
- package manifest with size, file count, checksums, and compatibility version

## Repo State Strategy

GitHub remains the canonical long-term source of repo truth, but Git alone is not enough for handoff.
The handoff package must preserve local work that has not been committed or pushed.

Apply order on the VPS:

1. Ensure the managed clone has the expected repository and base commit.
2. Create or reuse a deterministic VPS worktree for the shared thread.
3. Apply tracked file patches.
4. Restore staged state when possible.
5. Restore untracked file bundle.
6. Verify checksums.
7. Mark the thread `vps-ready`.

If the VPS cannot find the base commit, it should fetch from GitHub. If the commit still cannot be
found, the handoff should fail with a clear "source commit unavailable" state.

## Project Memory

CAMI project memory should become a shared project artifact instead of a purely local file.

Memory writes need metadata:

- project id
- repo/workspace id
- source thread id
- source turn id
- author/user id
- source environment id
- timestamp

Merge rules:

- append-only facts can merge automatically
- edits/retractions need explicit revision records
- contradictory facts should be shown as conflicts, not silently overwritten
- every memory fact should remain traceable to the thread/turn that wrote it

## Sync Behavior

Initial `Share thread` creates the first handoff package.

After that, shared threads should sync automatically at safe points:

- after a turn completes
- after a user manually clicks `Sync shared thread now`
- before switching execution from desktop to VPS
- before another user starts continuing the thread

Do not sync while a provider process is actively mutating files unless the runtime can establish a
stable snapshot. Prefer turn-boundary snapshots first.

## Collaboration Behavior

When a teammate opens a shared thread:

- they see the same thread title, transcript, and project memory
- they run against the VPS managed worktree, not the source user's PC
- the UI shows who last synced the thread and whether the source PC is currently online
- only one active writer should own the next turn unless multi-writer conflict handling is built
- later local desktop users pull through Git or an explicit shared snapshot import

## Security And Safety

- Never include `.env`, credentials, key files, local databases, or ignored files by default.
- Show a file summary before uploading large or ignored bundles.
- Enforce GitHub-derived workspace/repo access before allowing another user to open a shared thread.
- Store uploaded handoff bundles encrypted at rest.
- Redact secrets from audit logs and package manifests.
- Make shared thread access revocable.
- Track all opens, syncs, package downloads, and continuation turns in the audit log.

## Failure States

Represent these explicitly in the UI:

- source PC offline before initial sync finished
- handoff package upload failed
- VPS clone missing base commit
- patch conflict while applying tracked changes
- untracked file bundle too large
- ignored file requires explicit approval
- project memory conflict
- user lacks access to one or more repos in the workspace

## Phases

### Phase 1: Manual Share Thread

- Add thread context-menu action.
- Create handoff package manifest.
- Upload transcript, tracked patch, untracked file bundle, and memory snapshot.
- Apply package to a VPS worktree.
- Let the same user continue from web/mobile.

### Phase 2: Team Continuation

- Enforce workspace/repo access for shared thread opens.
- Add shared-thread list/filter indicators.
- Let an authorized teammate continue the VPS copy.
- Add audit events for share/open/continue.

### Phase 3: Continuous Shared Sync

- Auto-sync at turn boundaries.
- Show `out-of-sync` and `vps-ready` states.
- Add conflict handling for repo patch and memory writes.
- Add notification when a teammate continues a shared thread.

### Phase 4: Desktop Rehydration

- Let a desktop import the latest shared snapshot into a local clone/worktree.
- Reconcile with local Git state.
- Continue locally after explicit ownership transfer.

## Acceptance Criteria

- A local desktop thread can be shared from the context menu.
- The shared package includes transcript, tracked repo changes, untracked files, and project memory.
- The VPS can reconstruct the worktree and continue the thread with a new provider runtime.
- If the source PC goes offline after successful sync, web/mobile continuation still works.
- A teammate with repo access can continue the shared thread.
- A teammate without repo access cannot open or apply the shared thread state.
- Ignored files are excluded unless explicitly approved.
- Project memory facts written before sharing are visible in the VPS continuation.
- Project memory facts written on the VPS sync back into the shared project memory record.
