import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { setTheme } from "../src/lib/theme.ts";

const bootstrap = readFileSync(new URL("../public/theme.js", import.meta.url), "utf8");

function browser(storage, prefersDark = false, blocked = false) {
  const meta = { content: "", setAttribute(_name, value) { this.content = value; } };
  return {
    document: {
      documentElement: { dataset: {}, style: {} },
      querySelector() { return meta; },
    },
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("Storage blocked"); storage.set(key, value); },
    },
    matchMedia() { return { matches: prefersDark }; },
  };
}

function load(window) {
  runInNewContext(bootstrap, { window, document: window.document });
  return window.document.documentElement.dataset.theme;
}

test("a selected theme overrides the system theme and survives a fresh page load", () => {
  const storage = new Map();
  const firstPage = browser(storage);
  assert.equal(load(firstPage), "light");
  setTheme("dark", firstPage);
  assert.equal(firstPage.document.documentElement.dataset.theme, "dark");
  assert.equal(firstPage.document.querySelector().content, "#111813");
  assert.equal(load(browser(storage)), "dark");
  setTheme("light", firstPage);
  const refreshed = browser(storage, true);
  assert.equal(load(refreshed), "light");
  assert.equal(refreshed.document.documentElement.style.colorScheme, "light");
  assert.deepEqual([...storage.keys()], ["codex-dashboard-theme"]);
});

test("startup follows the system theme without a valid saved preference", () => {
  assert.equal(load(browser(new Map(), true)), "dark");
  assert.equal(load(browser(new Map([["codex-dashboard-theme", "invalid"]]), true)), "dark");
});

test("blocked browser storage does not prevent startup or changing theme", () => {
  const page = browser(new Map(), true, true);
  assert.equal(load(page), "dark");
  assert.doesNotThrow(() => setTheme("light", page));
  assert.equal(page.document.documentElement.dataset.theme, "light");
});
