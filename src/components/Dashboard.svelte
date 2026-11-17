<script lang="ts">
  import { onMount } from 'svelte';
  import { applyEvent, groupAgents, type Agent } from '../lib/agents';
  import { updateTabAttention } from '../lib/attention';
  import type { AgentEvent } from '../lib/events';
  import AgentCard from './AgentCard.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import WeeklyUsage from './WeeklyUsage.svelte';

  let agents = $state<Agent[]>([]);
  let connection = $state('Connecting');
  let query = $state('');
  let now = $state(Date.now());
  let gap = $state(false);
  let endpoint = $state('/api/events');
  const families = $derived(groupAgents(agents));
  const visible = $derived(groupAgents(agents, query));
  const subagentCount = $derived(agents.filter((agent) => agent.parentSessionId).length);
  const machineCount = $derived(new Set(agents.map((agent) => agent.machine)).size);

  $effect(() => { updateTabAttention(agents); });

  function age(timestamp: string): string {
    const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  onMount(() => {
    endpoint = `${window.location.origin}/api/events`;
    const stream = new EventSource('/api/stream');
    let opened = false;
    stream.onopen = () => {
      if (opened) gap = true;
      opened = true;
      connection = 'Connected';
    };
    stream.onerror = () => { connection = 'Reconnecting'; };
    stream.addEventListener('agent', (message) => {
      agents = applyEvent(agents, JSON.parse(message.data) as AgentEvent);
      now = Date.now();
    });
    const clock = setInterval(() => { now = Date.now(); }, 1000);
    return () => { stream.close(); clearInterval(clock); updateTabAttention([]); };
  });
</script>

<div class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Codex Agents home"><span class="mark">›_</span> CODEX <span class="slash">/</span> <span class="brand-light">AGENTS</span></a>
    <div class="header-actions"><ThemeToggle /><span class="connection" class:connected={connection === 'Connected'}><i></i>{connection}</span></div>
  </header>

  <main>
    <section class="summary" aria-label="Activity overview">
      <div><span class="metric">{agents.length.toString().padStart(2, '0')}</span><span>Sessions seen</span></div>
      <div><span class="metric">{subagentCount.toString().padStart(2, '0')}</span><span>Subagents</span></div>
      <div><span class="metric">{machineCount.toString().padStart(2, '0')}</span><span>Machines seen</span></div>
      <div><WeeklyUsage /></div>
      <div class="last-update"><span class="metric small">{agents[0] ? age(agents[0].lastSeen) : '—'}</span><span>Last update</span></div>
      <p>Live view only<span>Refresh to start fresh.</span></p>
    </section>

    {#if gap}<p class="notice" role="status">Stream reconnected. Updates sent during the connection gap were not recorded.</p>{/if}

    <section class="activity" aria-labelledby="activity-title">
      <div class="toolbar"><h1 id="activity-title">Agent activity <span>{families.length}</span></h1>
        <div class="actions"><label class="search"><span aria-hidden="true">⌕</span><input aria-label="Filter sessions by machine, project, or session" placeholder="Find a machine or project…" bind:value={query} /></label><button class="clear" onclick={() => { agents = []; gap = false; }} disabled={!agents.length}>Clear view</button></div>
      </div>

      {#if !agents.length}
        <div class="empty">
          <div class="terminal" aria-hidden="true"><span>›</span><span class="cursor">_</span></div>
          <p class="empty-label">READY WHEN YOUR AGENTS ARE</p>
          <h3>Waiting for the next update</h3>
          <p>Connect your Codex CLI hooks to this dashboard.<br />Sessions will appear here as their events arrive.</p>
          <a href="#connect">Connect an agent <span aria-hidden="true">↗</span></a>
        </div>
      {:else if !visible.length}
        <div class="no-results"><h3>No matching sessions</h3><p>Try another machine, project, or session ID.</p><button onclick={() => { query = ''; }}>Reset filter</button></div>
      {:else}
        <div class="grid">
          {#each visible as node (node.key)}
            <AgentCard {node} {now} />
          {/each}
        </div>
      {/if}
    </section>

    <details id="connect" class="setup">
      <summary><span><span class="setup-icon" aria-hidden="true">↗</span> Connect your Codex agents</span><span class="setup-hint">DIRECT HOOKS · NO COLLECTOR</span></summary>
      <div class="setup-body"><p>Use <code>hooks/codex.json</code> for Codex CLI or <code>hooks/claude-code.json</code> for Claude Code. Set the dashboard address before merging the hooks into your CLI settings.</p><pre><code>curl --max-time 1 -H "Content-Type: application/json" -H "X-Machine: my-pc" -H "X-Harness: codex" --data-binary @- {endpoint}</code></pre><p class="muted">A refreshed page starts empty. Silence means no recent update; it does not indicate that an agent is offline.</p></div>
    </details>
    <footer class="page-footer"><span><span class="footer-dot"></span> A window into the work.</span><span>NO HISTORY. JUST NOW.</span></footer>
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: var(--page); color: var(--text); font-family: Inter, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  :global(button), :global(input) { font: inherit; }
  :global(button), :global(a), :global(summary) { -webkit-tap-highlight-color: transparent; }
  :global(button:focus-visible), :global(a:focus-visible), :global(summary:focus-visible), :global(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 4px; }
  :global(button) { cursor: pointer; }
  :global(button:disabled) { cursor: default; opacity: .4; }
  :global(code) { font-family: Consolas, "SFMono-Regular", monospace; }
  .shell { max-width: 1600px; margin: auto; padding: 0 3%; }
  .topbar { height: 64px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 750; letter-spacing: 1.8px; text-decoration: none; color: inherit; }
  .mark { background: var(--brand-background); color: var(--brand-text); border-radius: 7px; display: grid; place-items: center; width: 30px; height: 30px; font: 700 21px Consolas, monospace; letter-spacing: -4px; padding-right: 5px; }
  .brand-light { font-weight: 450; }
  .header-actions { display: flex; align-items: center; gap: 10px; }
  .slash { color: var(--faint); margin: 0 2px; }
  .connection { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 20px; padding: 7px 11px; font-size: 11px; color: var(--muted); background: var(--surface-raised); }
  .connection i, .footer-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
  .connection.connected i { background: var(--success); box-shadow: 0 0 0 3px var(--accent-soft); }
  main { padding-top: 16px; }
  .summary { display: flex; align-items: center; border-bottom: 1px solid var(--border); padding: 12px 0 20px; }
  .summary > div { display: flex; align-items: center; gap: 12px; padding-right: 28px; }
  .summary > div + div { border-left: 1px solid var(--border); padding-left: 28px; }
  .metric { font-size: 28px; font-weight: 450; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
  .summary > div > span + span { font-size: 11px; color: var(--muted); }
  .metric.small { font-size: 18px; letter-spacing: -.5px; white-space: nowrap; }
  .summary > p { margin: 0 0 0 auto; text-align: right; font-size: 11px; color: var(--muted); line-height: 1.8; }
  .summary > p span { display: block; color: var(--faint); }
  .activity { margin-top: 22px; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; white-space: nowrap; }
  h1 span { font-size: 10px; margin-left: 8px; border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; color: var(--faint); }
  .actions { display: flex; align-items: center; gap: 18px; }
  .search { display: flex; align-items: center; gap: 10px; background: var(--surface-raised); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--muted); }
  .search > span { font-size: 21px; line-height: 12px; }
  .search input { font-size: 11px; width: 210px; background: transparent; border: 0; color: inherit; }
  .clear { font-size: 11px; border: 0; background: none; color: var(--muted); padding: 8px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: start; gap: 16px; }
  .empty { min-height: 280px; border: 1px dashed var(--border); border-radius: 10px; background: radial-gradient(ellipse at center, var(--surface-raised), var(--surface-soft)); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 20px; text-align: center; }
  .terminal { width: 48px; height: 40px; border: 1px solid var(--accent-border); border-radius: 8px; background: var(--accent-soft); font: 28px Consolas, monospace; display: flex; justify-content: center; align-items: center; color: var(--muted); box-shadow: 0 3px 0 var(--border); }
  .cursor { font-size: 22px; margin-top: 6px; }
  .empty-label { font-size: 9px; letter-spacing: 1.8px; color: var(--faint); margin: 20px 0 10px; }
  .empty h3 { font-size: 21px; letter-spacing: -.5px; font-weight: 500; margin: 0; }
  .empty > p:not(.empty-label) { font-size: 12px; line-height: 1.9; color: var(--faint); margin: 10px 0 20px; }
  .empty > a { font-size: 11px; text-decoration: none; border: 1px solid var(--accent-border); border-radius: 5px; padding: 10px 15px; color: var(--muted); background: var(--surface-raised); }
  .empty > a span { margin-left: 18px; }
  .setup { margin-top: 22px; border: 1px solid var(--border); border-radius: 7px; scroll-margin-top: 24px; }
  .setup summary { list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 15px 18px; cursor: pointer; font-size: 12px; color: var(--muted); }
  .setup summary::-webkit-details-marker { display: none; }
  .setup-icon { margin-right: 12px; font-size: 16px; color: var(--faint); }
  .setup-hint { font-size: 8px; letter-spacing: 1.2px; color: var(--faint); }
  .setup-body { padding: 0 18px 16px; font-size: 12px; line-height: 1.8; color: var(--muted); }
  .setup-body code { font-size: 11px; }
  .setup-body pre { background: var(--code-background); border-radius: 5px; padding: 14px; overflow: auto; color: var(--muted); }
  .muted { color: var(--faint); }
  .page-footer { display: flex; justify-content: space-between; align-items: center; margin: 22px 0 26px; font-size: 10px; color: var(--faint); }
  .page-footer > span:first-child { display: flex; align-items: center; gap: 7px; }
  .footer-dot { width: 4px; height: 4px; background: var(--faint); }
  .page-footer > span:last-child { font-size: 8px; letter-spacing: 1.3px; }
  .no-results { padding: 55px 20px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--faint); }
  .no-results h3 { font-weight: 500; color: var(--muted); }
  .no-results p { font-size: 12px; }
  .no-results button { padding: 8px 12px; border: 1px solid var(--accent-border); border-radius: 5px; background: transparent; color: var(--muted); font-size: 11px; }
  .notice { font-size: 12px; color: var(--attention-text); background: var(--attention-background); border: 1px solid var(--attention-border); padding: 12px 16px; border-radius: 5px; }
  @media (max-width: 1000px) {
    .summary > p { display: none; }
    .summary { justify-content: space-between; }
    .summary > div { padding-right: 20px; }
    .summary > div + div { padding-left: 20px; }
  }
  @media (max-width: 760px) {
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 14px; }
    .summary > div { min-width: 0; }
    .summary > div:nth-child(3n + 1) { border-left: 0; padding-left: 0; }
  }
  @media (max-width: 600px) {
    .shell { padding: 0 5%; }
    .topbar { height: 58px; }
    .brand { gap: 7px; font-size: 10px; letter-spacing: 1px; }
    .connection { font-size: 10px; padding: 7px 9px; }
    main { padding-top: 10px; }
    .summary { padding: 8px 0 14px; }
    .summary > div { flex-direction: column; align-items: flex-start; gap: 5px; padding-right: 10px; }
    .summary > div + div { padding-left: 10px; }
    .summary > div > span + span { font-size: 9px; }
    .metric { font-size: 23px; }
    .metric.small { font-size: 15px; min-height: 27px; display: flex; align-items: center; }
    .activity { margin-top: 18px; }
    .toolbar { flex-wrap: wrap; gap: 14px; }
    .actions { width: 100%; justify-content: space-between; }
    .search { flex: 1; min-width: 0; }
    .search input { width: 100%; min-width: 0; }
    .setup summary { padding: 14px; }
    .setup-hint { display: none; }
    .page-footer > span:last-child { font-size: 7px; letter-spacing: .7px; }
  }
</style>
