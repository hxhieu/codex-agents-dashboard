<script lang="ts">
  import { needsAttention } from '../lib/attention';
  let { status }: { status: string } = $props();
  const waiting = $derived(needsAttention(status));
</script>

<span class="status" class:waiting class:attention={status === 'Approval requested'}>{status}</span>

<style>
  .status {
    display: inline-flex;
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.3;
    border: 1px solid var(--accent-border);
    border-radius: 20px;
    padding: 5px 8px;
    background: var(--accent-soft);
    color: var(--accent);
    white-space: nowrap;
  }
  .status.attention { color: var(--attention-text); background: var(--attention-background); border-color: var(--attention-border); }
  .status.waiting {
    --pulse-background: var(--status-pulse-background);
    --pulse-border: var(--status-pulse-border);
    --pulse-ring: var(--status-pulse-ring);
    transform-origin: center;
    animation: waiting-pulse 1.6s ease-in-out infinite;
  }
  .status.waiting.attention {
    --pulse-background: var(--attention-pulse-background);
    --pulse-border: var(--attention-pulse-border);
    --pulse-ring: var(--attention-pulse-ring);
  }
  @keyframes waiting-pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
    50% {
      transform: scale(1.08);
      background: var(--pulse-background);
      border-color: var(--pulse-border);
      box-shadow: 0 0 0 5px var(--pulse-ring);
    }
  }
  @media (prefers-reduced-motion: reduce) { .status.waiting { animation: none; } }
</style>
