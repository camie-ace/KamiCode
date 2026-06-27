# Workflow And Media Manual Test Plan

This plan covers manual validation for the implemented Workflow mode behavior and media handling
scope. It also includes traceability for the HTML rollout spec sections 1-14 in
`docs/kamicode-execution-plan.html`.

## Scope

- Workflow mode planning, customization, launch, lane scheduling, lane controls, handoffs, evidence,
  verifier results, and completion/blocking behavior.
- Media attachment acceptance, persistence, provider handoff safeguards, asset URLs, assistant media
  extraction, generated media helpers, local media search, Recent Media shelf, media cards, preview,
  copy, Use, and reveal actions.
- HTML spec sections 1-14: rebrand, workspace contracts, persistence, workspace service/RPC/UI,
  GitHub access, desktop local clones/execution, VPS clones, shared thread handoff, and mobile-first
  web thread UI.

## Required Gates

Run these before signoff:

```powershell
vp check
vp run typecheck
```

Recommended targeted automated checks before manual signoff:

```powershell
vp test apps/web/src/mediaArtifacts.test.ts
vp test apps/server/src/attachmentStore.test.ts apps/server/src/assets/AssetAccess.test.ts apps/server/src/media/generatedMedia.test.ts apps/server/src/media/localMediaSearch.test.ts
vp test packages/contracts/src/orchestration.test.ts apps/server/src/orchestration/decider.projectScripts.test.ts
```

If a gate fails for an environment reason, record the exact command, failure excerpt, platform, and
why the manual run can or cannot continue.

## Test Setup

- Use a clean browser profile or clear app local storage before the first run.
- Keep browser devtools open for console, network, and WebSocket payload inspection.
- Run desktop web at normal width, tablet width near 768 px, and phone width near 390 px.
- If available, run one desktop/Electron pass for local file reveal and one web-only pass without the
  desktop bridge.
- Use a real workspace root with Git initialized and at least one started thread.
- Prepare two provider configurations if possible: one Codex-compatible provider and one other
  provider adapter path, such as Claude, Cursor, or Grok.
- Prepare workflow tasks that require at least three lanes: one dependency-free lane, one lane with a
  `startsAfter` dependency, and one verifier lane.

## Media Fixtures

- Small still images: PNG, JPG, WebP, SVG.
- Animated image: GIF.
- Videos: MP4 and WebM. Include MOV only when the browser/platform can decode it.
- Generic files: TXT and PDF for unsupported-composer checks and direct contract/API checks.
- Invalid or edge files: zero-byte file, file with misleading extension, unsupported binary, image
  over 10 MB, video over 25 MB, and more than 8 attachments.
- Local media search fixtures under the workspace, under a project subfolder, and under an explicit
  broad-PC test folder.
- Generated media fixture names with spaces, punctuation, path separators, Unicode, missing
  extension, and unsupported extension.

## Media UX Plan Sections 1-14 Coverage

Use this matrix to keep the media handling UX spec visible while testing workflow and media changes.

