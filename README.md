# Codex Agents Dashboard

A live LAN dashboard built with Astro, Svelte 5, and the standalone Node adapter. Codex hooks POST directly to the server; Server-Sent Events update connected browsers. No database, collector, event history, cookies, or browser storage. Astro session storage is disabled.

## Run

Use the existing nvm-windows installation and pnpm:

```powershell
nvm use 24.13.0
pnpm install
pnpm dev
```

Open **http://localhost:4321**. The development server listens on all interfaces so other LAN machines can post to `http://<this-machine-ip>:4321/api/events`. Windows Firewall must allow the chosen port for LAN access. This scaffold is intended for a trusted private LAN and does not add authentication.

## Try an update

Open the dashboard first, then run from this project directory:

```powershell
curl.exe --silent --show-error --max-time 2 -H "Content-Type: application/json" -H "X-Machine: my-pc" --data-binary "@examples/event.json" http://localhost:4321/api/events
```

An empty HTTP 204 response means the event was accepted. An agent card should appear in every connected dashboard. Refreshing the browser clears its cards until new updates arrive.

## Connect Codex CLI hooks

1. Adapt `examples/hooks.json`: replace `DASHBOARD_HOST` with this machine's LAN IP or hostname and `my-pc` with a unique name for the sending machine. Use the same machine name for every hook on that computer.
2. Merge its hook entries into `~/.codex/hooks.json` on each machine. Preserve existing entries, including handlers for the same event. A project-specific `.codex/hooks.json` also works.
3. Review and trust the added hooks using `/hooks` in Codex CLI. Restart the CLI if necessary for configuration changes to load.

The example provides both POSIX and Windows command variants. Each invocation forwards the JSON supplied on stdin directly through curl, discards the response body, caps network time at one second, and ignores transport failure. It uses background hooks except `SessionEnd` (which Codex runs synchronously). It has no retry queue. Background updates can arrive out of order; this is a view of the latest observed events, not a reliable audit log.

Only whitelisted metadata is broadcast: machine, session, event, working directory, tool name/call ID, and subagent identity. Prompt text, command arguments, and tool output are discarded. The request body limit is 1 MiB; larger hook payloads are dropped with HTTP 413.

## Behavior

- `POST /api/events`: receives hook JSON with an `X-Machine` header; returns 204, 400 for invalid events, 413 for oversized bodies, or 415 for an unsupported content type.
- `GET /api/stream`: live SSE stream, with no replay. A 15-second comment keeps the browser connection alive; this is not an agent heartbeat.
- Sessions are keyed by machine and session ID. Subagent start/stop events use their agent ID and retain the parent session ID.
- Cards display the latest observed activity and time since its arrival. Silence does not imply idle or offline. Parallel tool calls are tracked by call ID when provided.
- All session state lives in the current browser tab (up to 200 recent sessions). Refresh and **Clear view** reset that tab. The server retains only live subscriber connections, drops updates without listeners, and disconnects slow consumers instead of growing a history buffer.
- After a connection gap, the browser reconnects automatically and keeps its existing cards; missed updates are not recovered.
- Run a single server process. Multiple independent processes would have separate subscriber sets.

## Check and build

```powershell
pnpm check
pnpm build
pnpm test
```

Tests exercise the built Node server, including live fanout, validation, metadata filtering, and no replay, plus concurrent tool and subagent state transitions. Build before running them.

Run the production build on the LAN:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "4321"
pnpm start
```

`src/pages/api/` contains the two HTTP endpoints, `src/lib/server/broadcast.ts` handles live fanout, and `src/components/Dashboard.svelte` renders the dashboard. `.nvmrc` records Node 24.13.0; nvm-windows still requires explicit `nvm use`.
