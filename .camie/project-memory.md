# Project Memory

- Canonical project memory path is `.camie/project-memory.md`; `.cami` is incorrect for this repo.
- KamiCode snapshots project memory through `apps/server/src/provider/ProjectMemory.ts` at provider session creation and injects that snapshot only on the first user turn of the session.
- Codex receives the first-turn project memory snapshot as developer instructions; Claude, OpenCode, and Cursor receive it as a prompt prefix because those adapters do not share the Codex collaboration-mode developer-instruction channel.
- Project memory updates should stay concise, durable, deduplicated, and must not include secrets, tokens, passwords, private keys, or transient debug logs.
- Test harness run history is exposed through `GET /api/test-harness/runs?cwd=<project cwd>` and rendered in the chat header by `apps/web/src/components/TestHarnessRunsControl.tsx`.
- KamiCode test harness supports `auth: { type: "kamicode-pairing" }`; Codex runtime mints a short-lived pairing credential through `ServerAuth`, the browser uses the real `/pair#token=...` flow, then storage state is saved per project for reuse.
- `apps/web/src/components/TestHarnessRunsControl.tsx` has both the compact header popover and a larger Test Runs sheet; both refresh while open and show inline screenshots, trace, summary, and issue counts.
- Test Mode live UI verification on 2026-05-27 confirmed that Codex sent `interactionMode: "test"` and called `kamicode.kami_test_harness` with `auth: { type: "kamicode-pairing" }`; the successful run reached the authenticated KamiCode shell at `/` with visible text like `No active thread` and no harness-reported console or network failures.
- GitHub user-auth bootstrap is optional UI state; if `/api/user/session` fails or redirects during app boot, KamiCode should fail closed to user auth disabled and keep the main shell usable.
- Codex Test Mode now auto-applies KamiCode pairing auth inside the harness bridge for local KamiCode dev targets like `http://127.0.0.1:5733` and `/pair` when the runtime can issue a short-lived credential.
- Internal Windows releases are produced by tagging `vX.Y.Z`; `.github/workflows/release.yml` builds the x64 NSIS installer and publishes GitHub Release assets.
