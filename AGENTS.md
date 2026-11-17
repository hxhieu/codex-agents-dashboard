# Repository Guidelines

Keep `README.md` focused on user setup and operation. Put implementation, contributor, and agent instructions here.

## Project Structure & Module Organization

- `src/pages/index.astro` hosts `src/components/Dashboard.svelte` (Svelte 5).
- `AgentCard.svelte` renders parent cards and nested subagents; `StatusBadge.svelte` shares status styling and attention pulses. `groupAgents` in `src/lib/agents.ts` builds machine-scoped trees, retaining missing parents and filtered descendants.
- `src/pages/api/` contains HTTP endpoints; `src/lib/` holds event validation and browser state; `src/lib/server/broadcast.ts` manages SSE subscribers.
- `hooks/codex.json` and `hooks/claude-code.json` provide harness configurations. `src/lib/server/harnesses/index.ts` routes `X-Harness` to predefined adapters; each maps raw event names into shared `AgentEvent` fields using the metadata whitelist in `shared.ts`. Add future adapters here; never infer the harness from tool names or prompts.
- `tests/` contains behavioral tests, `public/` static assets, and `examples/` sample events/hooks.
- Do not hand-edit generated `dist/`, `.astro/`, or `node_modules/`.

## Build, Test, and Development Commands

Use Node **24.13.0** through nvm-windows and **pnpm 10.21.0**. `.nvmrc` records Node; run `nvm use 24.13.0` explicitly.

- `pnpm install`: install locked dependencies.
- `pnpm dev`: serve on port 4321; reuse an existing project server.
- `pnpm check`: run Astro/TypeScript and Svelte diagnostics.
- `pnpm build`: build the standalone Node server.
- `pnpm test`: test the built server; build first.
- `pnpm start`: run production; configure `HOST`/`PORT` as needed.

## Coding Style & Naming Conventions

Use two-space indentation, TypeScript ES modules, explicit event types, and Svelte 5 reactivity. Match surrounding quotes and semicolons. Use PascalCase components and camelCase functions/variables. Keep handlers thin. No formatter or linter is configured.

## Testing Guidelines

Use `node:test` and `node:assert/strict` in `tests/*.test.mjs`. Describe observable behavior in titles. Cover validation, metadata filtering, live fanout/no replay, parallel tools, and subagent identity. No coverage threshold is configured. Check responsive layouts and refresh behavior for UI changes.

## Commit & Pull Request Guidelines

Initial history contains only `init commit`; no convention is established. Use imperative subjects, e.g. `Handle interrupted tool calls`. PRs should explain changes, link relevant issues, report validation results/limitations, and include screenshots for visual changes.

## Event Contract & Runtime Behavior

- `POST /api/events` requires hook JSON and `X-Machine`; `X-Harness` selects `codex` or `claude-code`. Missing harness headers default to Codex for existing installed hooks; empty/unknown values return 400. Other responses: 204 accepted, 400 invalid event, 413 above 1 MiB, 415 unsupported content type.
- `GET /api/stream` sends live SSE without replay; 15-second keepalive comments indicate browser connectivity, not agent health.
- `GET /api/usage` reads only the dashboard machine's Codex weekly quota via an on-demand, short-lived `codex --disable hooks app-server --stdio` process. Initialize, read `account/rateLimits/read`, then terminate; never start or resume a thread. Match the Codex bucket's 10080-minute window in either slot. Return only remaining percentage, reset/check times, and availability; do not expose auth, raw RPC errors, credits or account identity. No caching or usage history; the browser refreshes every minute. `CODEX_BIN` optionally selects the executable.
- Key sessions and parent relationships by harness/machine/session ID; route every hook carrying a child `agent_id` to that subagent, retaining its parent session. Do not limit child routing to start/stop events. Track parallel tools by call ID.
- Keep only live subscriber connections server-side; disconnect slow consumers. Browser state is capped at 200 sessions.
- Hook configurations send their harness header, forward stdin via curl, discard responses, ignore transport failures, and time out after one second. Preserve Codex's `SessionStart` matcher `^startup$` to avoid the observed resume failure; Claude reports all session starts. Claude settings use Bash `command` hooks, not Codex's `commandWindows` field. Background delivery can reorder events; `SessionEnd` is synchronous.
- Claude `PostToolUseFailure`/`PermissionDenied` map to tool completion; `StopFailure` maps to interruption. Recognize `AskUserQuestion` as a pending user question, including during unrelated parallel tool updates.

## Architecture & Security

Preserve direct hooks, one server process, browser-only agent state, and no agent-history persistence. The theme preference is the only value saved in localStorage. Apply it before rendering through `public/theme.js`; share palette variables in `src/styles/theme.css`. Keep Astro session storage disabled. Whitelist registered harness identity, machine/session/event, directory, tool/call ID, and subagent metadata; discard prompts, commands, and outputs. Keep credentials out of source, preserve existing hooks when merging, and restrict the unauthenticated server to trusted LANs.
