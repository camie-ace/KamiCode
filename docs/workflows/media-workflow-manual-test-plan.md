# Workflow And Media Manual Test Plan

This plan covers the current workflow mode implementation and the media handling V1 scope described in project memory. A checked-in media UX plan with numbered sections 1-14 was not present during this audit, so the media section map below is derived from the implemented contracts, server paths, web components, and tests.

## Preconditions

- Use a project with a real workspace root and at least one started thread.
- Run the web app at desktop width, tablet width around 768 px, and phone width around 390 px.
- Prepare small fixtures: PNG, GIF, WebP, MP4, MOV or WebM, TXT/PDF, an empty file, and an oversized image/video when safe.
- Keep browser devtools open for WebSocket payload and console/network checks.

## Automated Gate

- `pnpm exec vp check`
- `pnpm exec vp run typecheck`
- Targeted tests before manual signoff:
  - `pnpm exec vp test apps/web/src/mediaArtifacts.test.ts`
  - `pnpm exec vp test apps/server/src/attachmentStore.test.ts apps/server/src/assets/AssetAccess.test.ts apps/server/src/media/generatedMedia.test.ts apps/server/src/media/localMediaSearch.test.ts`
  - `pnpm exec vp test packages/contracts/src/orchestration.test.ts apps/server/src/orchestration/decider.projectScripts.test.ts`

## Workflow Mode Acceptance

1. Planning first: select Workflow mode with `/workflow` or the interaction picker, submit a task, and verify the first turn creates plan/lane cards only.
2. No premature runtime: before Start workflow, verify no child-thread links, workflow links, runtime controls, Lead inbox cards, handoffs, or evidence cards are shown.
3. Dynamic lanes: verify planned lane cards are task-specific and include stable id, role, goal, prompt, model, reasoning effort, fast-mode setting, and `startsAfter`.
4. Customization: ask the Lead in main chat to add, remove, reorder, or reconfigure lanes; verify the panel reflects `workflow.customized` without starting child work or creating another `workflow.planned`.
5. Start semantics: click Start workflow and verify `workflow.started` uses the latest customized payload when present, otherwise the latest planned payload.
6. Child launch metadata: verify dependency-free lanes launch as child threads and `workflow.lane.started` records include `childThreadId`, `childTurnMessageId`, and `childTurnRequestedAt`.
7. Dependency scheduling: create one lane with `startsAfter`; verify it stays waiting until every referenced lane id completes, then launches.
8. Sub-agent instructions: verify `docs/workflows/sub-agents.md` guidance appears only in launched child sessions, not in planning-only turns.
9. Lane guidance: add guidance to a running or completed lane; verify `workflow.lane.guidance` is recorded and the lane is re-triggered through the child thread path.
10. Lead inbox: verify child handoffs, verifier results, evidence, route-backs, objections, synthesis, and memory updates appear as clickable Lead inbox cards after launch.
11. Controls: exercise pause, replace, freeze, continue manually, lane stop, and workflow stop; verify corresponding `workflow.lane.control`, `workflow.control`, `workflow.lane.stopped`, or `workflow.stopped` activity appears.
12. Completion/blocking: verify workflow completion waits for required handoffs, verifier evidence, route-backs, objections, and unresolved blockers to be reflected in the panel.

## Media Handling Sections 1-14

1. Contracts and limits: verify image, GIF, video, and generic file schemas accept valid metadata and reject invalid MIME, ids, or size limits.
2. Composer entry points: attach PNG, GIF, WebP, MP4, MOV/WebM, TXT/PDF, and an empty file through picker, paste, and drag/drop.
3. Composer chips: verify chips show thumbnail or icon, media kind, MIME, size, unsupported reason, remove button, and non-persisted warning when applicable.
4. Draft behavior: reload with image attachments and verify persisted image drafts hydrate; verify video/file drafts clearly warn that they may not persist.
5. Send behavior: send text plus mixed supported media; verify optimistic user message appears, unsupported attachments block send, and attachment-only sends use the bootstrap prompt.
6. Provider safeguards: verify image/GIF attachments are passed to image-capable providers, while video/file attachments are preserved as metadata and do not crash image-only provider adapters.
7. Attachment storage: after server acknowledgement and reload, verify attachment ids resolve to signed `/api/assets` URLs and previews still load without blob URLs.
8. User message rendering: verify attached images open in the image dialog; verify non-image attachments remain reachable through metadata or the media shelf even if the bubble preview is not image-renderable.
9. Assistant media extraction: ask the agent to mention local, relative, file URI, and HTTPS media paths; verify only settled assistant messages produce media artifacts and duplicate targets collapse to the latest item.
10. Inline artifact cards: verify assistant media cards show kind, source, origin, title, path/reference, preview fallback, copy, preview, and Use actions.
11. Media Shelf: verify Recent Media appears above the composer, dedupes by target, keeps the newest active item, scrolls horizontally when collapsed, expands/collapses, and remains usable with many items.
12. Reuse and copy: use a still image or GIF from an artifact card or shelf item; verify it attaches to the composer. Copy path for image/video/unpreviewable media and verify the copied value is useful.
13. Generated and local media helpers: verify generated paths stay under `.kamicode/generated-media/<thread>/`, unsafe names are sanitized, local media ranking prefers exact/recent matches, and broad PC search requires explicit broad scope.
14. Responsive and mobile reachability: test the composer, shelf, artifact cards, preview modal, and PlanSidebar sheet at 390 px, 768 px, and desktop widths; verify no action buttons or close controls are unreachable.

## Mobile Reachability Audit

- Web mobile: `MediaShelf` uses horizontal overflow and `w-[min(18rem,82vw)]`; `MediaArtifactCard` uses compact and non-compact grids with viewport-limited modal width; `ComposerAttachmentStrip` wraps chips with mobile width caps; `ChatView` uses safe-area padding around shelf and composer.
- Web mobile risk: user message bubbles cap at `max-w-[80%]`, so dense attachment grids should be checked manually on 390 px screens.
- Native mobile risk: `apps/mobile/src/features/threads/ThreadComposer.tsx` exposes `/plan` and `/default`, but not Workflow mode. Native Workflow mode is therefore not currently reachable from the mobile composer.
- Native mobile risk: native composer/feed attachment components are image-first. Video/file media V1 behavior is covered by web, but native parity for Media Shelf, video cards, and file metadata is not implemented.
- Audit result: no obvious missing responsive class was found in the web media components, so no product CSS patch was applied.

## Signoff Criteria

- All automated gates pass or have a documented environment-specific reason.
- Workflow planning, customization, launch, dependencies, guidance, controls, evidence, and completion/blocking behavior pass on desktop web.
- Media sections 1-14 pass on desktop web and phone-width web.
- Mobile native reachability risks above are either accepted for this pass or promoted to follow-up product tickets.
