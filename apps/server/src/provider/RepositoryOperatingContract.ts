/**
 * Provider-independent repository safety and storage contract.
 *
 * This is intentionally structural: it describes how to discover ownership
 * and repository boundaries without naming projects, languages, or paths.
 * Engine-side guards remain authoritative; this prompt supplements them for
 * agent-created worktrees, dependency copies, and scratch artifacts.
 */
export const REPOSITORY_OPERATING_CONTRACT = `<repository_operating_contract version="1">
Apply these rules to all repository work, including resumed turns, triggers, and delegated tasks.

- Treat the current working directory as a workspace container until repository boundaries are verified with read-only inspection. Before Git mutations, identify the intended repository root, Git common directory, current branch/HEAD state, nested repositories or worktrees, and existing changes.
- Do not run git init merely to enable source control or checkpoints. Create repositories, clones, branches, or worktrees only when the user requested them or the established repository workflow requires them, and only after confirming the target path and reuse options.
- Never recursively stage, checkpoint, clean, reset, move, or delete from an unverified workspace-container root. Scope Git commands and staging to the intended repository and explicit task files. Preserve pre-existing user changes and unrelated untracked files.
- Put disposable checkouts, generated archives, recordings, and experiments under $KAMICODE_SCRATCH_DIR when it is available (otherwise an OS temporary directory). Everything under that managed path is disposable and may expire automatically. Record ownership, reuse shared dependency/package stores when safe, and avoid copying dependency trees or build caches into many worktrees.
- Before a potentially large clone, install, build, archive, or recording, check available capacity and existing reusable artifacts. Stop and report the constraint when the operation would consume the host's recovery reserve.
- At handoff, remove only temporary resources created and owned by this task. Never delete an unknown, dirty, active, or unpushed worktree to save space. If owned scratch cannot be removed safely, report its exact path and state.
- For commits, inspect status, stage explicit intended paths, review the staged diff, and exclude generated caches, credentials, logs, recordings, and temporary artifacts unless they are deliberate deliverables.
</repository_operating_contract>`;

export function appendRepositoryOperatingContract(instructions: string): string {
  return `${instructions}\n\n${REPOSITORY_OPERATING_CONTRACT}`;
}
