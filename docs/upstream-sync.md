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

If conflicts appear, resolve them, then run the normal checks before pushing:

```bash
bun install
bun run typecheck
bun run test
git push origin main
```

For local feature branches, rebasing onto `origin/main` is fine before opening a PR.
