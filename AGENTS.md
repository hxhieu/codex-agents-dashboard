# Repository Guidelines

Keep `README.md` focused on user setup and operation. Put implementation, contributor, and agent instructions here.

## Project Structure & Module Organization

- `src/pages/index.astro` hosts `src/components/Dashboard.svelte` (Svelte 5).
- `AgentCard.svelte` renders parent cards and nested subagents; `StatusBadge.svelte` shares status styling and attention pulses. `groupAgents` in `src/lib/agents.ts` builds machine-scoped trees, retaining missing parents and filtered descendants.
- `src/pages/api/` contains HTTP endpoints; `src/lib/` holds event validation and browser state; `src/lib/server/broadcast.ts` manages SSE subscribers.
- `android/` builds a standalone debug APK with the existing Astro/Svelte page and a native foreground-only HTTP receiver. Bundle the shared TypeScript harness adapters for the embedded Rhino interpreter. Bind ingestion to the Wi-Fi IPv4 address and WebView content to loopback. Put only normalized live events on SSE and close both listeners when the activity stops. The app targets API 37 and requests local-network permission there. Keep generated files and debug signing material ignored.
- `hooks/codex.json` and `hooks/claude-code.json` provide harness configurations. `src/lib/server/harnesses/index.ts` routes `X-Harness` to predefined adapters; each maps raw event names into shared `AgentEvent` fields using the metadata whitelist in `shared.ts`. Add future adapters here; never infer the harness from tool names or prompts.
- `tests/` contains behavioral tests, `public/` static assets, and `examples/` sample events/hooks.
- `scripts/windows-service.mjs` manages `node-windows`; `service-entry.mjs` imports the standalone build and handles its IPC shutdown message. `service:install` creates or overwrites the current install using password-free LocalService (SID `S-1-5-19`), preserving its port and registration; stop before updating its generated WinSW definition and leave manual/stopped until activation. `configure-local-service.ps1` grants read/execute only to the pinned Node executable and app runtime, and modify only to operational logs; never grant profile/Codex-home access or save passwords. Reapply runtime permissions before starting after a rebuild. Keep generated settings/logs in ignored `.windows-service/`. Remove the old task only after HTTP health succeeds; restore it on migration failure.
- Do not hand-edit generated `dist/`, `.astro/`, or `node_modules/`.

## Build, Test, and Development Commands

Use Node **24.13.0** through nvm-windows and **pnpm 10.21.0**. `.nvmrc` records Node; run `nvm use 24.13.0` explicitly.

- `pnpm install`: install locked dependencies.
- `pnpm dev`: serve on port 4321; reuse an existing project server.
- `pnpm check`: run Astro/TypeScript and Svelte diagnostics.
- `pnpm build`: build the standalone Node server.
- `pnpm test`: test the built server; build first.
- `pnpm start`: run production; configure `HOST`/`PORT` as needed.
- `.\android\build.ps1`: build the debug APK with JDK 17, SDK Platform 37.0, and Build Tools 37.0.0. Check a real LAN POST, live rendering inside the WebView, and receiver shutdown when the activity stops.
- `pnpm service:install`, `service:start`, `service:stop`, `service:uninstall`: manage the Windows service from an administrator terminal; `service:status` is read-only. Installation also updates an existing service; no password is required for LocalService.

## Coding Style & Naming Conventions

Use two-space indentation, TypeScript ES modules, explicit event types, and Svelte 5 reactivity. Match surrounding quotes and semicolons. Use PascalCase components and camelCase functions/variables. Keep handlers thin. No formatter or linter is configured.

## Testing Guidelines

Use `node:test` and `node:assert/strict` in `tests/*.test.mjs`. Describe observable behavior in titles. Cover validation, metadata filtering, live fanout/no replay, parallel tools, and subagent identity. No coverage threshold is configured. Check responsive layouts and refresh behavior for UI changes.

Windows PowerShell children must use a clean built-in `PSModulePath`; PowerShell 7 paths inherited through Node can break module autoloading. Exercise real `Get-Acl`/`Set-Acl` calls through Node in installer tests; direct shell launches and `-WhatIf` do not cover this failure.

## Commit & Pull Request Guidelines

