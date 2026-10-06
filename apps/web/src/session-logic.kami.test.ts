import { EventId, ThreadId, TurnItemId, type OrchestrationThreadActivity, type OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { deriveTimelineEntriesFromVisibleTurnItems } from "./session-logic";

function makeActivity(input: Omit<OrchestrationThreadActivity, "id" | "turnId" | "createdAt" | "tone"> & { readonly id: string; readonly tone?: OrchestrationThreadActivity["tone"] }): OrchestrationThreadActivity {
  return { ...input, id: EventId.make(input.id), turnId: null, createdAt: "2026-10-06T10:00:00.000Z", tone: input.tone ?? "tool" };
}
function deriveWorkLogEntries(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const threadId = ThreadId.make("thread:kami-history");
  const visibleTurnItems: OrchestrationV2ProjectedTurnItem[] = activities.map((activity, ordinal) => {
    const id = TurnItemId.make(`kami-activity:${activity.id}`);
    const time = DateTime.makeUnsafe(activity.createdAt);
    return { position: ordinal, visibility: "local", sourceThreadId: threadId, sourceItemId: id, item: {
      type: "kami_activity", activity, id, threadId, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
      ordinal, status: "completed", title: activity.summary, startedAt: time, completedAt: time, updatedAt: time,
    } };
  });
  return deriveTimelineEntriesFromVisibleTurnItems({ visibleTurnItems, optimisticMessages: [] }).flatMap((entry) => entry.kind === "work" ? [entry.entry] : []);
}

  it("extracts evidence run artifacts from Kami test harness tool results", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "evidence-complete",
        kind: "tool.completed",
        summary: "Evidence run",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Evidence run",
          detail: "Pairing screen was visible.",
          data: {
            callId: "call-1",
            namespace: "kamicode",
            tool: "kami_test_harness",
            success: true,
            contentItems: [
              {
                type: "inputText",
                text: `${JSON.stringify({
                  runner: "playwright",
                  status: "fail",
                  success: false,
                  runId: "run-1",
                  goal: "Validate chat UI is visible",
                  finalUrl: "http://127.0.0.1:5733/pair",
                  title: "KamiCode (Dev)",
                  evidenceSummary: "Observed pairing screen instead of chat UI.",
                  outputSummary: "Pairing screen was visible.",
                  artifactPaths: {
                    trace: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/trace.zip",
                    screenshots: [
                      "C:/Users/THIS PC/.t3/dev/test-harness/run-1/screenshots/01-start.png",
                    ],
                    summary: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/summary.json",
                    markdown: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/summary.md",
                  },
                  screenshots: [
                    {
                      label: "final",
                      path: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/screenshots/05-final.png",
                    },
                  ],
                  videos: [],
                  consoleErrors: ["[warning] slow"],
                  networkFailures: ["GET /missing 404"],
                  durationMs: 1200,
                })}\n`,
              },
            ],
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.evidenceRun).toMatchObject({
      runId: "run-1",
      runner: "playwright",
      status: "fail",
      success: false,
      goal: "Validate chat UI is visible",
      finalUrl: "http://127.0.0.1:5733/pair",
      title: "KamiCode (Dev)",
      outputSummary: "Pairing screen was visible.",
      tracePath: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/trace.zip",
      markdownPath: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/summary.md",
      durationMs: 1200,
    });
    expect(entry?.evidenceRun?.screenshots).toEqual([
      {
        label: "final",
        path: "C:/Users/THIS PC/.t3/dev/test-harness/run-1/screenshots/05-final.png",
      },
    ]);
    expect(entry?.evidenceRun?.consoleErrors).toEqual(["[warning] slow"]);
    expect(entry?.evidenceRun?.networkFailures).toEqual(["GET /missing 404"]);
  });

  it("extracts project trigger cards from trigger dynamic tool results", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "trigger-tool-complete",
        kind: "tool.completed",
        summary: "create_trigger",
        payload: {
          itemType: "dynamic_tool_call",
          title: "create_trigger",
          data: {
            namespace: "kamicode",
            tool: "create_trigger",
            success: true,
            contentItems: [
              {
                type: "inputText",
                text: `${JSON.stringify({
                  tool: "create_trigger",
                  trigger: {
                    id: "trigger:weekday-triage",
                    projectId: "project-1",
                    name: "Weekday triage",
                    description: "Triage issues every weekday.",
                    enabled: true,
                    schedule: {
                      kind: "cron",
                      expression: "0 9 * * 1-5",
                      timezone: "UTC",
                      runtime: "local",
                    },
                    threadTemplate: {
                      prompt: "Summarize open work.",
                      runtimeMode: "full-access",
                      interactionMode: "default",
                    },
                    nextRunAt: "2026-07-01T09:00:00.000Z",
                    lastRunAt: null,
                    updatedAt: "2026-06-30T18:30:00.000Z",
                    warnings: ["Local runtime triggers only fire while this runtime is online."],
                  },
                })}\n`,
              },
            ],
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.projectTrigger).toMatchObject({
      tool: "create_trigger",
      success: true,
      trigger: {
        id: "trigger:weekday-triage",
        name: "Weekday triage",
        enabled: true,
        schedule: {
          expression: "0 9 * * 1-5",
          timezone: "UTC",
          runtime: "local",
        },
        threadTemplate: {
          prompt: "Summarize open work.",
          runtimeMode: "full-access",
        },
        warnings: ["Local runtime triggers only fire while this runtime is online."],
      },
    });
  });

  it("extracts evidence run artifacts from Claude MCP test harness tool results", () => {
    const screenshotPath =
      "C:/Users/THIS PC/.kamicode/userdata/test-harness/projects/cwd-1/runs/run-claude/screenshots/01.png";
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "claude-evidence-complete",
        kind: "tool.completed",
        summary: "Evidence run",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Evidence run",
          detail: "Evidence run: Validate chat UI (http://127.0.0.1:5733)",
          data: {
            toolName: "mcp__kamicode__kami_test_harness",
            input: {
              url: "http://127.0.0.1:5733",
              goal: "Validate chat UI",
            },
            result: {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [
                {
                  type: "text",
                  text: `${JSON.stringify({
                    runner: "playwright",
                    status: "pass",
                    success: true,
                    runId: "run-claude",
                    goal: "Validate chat UI",
                    finalUrl: "http://127.0.0.1:5733/",
                    evidenceSummary: "Chat shell was visible.",
                    artifactPaths: {
                      trace:
                        "C:/Users/THIS PC/.kamicode/userdata/test-harness/projects/cwd-1/runs/run-claude/trace.zip",
                    },
                    screenshots: [{ label: "final", path: screenshotPath }],
                    videos: [],
                    consoleErrors: [],
                    networkFailures: [],
                  })}\n`,
                },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.evidenceRun).toMatchObject({
      runId: "run-claude",
      runner: "playwright",
      status: "pass",
      success: true,
      goal: "Validate chat UI",
      finalUrl: "http://127.0.0.1:5733/",
      evidenceSummary: "Chat shell was visible.",
      tracePath:
        "C:/Users/THIS PC/.kamicode/userdata/test-harness/projects/cwd-1/runs/run-claude/trace.zip",
    });
    expect(entry?.evidenceRun?.screenshots).toEqual([{ label: "final", path: screenshotPath }]);
  });