| Section | Area                | Manual acceptance check                                                                                   | Expected result                                                                                          |
| ------- | ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1       | Problem             | Ask for generated, found, and existing media.                                                             | The primary output is a visible media artifact; path/URL remains secondary metadata.                     |
| 2       | Target Experience   | Ask the agent to find a known video or image and inspect the assistant response.                          | The response includes an inline media card with preview, metadata, and actions.                          |
| 3       | Media Intent Model  | Try generate, find local, find web, use existing, drop in, edit, and compare prompts.                     | The UI/data model preserves source and origin so intent can be represented consistently.                 |
| 4       | Drag-and-Drop Input | Drop supported and unsupported files into the composer and send/drop without text.                        | Files become visible composer chips; unsupported files show clear state and can be removed.              |
| 5       | Media Card          | Render cards for image, GIF, video, generated, local, project, and web artifacts.                         | Cards show preview/fallback, title, source, metadata, and Preview/Use/Open/Reveal/Copy actions.          |
| 6       | Media Viewer        | Open image/GIF/video cards from chat and shelf at desktop and phone widths.                               | Viewer supports image fit/zoom/metadata and basic video playback controls.                               |
| 7       | Local Media Search  | Render local search JSON/tagged/fenced result sets with ranks, scores, timestamps, and search scope.      | Results appear as ranked thumbnail cards/grid with visible scope and broad-PC refinement affordances.    |
| 8       | Generated Images    | Reference or create generated media under `.kamicode/generated-media/` and reload the thread.             | Generated media is saved predictably, tagged as generated, rendered as a card, and appears in the shelf. |
| 9       | Media Shelf         | Create at least six media artifacts from attachments, assistant paths, and local search results.          | Recent Media appears above composer, dedupes repeated targets, supports active selection and expansion.  |
| 10      | Follow-up           | Use prompts like "use that image", "open the second one", and "crop the selected video".                  | Follow-up prompt context resolves to selected/recent media artifacts deterministically.                  |
| 11      | Failure States      | Test missing preview, unsupported format, invalid path, generation failure copy, and unavailable bridge.  | Failure states are visual, actionable, and do not silently degrade to path-only output.                  |
| 12      | V1 Scope            | Run the V1 feature pass end to end without advanced library, trimming, diffing, or semantic search.       | V1 handles cards, viewer, drag/drop, shelf, local result grid, Use, Copy, Reveal, and failure cards.     |
| 13      | Build Phases        | Trace implementation through contracts, cards, drop input, viewer, search UI, generated media, and shelf. | Each phase has a concrete UI/data path and a targeted automated or manual test.                          |
| 14      | Acceptance Criteria | Execute M-01 through M-14 below and mark each item pass/fail/blocked.                                     | All user-visible acceptance criteria are verified with fixtures, viewport notes, and caveats.            |

Mark any item not present in the current build as `Blocked - not implemented in this branch`, not as
passed.

## Workflow Mode Test Cases

### WF-01 Planning-Only First Turn

Steps:

1. Select Workflow mode with `/workflow` or the interaction picker.
2. Submit a task that clearly needs multiple agents and verification.
3. Observe the first assistant turn, plan panel, activity stream, and WebSocket events.

Expected result:

- A `workflow.planned` draft is created or rendered.
- Lane cards are visible with stable ids, roles, goals, prompts, model settings, reasoning effort,
  fast-mode setting, acceptance criteria, and `startsAfter` ids.
- No subordinate child thread starts.
- No runtime controls, child-thread links, workflow links, Lead inbox cards, handoff cards, or
  evidence cards are shown yet.

### WF-02 Dynamic Lane Planning

Steps:

1. Run two different Workflow-mode tasks: one documentation-heavy task and one implementation-heavy
   task.
2. Compare planned lanes.

Expected result:

- Lane set is tailored to the task and is not a fixed Planner/Builder/Verifier roster.
- Role names are display labels only; routing metadata uses stable lane ids.
- `startsAfter` references lane ids, not role names.

### WF-03 Pre-Launch Customization

Steps:

1. Before launch, ask the Lead in the main chat to add a lane, remove a lane, change a prompt,
   change model settings, and change a dependency.
2. Observe the panel and event stream.

Expected result:

- The plan updates through `workflow.customized`.
- Customization does not create another `workflow.planned`.
- Customization does not create child threads or inject `docs/workflows/sub-agents.md`.
- Start action remains available for the latest approved card state.

### WF-04 Start Workflow From Latest Plan

Steps:

1. Customize a plan.
2. Click Start workflow.
3. Inspect `workflow.started` payload.

Expected result:

- Started payload uses the latest `workflow.customized` payload when one exists, otherwise the latest
  `workflow.planned` payload.
- Approved sub-agent ids, prompts, model settings, fast-mode settings, acceptance criteria, and
  dependency graph are preserved.
- Runtime controls become visible only after launch.

### WF-05 Dependency Scheduling

Steps:

1. Launch a workflow with one lane that has no dependencies and one lane with `startsAfter` pointing
   to the first lane.
2. Let the first lane complete.

Expected result:

- Dependency-free lanes launch immediately.
- Dependent lanes stay waiting until every referenced lane id completes.
- The dependent lane starts only after its dependency is complete.
- A missing or invalid dependency id is surfaced as a planning/runtime error rather than silently
  launching out of order.

### WF-06 Child Thread Launch Metadata

Steps:

1. Launch a workflow where child-thread lane execution is available.
2. Open each child-thread link from its lane card.
3. Inspect activity records.

Expected result:

