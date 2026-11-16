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

1. Use the root `hooks.json` if its dashboard address matches your server; it identifies each sending computer by hostname automatically. Alternatively, adapt `examples/hooks.json`: replace `DASHBOARD_HOST` with the dashboard machine's LAN IP or hostname and `my-pc` with a unique name for the sending machine.
2. Merge its hook entries into `~/.codex/hooks.json` on each machine. Preserve existing entries, including handlers for the same event. A project-specific `.codex/hooks.json` also works; install these reporting hooks in only one location to avoid duplicate updates. The root `hooks.json` is a configuration source, not an automatically loaded file.
3. Review and trust the added hooks using `/hooks` in Codex CLI. Restart the CLI if necessary for configuration changes to load.

The example includes Windows and POSIX commands. Reporting uses a one-second network timeout and does not retry failed updates. Background updates can arrive out of order.

Startup reporting runs only for fresh sessions. Resumed sessions appear on their next prompt or tool update; reporting is skipped during resume to avoid the observed CLI startup failure. After updating installed hooks, review changed handlers again using `/hooks`.

Only session and tool metadata is broadcast. Prompt text, command arguments, and tool output are discarded.

## What to expect

- Use the theme toggle in the header to switch between light and dark mode. Your choice is remembered in this browser across refreshes; your system theme is used until you choose one.
- Open the dashboard before sending updates; previous activity is not loaded.
- Refresh or select **Clear view** to clear the current tab. New updates will populate it again.
- Each tab shows up to 200 recent sessions, with parent cards sorted alphabetically by project name. Subagents appear inside their parent's card with their own status, activity, and last update. Use the **Subagents** heading to collapse or expand them.
- A running subagent can appear on its next tool update even if you missed its start event. Subagents that produce no new events after a refresh cannot be recovered from history.
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
