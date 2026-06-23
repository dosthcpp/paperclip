// Model rate card for imputing notional spend from token usage (TON-2609 / TON-2611).
//
// Token usage is always tracked in `cost_events`, but adapters frequently report
// no `costUsd` (every OpenAI metered event, and all `subscription_included` events).
// Those rows would otherwise store `cost_cents = 0`, zeroing every downstream spend
// aggregate (company/agent `spentMonthlyCents`, dashboard `costs.monthSpendCents`).
//
// `priceCents` converts stored token counts into cents using list-price rates so the
// board gets burn/runway visibility. This is NOTIONAL list-price spend, not actual
// subscription outflow — keep `billingType` on the event so a future view can split
// real-metered from notional-subscription spend.
//
// Provider token-accounting note (important for correctness):
//   - Anthropic reports `input_tokens` EXCLUDING cache reads (cache reads are a
//     separate, additive field), so fresh input = inputTokens.
//   - OpenAI and Google report a prompt/input total that INCLUDES cached tokens as a
//     subset, so fresh input = max(0, inputTokens - cachedInputTokens). Pricing the
//     full input again at the input rate would double-count cached tokens (~5–10x
//     overcount, since cached dwarfs fresh input here).

export interface PriceCentsInput {
  provider: string | null | undefined;
  model: string | null | undefined;
  inputTokens: number | null | undefined;
  cachedInputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
}

// Rates are cents per 1,000,000 tokens (USD per 1M × 100). Centralized so they can be
// tuned to real contract rates without touching call sites.
export interface ModelRate {
  inputCentsPerM: number;
  cachedCentsPerM: number;
  outputCentsPerM: number;
}

const UNKNOWN_RATE: ModelRate = { inputCentsPerM: 200, cachedCentsPerM: 20, outputCentsPerM: 800 };
const ZERO_RATE: ModelRate = { inputCentsPerM: 0, cachedCentsPerM: 0, outputCentsPerM: 0 };

function rateFor(provider: string, model: string): ModelRate {
  const p = provider.trim().toLowerCase();
  const m = model.trim().toLowerCase();

  if (p === "local" || m.startsWith("local/")) return ZERO_RATE;

  if (p === "anthropic") {
    if (m.includes("[1m]")) return { inputCentsPerM: 3000, cachedCentsPerM: 300, outputCentsPerM: 15000 };
    if (m.startsWith("claude-opus")) return { inputCentsPerM: 1500, cachedCentsPerM: 150, outputCentsPerM: 7500 };
    if (m.startsWith("claude-sonnet")) return { inputCentsPerM: 300, cachedCentsPerM: 30, outputCentsPerM: 1500 };
    if (m.startsWith("claude-haiku")) return { inputCentsPerM: 80, cachedCentsPerM: 8, outputCentsPerM: 400 };
    if (m.startsWith("claude-fable")) return { inputCentsPerM: 300, cachedCentsPerM: 30, outputCentsPerM: 1500 };
    return { inputCentsPerM: 300, cachedCentsPerM: 30, outputCentsPerM: 1500 }; // anthropic default (sonnet tier)
  }

  if (p === "openai") {
    if (m.startsWith("gpt-5.3-codex-spark")) return { inputCentsPerM: 50, cachedCentsPerM: 5, outputCentsPerM: 400 };
    // gpt-5.5 / gpt-5.4 / gpt-5.3-codex and openai default
    return { inputCentsPerM: 125, cachedCentsPerM: 12.5, outputCentsPerM: 1000 };
  }

  if (p === "google") {
    if (m.startsWith("gemini-3.1-pro")) return { inputCentsPerM: 125, cachedCentsPerM: 31, outputCentsPerM: 1000 };
    if (m.startsWith("gemini-2.5-flash-lite")) return { inputCentsPerM: 10, cachedCentsPerM: 2.5, outputCentsPerM: 40 };
    return { inputCentsPerM: 200, cachedCentsPerM: 20, outputCentsPerM: 800 }; // google auto / unknown
  }

  return UNKNOWN_RATE;
}

function clampToken(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Impute notional cost in whole cents from token counts and the model rate card.
 * Returns a non-negative integer. Returns 0 for self-hosted/local models.
 */
export function priceCents(input: PriceCentsInput): number {
  const provider = input.provider ?? "unknown";
  const model = input.model ?? "unknown";
  const inputTokens = clampToken(input.inputTokens);
  const cachedInputTokens = clampToken(input.cachedInputTokens);
  const outputTokens = clampToken(input.outputTokens);

  const rate = rateFor(provider, model);

  // Anthropic: input excludes cached. Others: input includes cached as a subset.
  const freshInput = provider.trim().toLowerCase() === "anthropic"
    ? inputTokens
    : Math.max(0, inputTokens - cachedInputTokens);

  const cents =
    (freshInput / 1_000_000) * rate.inputCentsPerM +
    (cachedInputTokens / 1_000_000) * rate.cachedCentsPerM +
    (outputTokens / 1_000_000) * rate.outputCentsPerM;

  return Math.max(0, Math.round(cents));
}