- Each actual launched lane records `workflow.lane.started`.
- Started lane records include `childThreadId`, `childTurnMessageId`, and `childTurnRequestedAt`.
- Placeholder or waiting lane records do not use `workflow.lane.started`.
- Child thread links target the correct subordinate session.

### WF-07 Sub-Agent Instructions Timing

Steps:

1. Inspect planning-only activity before launch.
2. Launch the workflow and inspect child-thread context/instructions.

Expected result:

- `docs/workflows/sub-agents.md` guidance is absent from planning-only turns.
- The guidance appears when the specific child session starts.
- The Lead thread does not receive child-only instructions as runtime evidence.

### WF-08 Lane Guidance And Re-Trigger

Steps:

1. After launch, add guidance to a running or completed lane.
2. Re-run or continue that lane.
3. Inspect records and lane result.

Expected result:

- Guidance to a running lane records `workflow.lane.guidance`.
- The guidance targets `laneId`, not role name.
- The next lane result supersedes or amends the prior handoff.
- Dependent lanes see the updated result only when dependency semantics allow it.

### WF-09 Lead Inbox, Handoffs, Verifier, And Evidence

Steps:

1. Let child lanes complete with files touched, tests run, known risks, and summary.
2. Let a verifier lane pass or fail.
3. Add evidence artifacts and route-back/objection items if supported.

Expected result:

- Sub-agent handoffs record `workflow.handoff` with enough detail for clickable Lead inbox cards.
- Verifier result records `workflow.verifier.result` with verifier `laneId`.
- Evidence appears in the common evidence panel with checks/artifacts.
- Lead synthesis waits until required handoffs, verifier evidence, objections, route-backs, and
  blockers have been considered.

### WF-10 Workflow And Lane Controls

Steps:

1. Exercise pause, replace, freeze, continue manually, lane stop, and workflow stop where exposed.
2. Refresh and reconnect after at least one control event.

Expected result:

- Lane-specific controls record `workflow.lane.control` or `workflow.lane.stopped`.
- Workflow-wide controls record `workflow.control` or `workflow.stopped`.
- Control state survives refresh/reconnect.
- Stopped lanes do not keep emitting child output into the active lane result.

### WF-11 Completion And Blocking

Steps:

1. Run one happy-path workflow to completion.
2. Run one workflow where a lane blocks and one where verifier fails.
3. Observe final Lead response and panel state.

Expected result:

- Happy path completes only after required lane results and evidence are present.
- Blocked state names the blocked lane, reason, needed input, and whether other lanes can proceed.
- Verifier failure prevents a misleading success summary.
- Final response includes files touched, tests run, known risks, and unresolved follow-ups when
  available.

### WF-12 Workflow Responsive Behavior

Steps:

1. Repeat planning, customization, start, lane inspection, and controls at desktop, 768 px, and
   390 px widths.
2. Test keyboard navigation and focus return from dialogs/sheets.

Expected result:

- PlanSidebar or sheet remains usable.
- Lane cards, Start workflow, guidance input, controls, Lead inbox, evidence, and close buttons are
  reachable.
- No horizontal page overflow hides critical controls.

## Media Acceptance Test Cases

### M-01 Contracts, Limits, And Type Validation

Steps:

1. Validate upload and persisted attachment payloads for image, GIF, video, and generic file through
   existing tests or an RPC/test harness.
2. Try invalid attachment ids, invalid MIME strings, negative sizes, oversized sizes, dimensions over
   100000, and duration over 24 hours.
3. Try 9 attachments and a prompt over the input limit.

Expected result:

- Valid payloads decode and invalid payloads are rejected before provider dispatch.
- Attachment id allows only safe `[a-z0-9_-]` style ids up to the configured length.
- Limits are enforced: 8 attachments, 10 MB image/GIF, 25 MB video, 10 MB file, and 120000 input
  characters.
- Error messages identify the offending attachment or limit.

### M-02 Composer Entry Points

Steps:

1. Attach PNG, JPG, WebP, SVG, GIF, MP4, WebM, TXT, PDF, zero-byte file, and unsupported binary by
   file picker.
2. Paste an image from clipboard.
3. Drag and drop multiple mixed files onto the composer.

Expected result:

- Supported image/GIF/video attachments are accepted up to limits.
- Generic files currently appear as unsupported composer attachments and block send until removed.
- Zero-byte and oversized files are rejected or marked unsupported.
- Drag/drop and paste do not navigate the browser away from the thread.
- More than 8 attachments is blocked with a clear message.

