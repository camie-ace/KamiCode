# Upstream Sync

KamiCode is a fork of `pingdotgg/t3code`.

Local remotes should be:

```bash
origin    https://github.com/camie-ace/KamiCode.git
upstream  https://github.com/pingdotgg/t3code.git
```

`origin` is where KamiCode changes are pushed. `upstream` is read-only and should only be fetched from.

## Sync T3 Code Changes

Use merge commits on `main` after the branch is shared. Do not rebase pushed `main`.

```bash
git checkout main
git pull --ff-only origin main
git fetch upstream main
git merge --no-ff upstream/main
```

Before a substantial architecture migration, create a backup branch and verify a Git bundle. Resolve the merge in a separate worktree so the working checkout remains available. Preserve KamiCode's data migrations, authentication, thread locks, schedules, provider behavior, and desktop identity when resolving conflicts.

Install the pinned dependencies, then run targeted typechecks and regression tests for the changed packages before pushing:

```bash
vp install --frozen-lockfile
# Run the affected package's typecheck and explicit test files; CI runs the full suite.
git push origin main
```

For local feature branches, rebasing onto `origin/main` is fine before opening a PR.
