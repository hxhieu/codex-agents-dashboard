<script lang="ts">
  import { onMount } from 'svelte';
  import { setTheme, type Theme } from '../lib/theme';

  let theme = $state<Theme>('light');
  onMount(() => { theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; });
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
  }
</script>

<button type="button" aria-label="Dark mode" aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onclick={toggleTheme}>
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if theme === 'dark'}
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    {:else}
      <path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z" />
    {/if}
  </svg>
  <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
</button>

<style>
  button { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--surface-raised); font-size: 11px; line-height: 15px; white-space: nowrap; }
  button:hover { border-color: var(--accent-border); color: var(--text); }
  @media (max-width: 600px) { button { padding: 7px; } span { display: none; } }
</style>
