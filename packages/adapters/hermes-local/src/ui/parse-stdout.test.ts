import { describe, expect, it } from "vitest";
import { parseHermesStdoutLine } from "./parse-stdout.js";

const TS = "2026-06-07T12:00:00.000Z";

describe("parseHermesStdoutLine", () => {
  it("skips blank lines", () => {
    expect(parseHermesStdoutLine("   ", TS)).toEqual([]);
  });

  it("extracts assistant text from a quiet-mode message line", () => {
    expect(parseHermesStdoutLine("  ┊ 💬 Hello from Hermes", TS)).toEqual([
      { kind: "assistant", ts: TS, text: "Hello from Hermes" },
    ]);
  });

  it("classifies [hermes] adapter lines as system entries", () => {
    expect(parseHermesStdoutLine("[hermes] Starting Hermes Agent", TS)).toEqual([
      { kind: "system", ts: TS, text: "[hermes] Starting Hermes Agent" },
    ]);
  });

  it("reclassifies structured timestamp log lines as stderr (amber accordion)", () => {
    const line = "[2026-06-07T10:40:53.941Z] INFO: MCP server ready";
    expect(parseHermesStdoutLine(line, TS)).toEqual([
      { kind: "stderr", ts: TS, text: line },
    ]);
  });

  it("emits a paired tool_call/tool_result with a shared synthetic id", () => {
    const entries = parseHermesStdoutLine('[done] ┊ 💻 $ curl -s http://x  0.1s (0.5s)', TS);
    expect(entries).toHaveLength(2);

    const [call, result] = entries;
    expect(call.kind).toBe("tool_call");
    expect(result.kind).toBe("tool_result");
    // call and result must reference the same synthetic toolUseId so Paperclip
    // can pair them in normalizeTranscript.
    expect(call).toMatchObject({ kind: "tool_call", ts: TS });
    expect(result).toMatchObject({ kind: "tool_result", ts: TS, isError: false });
    const callId = (call as { toolUseId: string }).toolUseId;
    const resultId = (result as { toolUseId: string }).toolUseId;
    expect(callId).toBe(resultId);
    expect(callId).toMatch(/^hermes-tool-\d+$/);
  });

  it("marks tool results with an [exit N] suffix as errors", () => {
    const entries = parseHermesStdoutLine("┊ 💻 $ ls /nope [exit 1]  0.1s", TS);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("treats plain output as assistant text", () => {
    expect(parseHermesStdoutLine("just some text", TS)).toEqual([
      { kind: "assistant", ts: TS, text: "just some text" },
    ]);
  });
});
