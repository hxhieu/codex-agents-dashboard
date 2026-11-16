<script lang="ts">
  let { status }: { status: string } = $props();
  const waiting = $derived(['Awaiting prompt', 'Awaiting answer', 'Approval requested'].includes(status));
</script>

<span class="status" class:waiting class:attention={status === 'Approval requested'}>{status}</span>

<style>
  .status {
    display: inline-flex;
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.3;
    border: 1px solid #d7e3c9;
    border-radius: 20px;
    padding: 5px 8px;
    background: #edf3e5;
    color: #597944;
    white-space: nowrap;
  }
  .status.attention { color: #8b6424; background: #fcf2d9; border-color: #ead5a5; }
  .status.waiting {
    --pulse-background: #c7e89c;
    --pulse-border: #71984d;
    --pulse-ring: rgb(89 121 68 / 30%);
    transform-origin: center;
    animation: waiting-pulse 1.6s ease-in-out infinite;
  }
  .status.waiting.attention {
    --pulse-background: #f7d27d;
    --pulse-border: #bb852a;
    --pulse-ring: rgb(187 133 42 / 30%);
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
