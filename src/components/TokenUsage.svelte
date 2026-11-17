<script lang="ts">
  import { formatTokens, uncachedSessionTokens, type SessionTokenUsage } from '../lib/tokens';
  let { usage, compact = false }: { usage?: SessionTokenUsage; compact?: boolean } = $props();
  const used = $derived(uncachedSessionTokens(usage));
  const tooltip = $derived(usage
    ? `${used !== undefined ? `${used.toLocaleString()} used tokens (uncached input + output)` : 'Uncached usage unavailable; token breakdown not reported'} · ${usage.totalTokens.toLocaleString()} total including cache${usage.inputTokens !== undefined ? ` · ${usage.inputTokens.toLocaleString()} input` : ''}${usage.outputTokens !== undefined ? ` · ${usage.outputTokens.toLocaleString()} output` : ''}${usage.cachedInputTokens !== undefined ? ` · ${usage.cachedInputTokens.toLocaleString()} cached input (excluded from used tokens)` : ''}. Last reported ${new Date(usage.observedAt).toLocaleString()}.`
    : 'Session token usage has not been reported yet.');
</script>

<div class="tokens" class:compact title={tooltip}>
  <span>Tokens used</span><strong>{used !== undefined ? formatTokens(used) : '—'}</strong>
</div>

<style>
  .tokens { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 0 0 14px; font-size: 11px; color: var(--faint); }
  strong { color: var(--muted); font-weight: 550; font-variant-numeric: tabular-nums; }
  .compact { margin: 8px 0 8px 18px; font-size: 10px; }
</style>
