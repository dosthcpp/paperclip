import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hermes talks to a *remote inference provider* (openrouter/nous/anthropic/…)
// rather than spawning a local model, so "remote execution" here exercises the
// CLI spawn + provider routing + session resume path. We mock runChildProcess so
// no real `hermes` binary is required, and pin an explicit provider so execute()
// skips the runtime `detectModel()` probe (which would shell out to hermes).

const { runChildProcess } = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "All done.\n\nsession_id: sess-new-1\n",
    stderr: "",
    pid: 4242,
    startedAt: "2026-06-07T12:00:00.000Z",
  })),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return { ...actual, runChildProcess };
});

import { execute } from "./execute.js";

function makeCtx(cwd: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "HermesCoder",
      adapterType: "hermes_local",
      adapterConfig: {
        model: "anthropic/claude-sonnet-4",
        provider: "openrouter",
        ...((overrides.adapterConfig as Record<string, unknown>) ?? {}),
      },
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
      ...((overrides.runtime as Record<string, unknown>) ?? {}),
    },
    config: {},
    context: { paperclipWorkspace: { cwd, source: "project_primary" } },
    onLog: async () => {},
  } as never;
}

describe("hermes remote execution", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("spawns `hermes chat -q <prompt> -Q` with model + remote provider, and persists the new session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-"));
    cleanupDirs.push(cwd);

    const result = await execute(makeCtx(cwd));

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { cwd: string; env: Record<string, string> }]
      | undefined;
    expect(call?.[1]).toBe("hermes");
    const args = call?.[2] ?? [];
    expect(args.slice(0, 3)).toEqual(["chat", "-q", expect.any(String)]);
    expect(args).toContain("-Q");
    // model + remote inference provider routing
    expect(args).toEqual(
      expect.arrayContaining(["-m", "anthropic/claude-sonnet-4", "--provider", "openrouter"]),
    );
    // non-interactive subprocess → approval bypass on by default
    expect(args).toContain("--yolo");
    // cold start: no resume
    expect(args).not.toContain("--resume");
    expect(call?.[3].cwd).toBe(cwd);

    // new session id parsed from quiet output is persisted with the run cwd
    expect(result.exitCode).toBe(0);
    expect(result.provider).toBe("openrouter");
    expect(result.sessionParams).toEqual({ sessionId: "sess-new-1", cwd });
  });

  it("resumes a saved session when its cwd matches the current workspace", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-resume-"));
    cleanupDirs.push(cwd);

    await execute(
      makeCtx(cwd, {
        runtime: {
          sessionId: "sess-old",
          sessionParams: { sessionId: "sess-old", cwd },
          sessionDisplayId: "sess-old",
          taskKey: null,
        },
      }),
    );

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const args = (runChildProcess.mock.calls[0] as unknown as [string, string, string[]])[2];
    expect(args).toEqual(expect.arrayContaining(["--resume", "sess-old"]));
  });

  it("does NOT resume a saved session created in a different cwd (workspace drift guard)", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-drift-"));
    cleanupDirs.push(cwd);

    await execute(
      makeCtx(cwd, {
        runtime: {
          sessionId: "sess-old",
          sessionParams: { sessionId: "sess-old", cwd: "/some/other/workspace" },
          sessionDisplayId: "sess-old",
          taskKey: null,
        },
      }),
    );

    const args = (runChildProcess.mock.calls[0] as unknown as [string, string, string[]])[2];
    expect(args).not.toContain("--resume");
  });
});
