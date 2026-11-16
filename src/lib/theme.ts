export type Theme = "light" | "dark";

export function setTheme(theme: Theme, browser: Window = window): void {
  const root = browser.document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  browser.document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#111813" : "#f4f5ef",
  );
  try {
    browser.localStorage.setItem("codex-dashboard-theme", theme);
  } catch { /* Theme changes still work when browser storage is unavailable. */ }
}
