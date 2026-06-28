# Workflow.md

Workflow mode is planning-first, Lead-owned orchestration. The Lead plans visible lane cards before any subordinate work starts, then starts approved child-thread lane work only after the user launches the workflow.

## Planning Phase

- The first Workflow-mode prompt plans the workflow only and may create a server-seeded `workflow.planned` draft.
- The Lead treats the seeded draft as editable lane cards and dynamically tailors the lane set to the task before launch. There is no fixed Planner/Builder/Verifier roster.
- Each sub-agent card includes a stable id, role, goal, prompt, model, reasoning effort, fast-mode setting, and `startsAfter` dependency ids.
- The main chat remains the customization channel. The user can ask the Lead to add, remove, reorder, or reconfigure sub-agents before launch.
- Customization revises the planned cards only when the UI/runtime records an explicit `workflow.customized`; it does not start subordinate work and must not create another `workflow.planned`.
- Workflow links, child-thread links, runtime controls, handoffs, Lead inbox cards, and evidence cards stay hidden until the workflow is launched.

## Section 9 - Planning Contract

- `workflow.planned` is a launchable draft, not evidence that any subordinate session has started.
- Planned `subAgents` are runtime records keyed by stable `id`. Role names are labels only and must not be used as routing keys.
- `startsAfter` entries reference planned sub-agent ids, not role names.
- The initial server draft may use heuristic common lanes. The approved workflow is the latest planned/customized card state, not the heuristic itself.
- Planning and customization create cards only. They do not create child threads, create workflow links, or inject `sub-agents.md`.

## Section 10 - Start Workflow Semantics

- The user launches the approved plan with the Start workflow action.
- Launch records `workflow.started` from the latest `workflow.customized` payload when present, otherwise from the latest `workflow.planned` payload.
- The started payload must preserve the approved sub-agent ids, prompts, model settings, fast-mode settings, acceptance criteria, and dependency graph.
- Only lanes with empty `startsAfter` are launchable immediately. Dependent lanes start only after every referenced lane id completes.
- Where child-thread lane execution is implemented, launching a subordinate lane creates or targets a child thread under the Lead thread.
- Each subordinate child-thread session receives `sub-agents.md` when that specific child session starts, not during planning.
- `workflow.lane.started` records are child-thread launch records and must include `childThreadId`, `childTurnMessageId`, and `childTurnRequestedAt`. Placeholder lane records must not use `workflow.lane.started` or invent child metadata.

## Section 13 - Runtime Lane Records

- Runtime lane records use `laneId` as the stable routing key. `laneRole` is human-readable display metadata only.
- Runtime records tied to actual child-thread work include `childThreadId` where applicable so the UI can link the lane card to the subordinate session. Settled child-thread records should include `childTurnId` and `sourceStartedActivityId` when that metadata exists.
- Guidance to a planned workflow updates the cards/prompts/configuration before launch.
- Guidance to a running lane records `workflow.lane.guidance` and re-triggers that specific `laneId`; the next lane result supersedes or amends the previous handoff.
- Every sub-agent handoff back to the Lead should be recorded as `workflow.handoff` with enough detail for a clickable Lead inbox/card, including child-thread details when the handoff came from a child-thread lane.
- Verifier results must be recorded as `workflow.verifier.result` with the verifier lane's `laneId`.
- Test and verification evidence is shared across workflow agents through the common evidence panel.
- The Lead synthesizes results only after required handoffs, verifier evidence, objections, and route-backs have been considered.
