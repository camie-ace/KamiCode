import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_TEST_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_WORKFLOW_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  buildTurnStartParams,
  buildThreadStartParams,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  openCodexThread,
} from "./CodexSessionRuntime.ts";
import { appendProjectMemoryInstructions } from "../ProjectMemory.ts";
import {
  KAMI_TEST_HARNESS_DYNAMIC_TOOL_SPEC,
  KAMI_TEST_HARNESS_TOOL_NAME,
} from "../../testing/browserHarnessDynamicTool.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "dangerFullAccess" },
    thread: {
      id: threadId,
      cliVersion: "0.0.0-test",
      createdAt: 1_776_470_400,
      cwd: "/tmp/project",
      ephemeral: false,
      modelProvider: "openai",
      preview: "",
      sessionId: "session-1",
      source: "cli",
      turns: [],
      status: {
        type: "idle",
      },
      updatedAt: 1_776_470_400,
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendProjectMemoryInstructions(
            CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
            undefined,
          ),
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendProjectMemoryInstructions(
            CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
            undefined,
          ),
        },
      },
    });
  });

  it("maps test mode onto Codex default collaboration mode with test instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Test the last feature",
        model: "gpt-5.3-codex",
        interactionMode: "test",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Test the last feature",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendProjectMemoryInstructions(
            CODEX_TEST_MODE_DEVELOPER_INSTRUCTIONS,
            undefined,
          ),
        },
      },
    });
  });

  it("maps workflow mode onto Codex default collaboration mode with workflow instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Build and verify the feature",
        model: "gpt-5.3-codex",
        interactionMode: "workflow",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Build and verify the feature",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: appendProjectMemoryInstructions(
            CODEX_WORKFLOW_MODE_DEVELOPER_INSTRUCTIONS,
            undefined,
          ),
        },
      },
    });
  });

  it("injects project memory into collaboration developer instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Hi",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        projectMemory: "# Project Memory\n\n- Product is KAMI.",
      }),
    );

    const developerInstructions = params.collaborationMode?.settings?.developer_instructions ?? "";
    assert.match(developerInstructions, /<project_memory_policy>/);
    assert.match(developerInstructions, /<project_memory path="\.camie\/project-memory\.md">/);
    assert.match(developerInstructions, /Product is KAMI\./);
  });

  it("can inject project memory policy even when memory is currently empty", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
        projectMemory: "",
      }),
    );

    const developerInstructions = params.collaborationMode?.settings?.developer_instructions ?? "";
    assert.equal(params.collaborationMode?.mode, "default");
    assert.match(developerInstructions, /<project_memory_policy>/);
    assert.doesNotMatch(developerInstructions, /<project_memory path=/);
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("buildThreadStartParams", () => {
  it("registers the KamiCode browser harness dynamic tool", () => {
    const params = buildThreadStartParams({
      cwd: "/tmp/project",
      runtimeMode: "full-access",
      model: "gpt-5.3-codex",
      serviceTier: undefined,
    });

    assert.deepStrictEqual(params.dynamicTools, [KAMI_TEST_HARNESS_DYNAMIC_TOOL_SPEC]);
    assert.equal(params.dynamicTools?.[0]?.name, KAMI_TEST_HARNESS_TOOL_NAME);
  });
});

describe("T3 browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      assert.match(instructions, /t3-code/);
      assert.match(instructions, /preview_status/);
      assert.match(instructions, /preview_open/);
      assert.match(instructions, /Do not switch to global browser skills/);
    }
  });
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    assert.equal(hasConfiguredMcpServer(undefined), false);
    assert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    assert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.t3-code.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it("uses raw thread/start so dynamic tool specs are preserved", async () => {
    const calls: Array<{ method: "thread/start"; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      raw: {
        request: (method: "thread/start" | "thread/resume", payload: unknown) => {
          if (method === "thread/start") {
            calls.push({ method, payload });
          }
          return Effect.succeed(started as unknown);
        },
      },
      request: <M extends "thread/start" | "thread/resume">(
        _method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) =>
        Effect.fail(
          CodexErrors.CodexAppServerRequestError.internalError("typed request was not expected"),
        ),
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: undefined,
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.equal(calls.length, 1);
    assert.deepStrictEqual(calls[0]?.payload, {
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      dynamicTools: [KAMI_TEST_HARNESS_DYNAMIC_TOOL_SPEC],
      model: "gpt-5.3-codex",
    });
  });

  it("accepts newer thread/start responses that omit thread sessionId", async () => {
    const started = makeThreadOpenResponse("fresh-thread");
    const { sessionId: _sessionId, ...threadWithoutSessionId } = started.thread;
    const rawStarted = {
      ...started,
      thread: threadWithoutSessionId,
    };
    const client = {
      raw: {
        request: (_method: "thread/start" | "thread/resume", _payload: unknown) =>
          Effect.succeed(rawStarted),
      },
      request: <M extends "thread/start" | "thread/resume">(
        _method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) =>
        Effect.fail(
          CodexErrors.CodexAppServerRequestError.internalError("typed request was not expected"),
        ),
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: undefined,
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.equal(opened.thread.sessionId, "fresh-thread");
  });

  it("falls back to thread/start when resume fails recoverably", async () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "thread not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.deepStrictEqual(
      calls.map((call) => call.method),
      ["thread/resume", "thread/start"],
    );
  });

  it("accepts newer thread/resume responses that omit thread sessionId", async () => {
    const resumed = makeThreadOpenResponse("resumed-thread");
    const { sessionId: _sessionId, ...threadWithoutSessionId } = resumed.thread;
    const rawResumed = {
      ...resumed,
      thread: threadWithoutSessionId,
    };
    const calls: Array<{ method: "thread/resume"; payload: unknown }> = [];
    const client = {
      raw: {
        request: (method: "thread/start" | "thread/resume", payload: unknown) => {
          if (method === "thread/resume") {
            calls.push({ method, payload });
          }
          return Effect.succeed(rawResumed);
        },
      },
      request: <M extends "thread/start" | "thread/resume">(
        _method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) =>
        Effect.fail(
          CodexErrors.CodexAppServerRequestError.internalError("typed request was not expected"),
        ),
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "resumed-thread",
      }),
    );

    assert.equal(opened.thread.id, "resumed-thread");
    assert.equal(opened.thread.sessionId, "resumed-thread");
    assert.deepStrictEqual(calls[0]?.payload, {
      threadId: "resumed-thread",
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      dynamicTools: [KAMI_TEST_HARNESS_DYNAMIC_TOOL_SPEC],
      model: "gpt-5.3-codex",
    });
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await assert.rejects(
      Effect.runPromise(
        openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          resumeThreadId: "stale-thread",
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });
});
