// node-windows sends this message when stopping its supervised process.
process.on("message", (message) => {
  if (message === "shutdown") process.exit(0);
});

await import("../dist/server/entry.mjs");