### M-03 Composer Chips And Preview Metadata

Steps:

1. Add one supported image, GIF, video, and unsupported file.
2. Inspect each chip at desktop and phone widths.
3. Remove each chip.

Expected result:

- Image/GIF chips show thumbnails; video chips show video preview or video icon; unsupported files
  show file icon and reason.
- Chips show name, kind label, MIME, size, remove button, and draft persistence warning when
  applicable.
- Remove revokes the preview and updates composer state without leaving stale chips.

### M-04 Draft Persistence

Steps:

1. Add text, image, GIF, video, and unsupported file to a draft.
2. Reload the page.
3. Navigate away and back to the same thread/draft.

Expected result:

- Text and persisted image attachments hydrate after reload.
- Non-image attachments are marked memory-only before reload and are absent or clearly not persisted
  after reload.
- No stale broken blob URLs remain visible after hydration.

### M-05 Send Behavior And Optimistic Rendering

Steps:

1. Send text plus image/GIF/video attachments.
2. Try sending while unsupported attachments are still present.
3. Send attachment-only content.

Expected result:

- Unsupported attachments block send with a clear remove-first message.
- Supported attachments produce an optimistic user message immediately.
- Attachment-only sends use the bootstrap prompt/title path and do not fail because text is empty.
- Blob previews are eventually promoted to server-backed asset URLs when the server message arrives.

### M-06 Server Normalization And Attachment Storage

Steps:

1. Inspect persisted attachments after send.
2. Reload the thread and open previews.
3. Try malformed data URLs, mismatched data URL MIME, path traversal names, and unsafe file names
   through a harness or negative test.

Expected result:

- Server writes attachments under the configured attachment directory using safe generated ids and
  safe extensions.
- Images, GIFs, videos, and generic file payloads resolve by attachment id when present.
- Empty, too-large, malformed, or MIME-incompatible payloads are rejected before provider dispatch.
- Path traversal attempts do not escape the attachment directory.

### M-07 Provider Attachment Safeguards

Steps:

1. Send image/GIF context to each configured provider.
2. Send video context to each configured provider.
3. Include unsupported file metadata only through direct API/harness if composer cannot send it.

Expected result:

- Image/GIF attachments are passed only to providers that support image context.
- Video/file attachments are preserved in app metadata but do not crash image-only provider adapters.
- Provider errors for unsupported image MIME types are explicit and do not corrupt the thread.
- Turn still has non-empty text or attachment context when sent to provider.

### M-08 User Message Rendering

Steps:

1. Send image, GIF, and video attachments.
2. Open rendered user image previews from the message bubble.
3. Reload and repeat after asset URLs are issued.

Expected result:

- Image and GIF previews open in the expanded image dialog.
- Non-image attachments remain discoverable through metadata/media shelf even when not rendered as
  image bubbles.
- Asset URLs load after reload without relying on old blob URLs.

### M-09 Assistant Media Extraction

Steps:

1. Ask the assistant to reference media using Markdown links, raw relative paths, absolute local
   paths, `file:///` URIs, and `https://` URLs.
2. Include duplicate references to the same target in separate assistant turns.
3. Observe during streaming and after the assistant message settles.

Expected result:

- Media artifacts are created only for supported image/GIF/video extensions.
- Streaming assistant messages do not publish final artifacts until settled.
- Generated media under `.kamicode/generated-media/` is tagged as generated.
- Web URLs are tagged as web; relative/project paths are tagged as project; absolute local paths are
  tagged as local/project as implemented.
- Duplicate targets collapse to the latest settled artifact.

### M-10 Local Media Search Result Handling

Steps:

1. Produce or paste local media search results in supported JSON, fenced, and tagged formats.
2. Include image, GIF, video, and audio extensions.
3. Include explicit rank, score, modified time, and scope metadata.

Expected result:

- Result sets normalize and render without exposing raw JSON in the final message body.
- Ranking honors explicit rank first, then score, then recency.
- Confidence is high/medium/low based on rank or score ratio.
- Scope metadata shows current workspace, project, or explicit broad-PC status.
- Broad PC search is available only when explicitly requested or selected.

### M-11 Inline Media Artifact Cards

Steps:

1. Render artifact cards for generated, local, project, and web media.
2. Exercise preview, copy path/reference, copy image, Use, and reveal actions.
3. Test image fit/zoom controls and video playback controls.

