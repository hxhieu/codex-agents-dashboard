# Codex Agents Dashboard

A live dashboard for Codex CLI and Claude Code sessions across your local network. See each session's harness, machine, project, latest reported activity, and last update. No database or collector is needed, and activity is not saved.

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
curl.exe --silent --show-error --max-time 2 -H "Content-Type: application/json" -H "X-Machine: my-pc" -H "X-Harness: codex" --data-binary "@examples/event.json" http://localhost:4321/api/events
```

An empty HTTP 204 response means the event was accepted. An agent card should appear in every connected dashboard. Refreshing the browser clears its cards until new updates arrive.

## Connect Codex CLI hooks

1. Use `hooks/codex.json` if its dashboard address matches your server; it identifies each sending computer by hostname automatically and sends `X-Harness: codex`. Alternatively, adapt `examples/hooks.json`: replace `DASHBOARD_HOST` with the dashboard machine's LAN IP or hostname and `my-pc` with a unique name for the sending machine.
2. Install Node on each sending machine and copy `hooks/session-tokens.mjs` to `~/.codex/session-tokens.mjs` (or your `CODEX_HOME`). Both command variants respect `CODEX_HOME`. On Windows, the Node bootstrap loads the helper and launches curl directly, so the command works through PowerShell and cmd.
3. Merge its hook entries into `~/.codex/hooks.json` on each machine. Preserve existing entries, including handlers for the same event. A project-specific `.codex/hooks.json` also works; install these reporting hooks in only one location to avoid duplicate updates. `hooks/codex.json` is a configuration source, not an automatically loaded file.
4. Review and trust the added hooks using `/hooks` in Codex CLI. Restart the CLI if necessary for configuration changes to load.

The example includes Windows and POSIX commands. Reporting uses a one-second network timeout and does not retry failed updates. Background updates can arrive out of order.

Startup reporting runs only for fresh sessions. Resumed sessions appear on their next prompt or tool update; reporting is skipped during resume to avoid the observed CLI startup failure. After updating installed hooks, review changed handlers again using `/hooks`.

Only session and tool metadata is broadcast. Prompt text, command arguments, and tool output are discarded.

## Connect Claude Code hooks

1. Use `hooks/claude-code.json`. Replace `192.168.0.177:4321` if your dashboard address differs. It sends `X-Harness: claude-code` and identifies the sending computer by hostname.
2. Install Node and copy `hooks/session-tokens.mjs` to `~/.claude/session-tokens.mjs` (or your `CLAUDE_CONFIG_DIR`). Merge its `hooks` entries into `~/.claude/settings.json` for all projects, or `.claude/settings.json` for one project. Preserve existing settings and handlers; install the reporters in only one location. The file in this repository is a configuration source and is not loaded automatically.
3. These command hooks use Node, Bash and curl. On Windows, install Git Bash. Check the reporters in Claude Code's `/hooks` menu and restart the session after updating settings.

Claude reporting includes session start/resume/end, prompts, tools, approvals, subagents, and compaction. `AskUserQuestion` shows as awaiting an answer; failed or denied tools clear their active call, and a turn ending in an API error shows as interrupted. Commands discard responses, ignore transport failures, and stop networking after one second. Session-end reporting is synchronous; background delivery can reorder other updates.

Supported harness headers are `codex` and `claude-code`. Older hooks without `X-Harness` still work as Codex; unsupported values return HTTP 400. Cards display the harness name alongside the machine.

## What to expect

- Use the theme toggle in the header to switch between light and dark mode. Your choice is remembered in this browser across refreshes; your system theme is used until you choose one.
- **Codex weekly left**, before **Last update**, shows the weekly quota remaining when the server runs as a user signed in to Codex on the dashboard machine. It refreshes every minute; hover for the reset time and last check. If the CLI is outside the server's PATH, set `CODEX_BIN` to its executable path before starting the dashboard. `—` means unavailable; the password-free Local Service mode intentionally disables this metric because it has no user Codex login. This metric is independent of LAN agent cards and does not combine other accounts or Claude usage.
- The browser tab shows an amber pip and a waiting count when sessions or subagents are awaiting a prompt, answer, or approval. The indicator includes sessions hidden by the search filter and clears when none are waiting or you clear the view.
- Open the dashboard before sending updates; previous activity is not loaded.
- Refresh or select **Clear view** to clear the current tab. New updates will populate it again.
- Use the **×** button on a session or subagent to remove it from this tab, along with its nested subagents. The next update can bring it back fresh; this does not stop the actual agent.
- Each tab shows up to 200 recent sessions, with parent cards sorted alphabetically by project name. Subagents appear inside their parent's card with their own status, activity, and last update. Select each subagent's header to expand or collapse its details; its status stays visible.
- **Tokens used** shows cumulative **uncached input + output** for each session. Hover for the exact used count, raw total, input/output/cache breakdown and observation time. Codex uses its reported session counters; Claude combines distinct assistant requests. Parent counts do not add child rows again. `—` means the required breakdown has not arrived; update the installed hooks and copy the helper to enable reporting. Counts refresh on subsequent hooks, so logs that have not flushed yet can lag. No prompt text or session log is sent to the dashboard.
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

## Run as a Windows service

The dashboard uses `node-windows` for a native background service with no terminal window. It runs as **NT AUTHORITY\LocalService**, a built-in account that needs no password. Windows starts the service automatically, including before sign-in, and the wrapper restarts failed Node processes. Administrator access is needed once to install or change its configuration; no Windows account password is requested.

1. Open PowerShell **as administrator under your usual Windows account**. From this project directory, run:

   ```powershell
   nvm use 24.13.0
   pnpm install
   pnpm build
   pnpm service:install
   pnpm service:start
   ```

2. Open **http://localhost:4321**. After the dashboard responds, automatic startup is enabled. If the previous dashboard scheduled task exists, it is stopped during migration and removed only after the service responds. A failed migration restores that task. Other servers are not stopped; stop `pnpm dev` or `pnpm start` yourself if they occupy port 4321.

Setup grants Local Service read/execute access to the pinned Node executable and dashboard runtime files, plus write access to its operational log folder. It does not grant access to your private profile or Codex credentials. Agent cards, subagents, and session token totals work normally. **Codex weekly left** shows `—` in this mode.

The same installer overwrites an existing installation, including converting a user-account service to password-free Local Service. From administrator PowerShell:

```powershell
pnpm service:stop
pnpm build
pnpm service:install
pnpm service:start
```

Installation preserves the existing port and service registration, refreshes its configuration and runtime permissions, and leaves it stopped until `service:start`. No separate conversion command, uninstall, or password entry is needed.

Manage it in Windows Services or from an administrator terminal:

```powershell
pnpm service:status
pnpm service:stop
pnpm service:start
pnpm service:uninstall
```

For updates, stop the service, run `pnpm build`, then start it again. Startup reapplies runtime permissions after a rebuild. Keep this project folder, its dependencies, and Node 24.13.0 installed on a local disk. The service pins the actual nvm executable, so changing your terminal's Node version does not affect it. Rerun the installer after changing that executable. Uninstall before moving the project, then install at the new location. Machine-specific settings and bounded operational logs live in `.windows-service/`, which is excluded from Git; agent activity is not saved. Service management requires an administrator terminal; `service:status` can also run without elevation.
