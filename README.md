# Codex Agents Dashboard

A live dashboard for Codex CLI sessions across your local network. See each session's machine, project, latest reported activity, and last update. No database or collector is needed, and activity is not saved.

## Run

Use Node **24.13.0** through nvm-windows and **pnpm 10.21.0**:

```powershell
nvm use 24.13.0
pnpm install
pnpm dev
```

Open **http://localhost:4321**. Other LAN machines can send updates to `http://<this-machine-ip>:4321/api/events`. Windows Firewall must allow port 4321 for LAN access. Use this dashboard only on a trusted private LAN; it has no authentication.

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

The example includes Windows and POSIX commands. Reporting uses a one-second network timeout and does not retry failed updates. Background updates can arrive out of order.

Only session and tool metadata is broadcast. Prompt text, command arguments, and tool output are discarded.

## What to expect

- Open the dashboard before sending updates; previous activity is not loaded.
- Refresh or select **Clear view** to clear the current tab. New updates will populate it again.
- Each tab shows up to 200 recent sessions. Subagents are labeled with their parent session.
- Cards show the latest reported activity. Silence does not mean a session is idle or offline.
- After a connection gap, the dashboard reconnects automatically and keeps existing cards. Missed updates are not recovered.

## Run a production build

Build the dashboard and start it on your LAN:

```powershell
pnpm build
$env:HOST = "0.0.0.0"
$env:PORT = "4321"
pnpm start
```

Run one server instance for all connected dashboards.