Expected result:

- Cards show kind, source, origin, title, path/reference, preview fallback, metadata, and actions.
- Image/GIF preview opens a modal with fit/zoom, copy, external/open/reveal where available, and
  reachable close controls.
- Video preview uses a playable video element when supported and a clear fallback when unsupported.
- Copy image fails gracefully when browser clipboard support or MIME support is unavailable.
- Use attaches the selected media to the composer when the media can be converted into context.

### M-12 Recent Media Shelf

Steps:

1. Create at least 6 distinct media artifacts across user attachments and assistant output.
2. Include duplicate targets with newer and older timestamps.
3. Collapse and expand the shelf.
4. Select, preview, copy, and Use shelf items.

Expected result:

- Recent Media appears above the composer only when artifacts exist.
- Shelf dedupes by target and keeps the newest active item.
- Collapsed shelf shows up to 4 items and a "show more" action.
- Expanded shelf wraps/scrolls without hiding controls.
- Active and Recent states update when a shelf item is used.

### M-13 Generated Media Helpers

Steps:

1. Resolve generated media directory and file paths for normal and unsafe thread ids.
2. Generate artifact representations for unsafe file names and unsupported extensions.
3. Open the resulting Markdown reference in a thread.

Expected result:

- Generated media stays under `.kamicode/generated-media/<thread-segment>/`.
- Thread and file path segments are sanitized, lower-cased, length-limited, and cannot escape the
  project root.
- Missing or unsupported extensions default to PNG.
- Markdown reference points at the safe relative generated media path.

### M-14 Responsive And Mobile Reachability

Steps:

1. Repeat M-02 through M-12 at 390 px, 768 px, and desktop widths.
2. Test touch interaction, keyboard focus, modal close, shelf expand/collapse, card actions, and
   composer send/remove actions.

Expected result:

- Composer chips wrap without covering the send controls.
- Media shelf scrolls horizontally when collapsed and remains usable when expanded.
- Artifact card actions and modal close buttons remain reachable.
- No critical media workflow requires hover-only interaction.

## Regression Checks

- Refresh during workflow planning, after customization, after launch, and after lane completion.
- Restart the server during a running workflow and confirm reconnect behavior is predictable.
- Disconnect/reconnect network while an assistant media message is streaming; artifacts should not
  duplicate or appear before the message settles.
- Send duplicate attachments and duplicate assistant media paths; dedupe should be deterministic.
- Open old threads with no media fields; they should render without schema/runtime errors.
- Open old threads with image-only attachments; they should still show previews.
- Try invalid asset URLs and expired/malformed tokens; failures should be safe and visible.
- Attempt attachment path traversal and generated-media path traversal through negative tests.
- Verify unsupported media never causes an unhandled provider exception.
- Verify broad local media search is not triggered accidentally from a vague prompt.
- Verify mobile thread actions from HTML section 14 still work after media shelf/chip rendering.

## Known Environment Caveats

- The HTML document is an incremental rollout plan. If a section is not implemented in the current
  branch, record it as blocked/not implemented instead of failing unrelated media or workflow work.
- Desktop local media reveal requires the desktop/Electron bridge. Browser-only web should report the
  reveal action as unavailable or fall back safely.
- Browser image-copy support depends on secure context, permissions, focus, and MIME support.
- MOV playback varies by platform/browser. Use MP4/WebM for required cross-browser video acceptance.
- Very large local media searches can be slow and privacy-sensitive. Use a controlled broad-PC test
  folder unless the user explicitly approves a wider scan.
- Native mobile parity may lag web responsive behavior. This plan requires phone-width web
  reachability unless a native mobile implementation is explicitly in scope.
- Provider support differs. The acceptance bar is no crash, clear errors, and preserved app metadata;
  it is not guaranteed that every provider receives every media type as model context.

## Signoff Template

Record the following in the PR or release notes:

- Build gates: `vp check` result and `vp run typecheck` result.
- Targeted tests run and result.
- Browser/platforms tested, including desktop width, 768 px, and 390 px.
- Workflow cases passed/failed/blocked with links to evidence.
- Media cases passed/failed/blocked with fixture list.
- HTML sections 1-14 passed/failed/blocked.
- Known caveats accepted or follow-up tickets filed.
