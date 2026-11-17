<script lang="ts">
  import { onMount } from 'svelte';
  import type { WeeklyUsage } from '../lib/usage';

  let usage = $state<WeeklyUsage | null>(null);
  let loading = $state(true);
  const tooltip = $derived(usage?.status === 'available'
    ? `Codex account on the dashboard machine. ${usage.resetsAt ? `Resets ${new Date(usage.resetsAt).toLocaleString()}. ` : ''}Checked ${new Date(usage.checkedAt).toLocaleTimeString()}.`
    : `Codex account on the dashboard machine. ${loading ? 'Checking weekly limit…' : 'Weekly limit unavailable. Codex must be installed and signed in with a ChatGPT account.'}`);

  onMount(() => {
    let stopped = false;
    let request: AbortController | undefined;
    async function refresh() {
      if (request) return;
      request = new AbortController();
      try {
        const response = await fetch('/api/usage', { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Usage unavailable');
        const next = await response.json() as WeeklyUsage;
        if (!stopped) usage = next;
      } catch {
        if (!stopped) usage = null;
      } finally {
        if (!stopped) loading = false;
        request = undefined;
      }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => { stopped = true; clearInterval(timer); request?.abort(); };
  });
</script>

<span class="value" class:low={usage?.status === 'available' && usage.remainingPercent !== null && usage.remainingPercent <= 10} title={tooltip} aria-live="polite">{usage?.status === 'available' ? `${usage.remainingPercent}%` : '—'}</span>
<span class="label" title={tooltip}>Codex weekly left</span>

<style>
  .value { font-size: 28px; font-weight: 450; letter-spacing: -1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .value.low { color: var(--attention-text); }
  .label { font-size: 11px; color: var(--muted); }
  @media (max-width: 600px) { .value { font-size: 23px; } .label { font-size: 9px; } }
</style>
