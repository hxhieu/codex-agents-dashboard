export interface SessionTokenUsage {
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  observedAt: string;
}

/** Accept cumulative session snapshots only; raw token_usage can mean one request. */
export function normalizeSessionTokens(value: unknown): SessionTokenUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!count(input.total_tokens)) return;
  if (typeof input.observed_at !== "string" || !Number.isFinite(Date.parse(input.observed_at))) return;
  const result: SessionTokenUsage = { totalTokens: input.total_tokens, observedAt: new Date(input.observed_at).toISOString() };
  for (const [source, target] of [["input_tokens", "inputTokens"], ["output_tokens", "outputTokens"], ["cached_input_tokens", "cachedInputTokens"]] as const) {
    if (input[source] === undefined) continue;
    if (!count(input[source])) return;
    result[target] = input[source];
  }
  if ((result.inputTokens ?? 0) > result.totalTokens || (result.outputTokens ?? 0) > result.totalTokens || (result.cachedInputTokens ?? 0) > (result.inputTokens ?? result.totalTokens)) return;
  return result;
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/** Match the CLI's used-token count: uncached input plus output. */
export function uncachedSessionTokens(usage?: SessionTokenUsage): number | undefined {
  if (usage?.inputTokens === undefined || usage.outputTokens === undefined || usage.cachedInputTokens === undefined) return;
  return Math.max(0, usage.inputTokens - usage.cachedInputTokens) + usage.outputTokens;
}
