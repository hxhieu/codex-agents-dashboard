<script lang="ts">
  import type { AgentNode } from '../lib/agents';
  import StatusBadge from './StatusBadge.svelte';

  let { node, now }: { node: AgentNode; now: number } = $props();
  const agent = $derived(node.agent);

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
</script>

{#snippet subagentRow(child: AgentNode)}
  <li>
    <div class="child-heading">
      <div class="child-name"><span class="branch" aria-hidden="true">↳</span><strong>{child.agent?.agentType || 'Subagent'}</strong><code title={child.sessionId}>{child.sessionId.slice(0, 8)}</code></div>
      {#if child.agent}<StatusBadge status={child.agent.status} />{/if}
    </div>
    {#if child.agent}
      <p class="child-activity">{Object.values(child.agent.tools).join(' · ') || child.agent.latestEvent}</p>
      <div class="child-meta"><span title={child.agent.cwd}>{child.agent.cwd ? project(child.agent.cwd) : 'Project not reported'}</span><time datetime={child.agent.lastSeen} title={new Date(child.agent.lastSeen).toLocaleString()}>Updated {age(child.agent.lastSeen)}</time></div>
    {:else}
      <p class="child-activity">Waiting for this subagent's next update</p>
    {/if}
    {#if child.children.length}
      <ul class="nested">{#each child.children as descendant (descendant.key)}{@render subagentRow(descendant)}{/each}</ul>
    {/if}
  </li>
{/snippet}

<article class="card">
  <header class="card-top">
    <span class="machine"><span aria-hidden="true">▣</span> {node.machine}</span>
    {#if agent}<StatusBadge status={agent.status} />{:else}<span class="unobserved">Parent not observed yet</span>{/if}
  </header>
  <h2>{agent ? project(agent.cwd) : 'Parent session'}</h2>
  <p class="path" title={agent?.cwd}>{agent?.cwd || 'Waiting for the next parent update'}</p>
  {#if agent}
    <div class="current"><span class="eyebrow">LATEST OBSERVED ACTIVITY</span><p>{Object.values(agent.tools).join(' · ') || agent.latestEvent}</p></div>
  {/if}
  <footer><code title={node.sessionId}>{node.sessionId.slice(0, 12)}</code>{#if agent}<time datetime={agent.lastSeen} title={new Date(agent.lastSeen).toLocaleString()}>Updated {age(agent.lastSeen)}</time>{/if}</footer>
  {#if node.children.length}
    <details class="subagents" open>
      <summary>Subagents <span>{node.children.length}</span></summary>
      <ul>{#each node.children as child (child.key)}{@render subagentRow(child)}{/each}</ul>
    </details>
  {/if}
</article>

<style>
  .card { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 18px; }
  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 25px; }
  .machine { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
  .machine > span { margin-right: 4px; color: var(--faint); }
  .unobserved { font-size: 10px; color: var(--faint); }
  h2 { font-size: 21px; letter-spacing: -.5px; font-weight: 550; overflow-wrap: anywhere; margin: 16px 0 5px; }
  .path { font: 10px/1.6 Consolas, monospace; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
  .current { border-top: 1px solid var(--divider); margin-top: 15px; padding-top: 12px; }
  .eyebrow { font-size: 8px; letter-spacing: 1px; color: var(--muted); }
  .current p { font: 12px/1.6 Consolas, monospace; margin: 7px 0 14px; overflow-wrap: anywhere; }
  footer { display: flex; justify-content: space-between; font-size: 10px; color: var(--faint); gap: 10px; }
  footer code { color: var(--faint); }
  .subagents { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 12px; }
  summary { font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer; }
  summary span { margin-left: 5px; font-size: 10px; color: var(--faint); }
  ul { list-style: none; padding: 0; margin: 4px 0 0; }
  li { padding: 13px 0 0; }
  li + li { margin-top: 11px; border-top: 1px solid var(--divider); }
  .child-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .child-name { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11px; }
  .branch { color: var(--faint); }
  strong { font-weight: 550; overflow-wrap: anywhere; }
  .child-name code { font-size: 9px; color: var(--faint); }
  .child-activity { margin: 7px 0 6px 18px; font: 11px/1.5 Consolas, monospace; overflow-wrap: anywhere; color: var(--muted); }
  .child-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-left: 18px; font-size: 9px; color: var(--faint); }
  .child-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  time { white-space: nowrap; }
  .nested { margin-left: 9px; padding-left: 9px; border-left: 1px solid var(--border); }
  @media (max-width: 420px) { .card { padding: 15px; } .child-meta { flex-wrap: wrap; gap: 4px; } }
</style>
