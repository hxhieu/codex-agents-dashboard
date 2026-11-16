<script lang="ts">
  import { onMount } from 'svelte';
  import { applyEvent, type Agent } from '../lib/agents';
  import type { AgentEvent } from '../lib/events';

  let agents = $state<Agent[]>([]);
  let connection = $state('Connecting');
  let query = $state('');
  let now = $state(Date.now());
  let gap = $state(false);
  let endpoint = $state('/api/events');
  const visible = $derived(agents.filter((agent) =>
    `${agent.machine} ${agent.cwd} ${agent.sessionId} ${agent.agentType ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  const machineCount = $derived(new Set(agents.map((agent) => agent.machine)).size);

  function age(timestamp: string): string {
    const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function project(cwd: string): string {
    return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Unknown project';
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
    return () => { stream.close(); clearInterval(clock); };
  });
</script>

<svelte:head><meta name="theme-color" content="#f4f5ef" /></svelte:head>

<div class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Codex Agents home"><span class="mark">›_</span> CODEX <span class="slash">/</span> <span class="brand-light">AGENTS</span></a>
    <span class="connection" class:connected={connection === 'Connected'}><i></i>{connection}</span>
  </header>

  <main>
    <section class="intro">
      <div><p class="eyebrow">LOCAL NETWORK · LIVE ACTIVITY</p><h1>Your agents, in view<span>.</span></h1><p class="subtitle">A quiet place to keep up with the work happening across your machines.</p></div>
      <div class="live-note"><span class="pulse"></span> Updates as they happen</div>
    </section>

    <section class="summary" aria-label="Activity overview">
      <div><span class="metric">{agents.length.toString().padStart(2, '0')}</span><span>Sessions seen</span></div>
      <div><span class="metric">{machineCount.toString().padStart(2, '0')}</span><span>Machines seen</span></div>
      <div class="last-update"><span class="metric small">{agents[0] ? age(agents[0].lastSeen) : '—'}</span><span>Last update</span></div>
      <p>Live view only<span>Refresh to start fresh.</span></p>
    </section>

    {#if gap}<p class="notice" role="status">Stream reconnected. Updates sent during the connection gap were not recorded.</p>{/if}

    <section class="activity" aria-labelledby="activity-title">
      <div class="toolbar"><h2 id="activity-title">Agent activity <span>{agents.length}</span></h2>
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
          {#each visible as agent (agent.key)}
            <article class="card">
              <div class="card-top"><span class="machine"><span aria-hidden="true">▣</span> {agent.machine}</span><span class="status" class:attention={agent.status === 'Approval requested'}>{agent.status}</span></div>
              <h3>{project(agent.cwd)}</h3>
              <p class="path" title={agent.cwd}>{agent.cwd || 'Project path not reported'}</p>
              {#if agent.parentSessionId}<p class="subagent">Subagent{agent.agentType ? ` · ${agent.agentType}` : ''} <span title={agent.parentSessionId}>of {agent.parentSessionId.slice(0, 8)}</span></p>{/if}
              <div class="current"><span class="eyebrow">LATEST OBSERVED ACTIVITY</span><p>{Object.values(agent.tools).join(' · ') || agent.latestEvent}</p></div>
              <footer><code title={agent.sessionId}>{agent.sessionId.slice(0, 12)}</code><time datetime={agent.lastSeen} title={new Date(agent.lastSeen).toLocaleString()}>Updated {age(agent.lastSeen)}</time></footer>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <details id="connect" class="setup">
      <summary><span><span class="setup-icon" aria-hidden="true">↗</span> Connect your Codex agents</span><span class="setup-hint">DIRECT HOOKS · NO COLLECTOR</span></summary>
      <div class="setup-body"><p>Post Codex hook JSON to <code>{endpoint}</code> with a unique <code>X-Machine</code> header for each computer. See <code>examples/hooks.json</code> for ready-to-adapt hook configuration.</p><pre><code>curl --max-time 1 -H "Content-Type: application/json" -H "X-Machine: my-pc" --data-binary @- {endpoint}</code></pre><p class="muted">A refreshed page starts empty. Silence means no recent update; it does not indicate that an agent is offline.</p></div>
    </details>
    <footer class="page-footer"><span><span class="footer-dot"></span> A window into the work.</span><span>NO HISTORY. JUST NOW.</span></footer>
  </main>
</div>

<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#f4f5ef;color:#24362c;font-family:Inter,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased} :global(button),:global(input){font:inherit} :global(button),:global(a),:global(summary){-webkit-tap-highlight-color:transparent} :global(button:focus-visible),:global(a:focus-visible),:global(summary:focus-visible),:global(input:focus-visible){outline:3px solid #81ad50;outline-offset:4px} :global(button){cursor:pointer} :global(button:disabled){cursor:default;opacity:.4} :global(code){font-family:Consolas,"SFMono-Regular",monospace}
  .shell{max-width:1440px;margin:auto;padding:0 6%}.topbar{height:96px;border-bottom:1px solid #dce1d6;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;font-size:13px;font-weight:750;letter-spacing:1.8px;text-decoration:none;color:inherit}.mark{background:#24362c;color:#ceee9f;border-radius:8px;display:grid;place-items:center;width:35px;height:35px;font:700 24px Consolas,monospace;letter-spacing:-4px;padding-right:5px}.brand-light{font-weight:450}.slash{color:#99a591;margin:0 2px}.connection{display:flex;align-items:center;gap:8px;border:1px solid #d8ded1;border-radius:20px;padding:8px 12px;font-size:12px;color:#66735f;background:#f9faf5}.connection i,.pulse,.footer-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#a8ad9c}.connection.connected i{background:#5b8a42;box-shadow:0 0 0 3px #e2ecd9}main{padding-top:54px}.intro{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.eyebrow{font-size:10px;font-weight:650;letter-spacing:1.7px;color:#74816c}.intro .eyebrow{margin:0 0 16px}h1{font-weight:500;letter-spacing:-2px;font-size:clamp(30px,3.5vw,47px);line-height:1.15;margin:0}h1 span{color:#759b46}.subtitle{font-size:14px;line-height:1.7;color:#78816f;margin:15px 0 0}.live-note{font-size:11px;color:#7b876e;white-space:nowrap;padding-bottom:6px;display:flex;align-items:center;gap:8px}.pulse{background:#6e914c}.summary{display:flex;align-items:center;gap:0;border-block:1px solid #dce1d6;margin-top:35px;padding:24px 0}.summary>div{min-width:170px;display:flex;align-items:center;gap:14px;padding-right:32px}.summary>div+div{border-left:1px solid #dce1d6;padding-left:32px}.metric{font-size:31px;font-weight:450;letter-spacing:-1px;font-variant-numeric:tabular-nums}.summary>div>span+span{font-size:11px;color:#75816a}.metric.small{font-size:20px;letter-spacing:-.5px;white-space:nowrap}.summary>p{margin:0 0 0 auto;text-align:right;font-size:11px;color:#596c4e;line-height:1.8}.summary>p span{display:block;color:#87917c}.activity{margin-top:36px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}h2{font-size:15px;font-weight:600;margin:0;white-space:nowrap}h2 span{font-size:10px;margin-left:8px;border:1px solid #d7dece;border-radius:4px;padding:2px 6px;color:#839076}.actions{display:flex;align-items:center;gap:18px}.search{display:flex;align-items:center;gap:10px;background:#fbfcf7;border:1px solid #dce1d4;border-radius:6px;padding:8px 12px;color:#7b896e}.search>span{font-size:21px;line-height:12px}.search input{font-size:11px;width:210px;background:transparent;border:0;outline:0;color:inherit}.clear{font-size:11px;border:0;background:none;color:#596d4c;padding:8px 0}.empty{min-height:340px;border:1px dashed #cfd8c4;border-radius:10px;background:radial-gradient(ellipse at center,#fbfcf6,#f6f7f1);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:38px 20px;text-align:center}.terminal{width:54px;height:45px;border:1px solid #c7d2ba;border-radius:8px;background:#edf2e5;font:30px Consolas,monospace;display:flex;justify-content:center;align-items:center;color:#657e4e;box-shadow:0 3px 0 #e4eadb}.cursor{font-size:22px;margin-top:6px}.empty-label{font-size:9px;letter-spacing:1.8px;color:#8a977b;margin:23px 0 12px}.empty h3{font-size:21px;letter-spacing:-.5px;font-weight:500;margin:0}.empty>p:not(.empty-label){font-size:12px;line-height:1.9;color:#859079;margin:12px 0 23px}.empty>a{font-size:11px;text-decoration:none;border:1px solid #cbd6be;border-radius:5px;padding:10px 15px;color:#536c40;background:#f9fbf4}.empty>a span{margin-left:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}.card{background:#fcfdf9;border:1px solid #d9e0d1;border-radius:9px;padding:22px;min-width:0}.card-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.machine{font-size:11px;overflow-wrap:anywhere;color:#738266}.machine>span{margin-right:4px;color:#8da279}.status{font-size:9px;border:1px solid #d7e3c9;border-radius:20px;padding:5px 8px;background:#edf3e5;color:#597944;white-space:nowrap}.status.attention{color:#8b6424;background:#fcf2d9;border-color:#ead5a5}.card h3{font-size:21px;letter-spacing:-.5px;font-weight:550;overflow-wrap:anywhere;margin:24px 0 7px}.path{font:10px/1.6 Consolas,monospace;color:#8b9780;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}.current{border-top:1px solid #e7ebdf;margin-top:24px;padding-top:17px}.current .eyebrow{font-size:8px;letter-spacing:1px}.current p{font:12px/1.6 Consolas,monospace;margin:9px 0 20px;overflow-wrap:anywhere}.card footer{display:flex;justify-content:space-between;font-size:9px;color:#8c9781;gap:10px}.card footer code{color:#a0a996}.subagent{font-size:10px;color:#758c61;margin:12px 0 0}.subagent span{color:#97a18d}.setup{margin-top:28px;border:1px solid #dce2d4;border-radius:7px;scroll-margin-top:24px}.setup summary{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:17px 20px;cursor:pointer;font-size:12px;color:#617653}.setup summary::-webkit-details-marker{display:none}.setup-icon{margin-right:12px;font-size:16px;color:#8ba36f}.setup-hint{font-size:8px;letter-spacing:1.2px;color:#9aa68d}.setup-body{padding:0 20px 16px;font-size:12px;line-height:1.8;color:#78866c}.setup-body code{font-size:11px}.setup-body pre{background:#eaf0e1;border-radius:5px;padding:14px;overflow:auto;color:#516d3d}.muted{color:#909b84}.page-footer{display:flex;justify-content:space-between;align-items:center;margin:26px 0 32px;font-size:10px;color:#93a086}.page-footer>span:first-child{display:flex;align-items:center;gap:7px}.footer-dot{width:4px;height:4px;background:#9eae8c}.page-footer>span:last-child{font-size:8px;letter-spacing:1.3px}.no-results{padding:65px 20px;text-align:center;border:1px dashed #cfd8c4;border-radius:8px;color:#839076}.no-results h3{font-weight:500;color:#516747}.no-results p{font-size:12px}.no-results button{padding:8px 12px;border:1px solid #cbd6be;border-radius:5px;background:transparent;color:#536c40;font-size:11px}.notice{font-size:12px;color:#89672e;background:#faf1db;border:1px solid #e8d7ad;padding:12px 16px;border-radius:5px}
  @media(max-width:900px){.live-note{display:none}.summary>div{min-width:0;padding-right:24px}.summary>div+div{padding-left:24px}.summary>p{display:none}.summary{justify-content:space-between}.summary>div>span+span{max-width:50px}.search input{width:160px}}
  @media(max-width:600px){.shell{padding:0 6%}.topbar{height:76px}.brand{gap:7px;font-size:10px;letter-spacing:1px}.mark{width:29px;height:29px;font-size:20px}.connection{font-size:10px;padding:7px 9px}main{padding-top:36px}h1{letter-spacing:-1px}.subtitle{font-size:12px;max-width:290px}.summary{margin-top:27px;padding:20px 0}.summary>div{flex-direction:column;align-items:flex-start;gap:5px;padding-right:18px}.summary>div+div{padding-left:18px}.summary>div>span+span{max-width:none;font-size:10px}.metric{font-size:27px}.metric.small{font-size:18px;min-height:32px;display:flex;align-items:center}.activity{margin-top:26px}.toolbar{flex-wrap:wrap;gap:16px}.actions{width:100%;justify-content:space-between}.search{flex:1}.search input{width:100%;min-width:0}.empty{min-height:330px}.setup summary{padding:16px}.setup-hint{display:none}.page-footer>span:last-child{font-size:7px;letter-spacing:.7px}.grid{grid-template-columns:1fr}}
</style>
