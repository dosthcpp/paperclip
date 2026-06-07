import { describe, expect, it } from "vitest";
import { buildHermesConfig } from "./build-config.js";
import { DEFAULT_TIMEOUT_SEC } from "../shared/constants.js";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "hermes_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "anthropic/claude-sonnet-4",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: true,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: true,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 0,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

describe("buildHermesConfig", () => {
  it("persists trimmed model, default timeout, and session persistence", () => {
    const config = buildHermesConfig(makeValues({ model: "  anthropic/claude-sonnet-4  " }));
    expect(config).toMatchObject({
      model: "anthropic/claude-sonnet-4",
      timeoutSec: DEFAULT_TIMEOUT_SEC,
      persistSession: true,
    });
  });

  it("maps the custom binary form field to hermesCommand", () => {
    const config = buildHermesConfig(makeValues({ command: "/opt/hermes/bin/hermes" }));
    expect(config.hermesCommand).toBe("/opt/hermes/bin/hermes");
  });

  it("only persists a positive maxTurns override (0/unset lets Hermes default)", () => {
    expect(buildHermesConfig(makeValues({ maxTurnsPerRun: 0 })).maxTurns).toBeUndefined();
    expect(buildHermesConfig(makeValues({ maxTurnsPerRun: 25 })).maxTurns).toBe(25);
  });

  it("leaves yolo unset so execute.ts can default it ON for no-TTY agents", () => {
    expect(buildHermesConfig(makeValues())).not.toHaveProperty("yolo");
  });

  it("splits extraArgs and appends reasoning-effort from thinkingEffort", () => {
    const config = buildHermesConfig(
      makeValues({ extraArgs: "--foo  --bar", thinkingEffort: "high" }),
    );
    expect(config.extraArgs).toEqual(["--foo", "--bar", "--reasoning-effort", "high"]);
  });
});
