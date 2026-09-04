# Storage lifecycle

KamiCode treats storage as an owned, bounded resource. Repository instructions help agents choose
safe locations, while engine guards remain authoritative for artifacts KamiCode creates itself.

## Application-owned storage

- Git checkpoints are assembled in a disposable object quarantine and published atomically. Failed
  or timed-out captures cannot leave partial objects in the repository object database. Checkpoints
  pause below the larger of `T3CODE_CHECKPOINT_MIN_FREE_BYTES` (10 GiB by default) and
  `T3CODE_CHECKPOINT_MIN_FREE_PERCENT` (15% by default), and repeated failures back off.
- Every provider receives `KAMICODE_SCRATCH_DIR`, `TMPDIR`, `TMP`, and `TEMP`. The root is accepted
  only when KamiCode created or previously marked it. Direct children expire after
  `T3CODE_MANAGED_SCRATCH_MAX_AGE_HOURS` (72 by default), with a six-hour active grace period and a
  default 10 GiB budget. Override the root with `T3CODE_MANAGED_SCRATCH_DIR`; hosted installs should
  place it on a cache path that deployment backups exclude.
- npm, pnpm, XDG-aware tools, Playwright, and Puppeteer share cache roots under
  `T3CODE_MANAGED_PACKAGE_CACHE_DIR`, preventing each project or worktree from selecting another
  store. Package-manager-aware pruning is an offline host operation; KamiCode never deletes
  arbitrary files from a package store while an agent may use it.
- Browser harness runs retain the newest run per project and are bounded by count, age, and total
  bytes. Defaults are 20 runs per project, 14 days, and 5 GiB.
- New tool lifecycle events persist only the small client-visible projection. Existing databases can
  be compacted with `t3 storage compact-database --base-dir <dir> --apply` while the server is
  stopped. The command works on a SQLite backup, verifies `quick_check`, atomically installs it, and
  retains the original database under `userdata/database-rollback/` until post-start validation.

These controls are structural and apply to every project. They do not infer project names or delete
directories merely because they are named `.tmp`, `.worktrees`, or `node_modules`.

## Hosted VPS storage

`infra/hosted/storage` contains the deployment-owned layer for data outside KamiCode's state root:

- a daily guardian for timestamped deployment backups and versioned releases;
- an explicit offline mode for npm and pnpm's own safe cache-prune operations;
- journald and coredump byte/retention limits.

Install the executable, copy and review `storage-guardian.conf.example`, install the systemd unit and
timer, and copy the journal snippets to their corresponding `*.conf.d` directories. Every mutable
root is explicit. The guardian refuses broad roots, unexpected names, symlinks/aliases, `.retain`
pins, the active release, and entries younger than the configured safety window. Run the offline
mode only inside a controlled service stop.

Install `kamicode-managed-storage.conf` as a drop-in for `kamicode.service` to put managed scratch
and package caches under `/var/cache/kamicode`, outside `/var/lib/kamicode`, so rollback snapshots do
not copy disposable data. Point `KAMICODE_MANAGED_PACKAGE_CACHE_ROOT` at that same package-cache
directory; the guardian touches it only in explicit offline mode, through npm and pnpm's own prune
commands.

## Existing project debris

Old repository-local worktrees and caches predate the owned scratch contract. They require a
one-time classification: verify no process or Git administrative file references each candidate,
record branch/HEAD/dirty/unpushed state, then preserve, quarantine, or remove it. The recurring
guardian intentionally does not automate that judgment. Once current debris is handled, provider
temp paths and the injected repository contract keep future disposable work under managed scratch.
