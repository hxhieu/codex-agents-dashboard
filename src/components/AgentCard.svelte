<script lang="ts">
  import type { AgentNode } from '../lib/agents';
  import StatusBadge from './StatusBadge.svelte';
  import TokenUsage from './TokenUsage.svelte';

  let { node, now, onremove }: { node: AgentNode; now: number; onremove: (key: string) => void } = $props();
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

{#snippet removeButton(target: AgentNode)}
  <button
    type="button"
    class="remove"
    aria-label={`Remove session ${target.sessionId} on ${target.machine} from this view`}
    title="Remove from this view; the next update brings it back"
    onclick={(event) => { event.preventDefault(); event.stopPropagation(); onremove(target.key); }}
  ><svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg></button>
{/snippet}

{#snippet subagentRow(child: AgentNode)}
  <li>
    <details open>
      <summary>
        <span class="child-name"><span class="chevron" aria-hidden="true">›</span><strong>{child.agent?.agentType || 'Subagent'}</strong><code title={child.sessionId}>{child.sessionId.slice(0, 8)}</code></span>
        <span class="card-actions">{#if child.agent}<StatusBadge status={child.agent.status} />{/if}{@render removeButton(child)}</span>
      </summary>
      {#if child.agent}
        <p class="child-activity">{Object.values(child.agent.tools).join(' · ') || child.agent.latestEvent}</p>
        <TokenUsage usage={child.agent.tokenUsage} compact />
        <div class="child-meta"><span title={child.agent.cwd}>{child.agent.cwd ? project(child.agent.cwd) : 'Project not reported'}</span><time datetime={child.agent.lastSeen} title={new Date(child.agent.lastSeen).toLocaleString()}>Updated {age(child.agent.lastSeen)}</time></div>
      {:else}
        <p class="child-activity">Waiting for this subagent's next update</p>
      {/if}
      {#if child.children.length}
        <ul class="nested">{#each child.children as descendant (descendant.key)}{@render subagentRow(descendant)}{/each}</ul>
      {/if}
    </details>
  </li>
{/snippet}

<article class="card">
  <header class="card-top">
    <span class="machine"><span aria-hidden="true">▣</span> {node.machine}<span class="harness">{node.harnessLabel}</span></span>
    <div class="card-actions">{#if agent}<StatusBadge status={agent.status} />{:else}<span class="unobserved">Parent not observed yet</span>{/if}{@render removeButton(node)}</div>
  </header>
  <h2>{agent ? project(agent.cwd) : 'Parent session'}</h2>
  <p class="path" title={agent?.cwd}>{agent?.cwd || 'Waiting for the next parent update'}</p>
  {#if agent}
    <div class="current"><span class="eyebrow">LATEST OBSERVED ACTIVITY</span><p>{Object.values(agent.tools).join(' · ') || agent.latestEvent}</p></div>
    <TokenUsage usage={agent.tokenUsage} />
  {/if}
  <footer><code title={node.sessionId}>{node.sessionId.slice(0, 12)}</code>{#if agent}<time datetime={agent.lastSeen} title={new Date(agent.lastSeen).toLocaleString()}>Updated {age(agent.lastSeen)}</time>{/if}</footer>
  {#if node.children.length}
    <section class="subagents" aria-label="Subagents">
      <h3>Subagents</h3>
      <ul>{#each node.children as child (child.key)}{@render subagentRow(child)}{/each}</ul>
    </section>
  {/if}
</article>

<style>
  .card { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 18px; }
  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 25px; }
  .machine { min-width: 0; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
  .card-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .remove { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--muted); }
  .remove:hover { background: var(--surface-raised); color: var(--text); border-color: var(--accent-border); }
  .machine > span { margin-right: 4px; color: var(--faint); }
  .machine > .harness { margin: 0 0 0 7px; padding: 2px 5px; border: 1px solid var(--border); border-radius: 4px; font-size: 9px; white-space: nowrap; }
  .unobserved { font-size: 10px; color: var(--faint); }
  h2 { font-size: 21px; letter-spacing: -.5px; font-weight: 550; overflow-wrap: anywhere; margin: 16px 0 5px; }
  .path { font: 10px/1.6 Consolas, monospace; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
  .current { border-top: 1px solid var(--divider); margin-top: 15px; padding-top: 12px; }
  .eyebrow { font-size: 8px; letter-spacing: 1px; color: var(--muted); }
  .current p { font: 12px/1.6 Consolas, monospace; margin: 7px 0 14px; overflow-wrap: anywhere; }
  footer { display: flex; justify-content: space-between; font-size: 10px; color: var(--faint); gap: 10px; }
  footer code { color: var(--faint); }
  .subagents { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 12px; }
  h3 { margin: 0; font-size: 11px; font-weight: 600; color: var(--muted); }
  summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; list-style: none; font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 3px; }
  .chevron { display: inline-block; font-size: 18px; line-height: 1; color: var(--faint); }
  details[open] > summary > .child-name > .chevron { transform: rotate(90deg); }
  ul { list-style: none; padding: 0; margin: 4px 0 0; }
  li { padding: 13px 0 0; }
  li + li { margin-top: 11px; border-top: 1px solid var(--divider); }
  .child-name { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11px; }
  strong { font-weight: 550; overflow-wrap: anywhere; }
  .child-name code { font-size: 9px; color: var(--faint); }
  .child-activity { margin: 7px 0 6px 18px; font: 11px/1.5 Consolas, monospace; overflow-wrap: anywhere; color: var(--muted); }
  .child-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-left: 18px; font-size: 9px; color: var(--faint); }
  .child-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  time { white-space: nowrap; }
  .nested { margin-left: 9px; padding-left: 9px; border-left: 1px solid var(--border); }
  @media (max-width: 420px) { .card { padding: 15px; } .child-meta { flex-wrap: wrap; gap: 4px; } }
</style>