Initial history contains only `init commit`; no convention is established. Use imperative subjects, e.g. `Handle interrupted tool calls`. PRs should explain changes, link relevant issues, report validation results/limitations, and include screenshots for visual changes.

## Event Contract & Runtime Behavior

- `POST /api/events` requires hook JSON and `X-Machine`; `X-Harness` selects `codex` or `claude-code`. Missing harness headers default to Codex for existing installed hooks; empty/unknown values return 400. Other responses: 204 accepted, 400 invalid event, 413 above 1 MiB, 415 unsupported content type.
- `GET /api/stream` sends live SSE without replay; 15-second keepalive comments indicate browser connectivity, not agent health.
- `GET /api/usage` reads only the dashboard machine's Codex weekly quota via an on-demand, short-lived `codex --disable hooks app-server --stdio` process. Initialize, read `account/rateLimits/read`, then terminate; never start or resume a thread. Match the Codex bucket's 10080-minute window in either slot. Return only remaining percentage, reset/check times, and availability; do not expose auth, raw RPC errors, credits or account identity. No caching or usage history; the browser refreshes every minute. `CODEX_BIN` optionally selects the executable.
- LocalService mode sends `DASHBOARD_CODEX_USAGE_DISABLED=1`, strips user Codex paths, and returns unavailable from `/api/usage` without launching Codex. Hook-supplied agent/token metadata is unaffected.
- Key sessions and parent relationships by harness/machine/session ID; route every hook carrying a child `agent_id` to that subagent, retaining its parent session. Do not limit child routing to start/stop events. Track parallel tools by call ID.
- Keep only live subscriber connections server-side; disconnect slow consumers. Browser state is capped at 200 sessions.
- Model-request hooks update token metadata without changing an existing session's status or latest activity. Late unmatched tool completions must not reopen stopped/idle sessions; a new prompt or tool start resumes activity.
- Codex async questions remain pending after their immediate tool acknowledgement, unrelated activity, and `Stop`. Clear them on `UserPromptSubmit`, interruption, or session/subagent end. Blocking questions clear when their tool returns.
- `hooks/session-tokens.mjs` is a standalone Node filter installed on sending machines before curl. It sends only metadata and `session_token_usage` snapshots (counts plus observation time), never transcripts or their paths. Codex reads `total_token_usage`, not `last_token_usage`/per-request `token_usage`; Claude deduplicates assistant message IDs across the session and includes cache reads/writes in input. Do not add child totals to parent totals. Bound reads; missing data remains unknown. Preserve the newest observation per browser agent when background hooks reorder.
- Cards display `inputTokens - cachedInputTokens + outputTokens` as **Tokens used**, with two decimal places in compact notation. Keep raw inclusive totals in the event contract and tooltip; missing breakdowns remain unknown rather than displaying cached tokens as used tokens.
- Codex `commandWindows` must work when launched by PowerShell as well as cmd. Use the Node bootstrap plus the helper's `sendHook` argv-based curl launch; nested `cmd /c` strings containing quoted helper paths fail through PowerShell. Verify Windows PowerShell, PowerShell 7, and cmd with paths containing spaces.
- The Codex and Claude Code templates in `hooks/` read the full event endpoint from `CODEX_DASHBOARD_URL`. Skip the send when the variable is unset or empty.
- Hook configurations send their harness header, forward stdin via curl, discard responses, ignore transport failures, and time out after one second. Preserve Codex's `SessionStart` matcher `^startup$` to avoid the observed resume failure; Claude reports all session starts. Claude settings use Bash `command` hooks, not Codex's `commandWindows` field. Background delivery can reorder events; `SessionEnd` is synchronous.
- Claude `PostToolUseFailure`/`PermissionDenied` map to tool completion; `StopFailure` maps to interruption. Recognize `AskUserQuestion` as a pending user question, including during unrelated parallel tool updates.

## Architecture & Security

Preserve direct hooks, one server process, browser-only agent state, and no agent-history persistence. The theme preference is the only value saved in localStorage. Apply it before rendering through `public/theme.js`; share palette variables in `src/styles/theme.css`. Keep Astro session storage disabled. Whitelist registered harness identity, machine/session/event, directory, tool/call ID, and subagent metadata; discard prompts, commands, and outputs. Keep credentials out of source, preserve existing hooks when merging, and restrict the unauthenticated server to trusted LANs.
