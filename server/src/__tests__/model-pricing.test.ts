import { describe, expect, it } from "vitest";
import { priceCents } from "../services/model-pricing.ts";

describe("priceCents", () => {
  it("prices anthropic input as fresh (input EXCLUDES cached reads)", () => {
    // opus: input 15, cached 1.5, output 75 ($/1M). Anthropic input is already fresh.
    // 1M fresh @1500c + 2M cached @150c + 0.5M out @7500c = 1500 + 300 + 3750 = 5550c
    const cents = priceCents({
      provider: "anthropic",
      model: "claude-opus-4-8",
      inputTokens: 1_000_000,
      cachedInputTokens: 2_000_000,
      outputTokens: 500_000,
    });
    expect(cents).toBe(5550);
  });

  it("subtracts cached from input for openai (input INCLUDES cached subset)", () => {
    // gpt-5.5: input 1.25, cached 0.125, output 10 ($/1M). input includes cached.
    // fresh = 10M - 6M = 4M. 4M @125c + 6M cached @12.5c + 1M out @1000c
    //       = 500 + 75 + 1000 = 1575c
    const cents = priceCents({
      provider: "openai",
      model: "gpt-5.5",
      inputTokens: 10_000_000,
      cachedInputTokens: 6_000_000,
      outputTokens: 1_000_000,
    });
    expect(cents).toBe(1575);
  });

  it("applies the cheaper codex-spark tier by prefix", () => {
    // spark: 0.50 / 0.05 / 4. fresh = 2M-1M = 1M @50c + 1M cached @5c + 0 = 55c
    const cents = priceCents({
      provider: "openai",
      model: "gpt-5.3-codex-spark",
      inputTokens: 2_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cents).toBe(55);
  });

  it("applies the >200k context [1m] premium for anthropic", () => {
    // opus [1m]: 30 / 3 / 150. 1M fresh @3000c = 3000c
    const cents = priceCents({
      provider: "anthropic",
      model: "claude-opus-4-8[1m]",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
    expect(cents).toBe(3000);
  });

  it("prices gemini and subtracts cached (google input includes cached)", () => {
    // gemini-2.5-flash-lite: 0.10 / 0.025 / 0.40. fresh = 2M-1M=1M @10c + 1M cached @2.5c = 12.5 -> 13
    const cents = priceCents({
      provider: "google",
      model: "gemini-2.5-flash-lite",
      inputTokens: 2_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cents).toBe(13);
  });

  it("prices self-hosted/local models at zero", () => {
    expect(
      priceCents({
        provider: "local",
        model: "local/qwen3.6-27b-autoround",
        inputTokens: 5_000_000,
        cachedInputTokens: 0,
        outputTokens: 5_000_000,
      }),
    ).toBe(0);
  });

  it("falls back to the unknown-provider default rate", () => {
    // unknown: 2 / 0.20 / 8. fresh = 1M @200c + 0 + 1M out @800c = 1000c
    const cents = priceCents({
      provider: "somethingelse",
      model: "mystery-model",
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    });
    expect(cents).toBe(1000);
  });

  it("handles null/zero token fields safely", () => {
    expect(
      priceCents({ provider: null, model: null, inputTokens: null, cachedInputTokens: null, outputTokens: null }),
    ).toBe(0);
  });
});
