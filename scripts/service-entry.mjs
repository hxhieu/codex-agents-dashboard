// node-windows sends this message when stopping its supervised process.
if (process.env.DASHBOARD_CODEX_USAGE_DISABLED === "1") {
  delete process.env.CODEX_HOME;
  delete process.env.CODEX_BIN;
}

process.on("message", (message) => {
  if (message === "shutdown") process.exit(0);
});

await import("../dist/server/entry.mjs");
