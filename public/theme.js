// Run in the document head before the dashboard paints.
(() => {
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    const saved = window.localStorage.getItem('codex-dashboard-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch { /* Keep the system theme when browser storage is unavailable. */ }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111813' : '#f4f5ef');
})();
