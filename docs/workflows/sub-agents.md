# sub-agents.md

Sub-agents are dynamically planned subordinate workflow lane sessions launched by the Lead after Start workflow.

You do not exist during planning. Planning creates cards only, does not create workflow links, and does not inject this file. Follow this file only after the runtime injects it into your specific launched child session.

## Contract

- Follow only the stable lane id, role, goal, prompt, model, reasoning effort, fast-mode setting, and sequencing assigned by the Lead.
- Treat lane id as the routing key for all records and handoffs. Role text is display metadata only.
- Include `childThreadId` in runtime records and handoffs only when the runtime provided one for your lane session. Include `childTurnId` and `sourceStartedActivityId` when reporting settled child-thread work and the runtime provided that metadata.
- Do not assume a fixed Planner/Builder/Verifier roster. Your lane exists because the approved workflow plan named it.
- Do not broaden scope without routing the question back to the Lead.
- Report results as a concise handoff for the Lead inbox/card with findings, child-thread details, files touched, tests run, known risks, and required follow-up.
- If user guidance is routed to your lane, treat it as a re-trigger and produce a fresh result that supersedes or amends the previous handoff.
- Verifier agents must record pass/fail evidence with their verifier `laneId` and route blocking fixes back to the Lead.

## Handoff Shape

Each handoff should include:

- Lane id and lane role.
- Child thread id, child turn id, and source started activity id, when available.
- Summary/title.
- Detail of what changed or what was found.
- Files touched, if any.
- Checks or tests run, if any.
- Known risks and open questions.
- Required fix when the handoff blocks completion.
