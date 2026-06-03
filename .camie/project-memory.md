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
- Test Mode browser verification should be headless and recorded by default. Use visible browser mode only after an explicit user request; harness artifacts should include screenshots, trace, and video when possible.
- Auth-gated Test Mode verification must set `authExpectation: "authenticated"` and cannot treat a login/auth page as success. If no saved session, local credentials, seeded user, bypass, or mock auth exists, ask with `request_user_input` question id `test_auth_strategy` using options: `I'll provide sign-in credentials`, `Create permanent user`, and `Create temporary user`.
- Internal Windows releases are produced by tagging `vX.Y.Z`; `.github/workflows/release.yml` builds the x64 NSIS installer and publishes GitHub Release assets.

## Phase 6: Shared Projects + Runtime Continuation

- Phase 6 should be simplified from "Remote/VPS Environments" to "Shared Projects + Runtime Continuation": the durable goal is remote team collaboration, not making VPS the center of the product.
- Do not assume Codex must run on a VPS. A shared project should preserve code context, project memory, shared threads, environments, and artifacts so authorized teammates can continue work from their own runtime: local desktop, SSH/VPS remote, or a future hosted worker.
- Keep these concepts separate:
  - Shared Project: durable collaboration object containing repo/branch metadata, project memory/context bundle, AGENTS/instructions snapshot, environments, members/roles, shared threads, and artifacts.
  - Shared Thread: a specific unit of work/conversation inside a project, with messages, agent decisions, runtime metadata, test artifacts, and handoff state.
  - Runtime: the machine/session doing execution now, such as local desktop, SSH/VPS, or future cloud worker.
  - Environment: a target app URL/config for testing, such as local dev, preview deploy, VPS staging, or production.
- Sharing a project must not automatically publish every local thread. Existing local threads stay private until explicitly shared; new threads in a shared project may default to shared with a visible private/shared control.
- Do not automatically move a local project to VPS when it is shared. Sharing creates/syncs durable project state; attaching a remote runtime is a separate explicit action.
- Provider credentials and credit limits are runtime/user-local concerns. If a remote runtime/provider is unavailable or out of credits, the user should be able to continue locally and choose whether that continuation syncs back to the shared thread or remains private.
- Project invites should be one-time, expiring, and bound to a specific GitHub identity. Invite acceptance must verify the signed-in KamiCode account's GitHub identity before granting project access, with clear rejection for mismatched accounts.
- Project sharing, invite codes, team members, roles, environments, branch/deploy URL associations, and runtime attachments should be managed from the project settings page.
- A teammate initializing a shared project should receive a bootstrap manifest: repo URL, default branch, current branch/SHA, context bundle, known environments, shared threads, and available runtimes. The teammate can open an existing clone, clone from GitHub, or attach a remote runtime.
- Code handoff should track repo remote, branch, HEAD SHA, dirty status, and optionally a patch artifact for uncommitted local changes. Dirty work must be visible before sharing or handoff.
- Phase 6 MVP tasks should be testable backend/frontend pairs: collaboration control plane, GitHub identity binding, publish local project, context bundle sync, members/roles, GitHub-bound invites, initialize shared project, thread visibility, shared thread sync, code state handoff, runtime registry, provider/profile boundary, multiple project environments, and branch/deploy URL association.
- VPS/deploy sync, mobile web continuation, shared test artifacts, and automatic remote tests after push/deploy remain important but can follow once manual shared-project continuation works cleanly.
- Phase 6 tasks 1-15 now have a first-pass implementation: contracts live in `packages/contracts/src/sharedProject.ts`; SQLite persistence is migration `034_SharedProjects`; the server service/routes live under `apps/server/src/sharedProjects`; and the settings command center is `/settings/shared-projects`.
- Shared-project context sync intentionally stores project memory, selected instructions, package-manager/scripts, repo metadata, and environment variable names only; it excludes secret values, raw `.env` contents, auth state, private keys, and provider credentials.
