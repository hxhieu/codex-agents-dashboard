# Repository Guidelines

Keep `README.md` focused on user setup and operation. Put implementation, contributor, and agent instructions here.

## Project Structure & Module Organization

- `src/pages/index.astro` hosts `src/components/Dashboard.svelte` (Svelte 5).
- `AgentCard.svelte` renders parent cards and nested subagents; `StatusBadge.svelte` shares status styling and attention pulses. `groupAgents` in `src/lib/agents.ts` builds machine-scoped trees, retaining missing parents and filtered descendants.
- `src/pages/api/` contains HTTP endpoints; `src/lib/` holds event validation and browser state; `src/lib/server/broadcast.ts` manages SSE subscribers.
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

- `POST /api/events` requires hook JSON and `X-Machine`; returns 204, 400 for invalid events, 413 above 1 MiB, or 415 for unsupported content types.
- `GET /api/stream` sends live SSE without replay; 15-second keepalive comments indicate browser connectivity, not agent health.
- Key sessions by machine/session ID; use agent ID for subagents and retain their parent. Track parallel tools by call ID.
- Keep only live subscriber connections server-side; disconnect slow consumers. Browser state is capped at 200 sessions.
- Example hooks forward stdin via curl, discard responses, ignore transport failures, and time out after one second. Background delivery can reorder events; `SessionEnd` is synchronous.

## Architecture & Security

Preserve direct hooks, one server process, browser-only agent state, and no agent-history persistence. The theme preference is the only value saved in localStorage. Apply it before rendering through `public/theme.js`; share palette variables in `src/styles/theme.css`. Keep Astro session storage disabled. Whitelist machine/session/event, directory, tool/call ID, and subagent metadata; discard prompts, commands, and outputs. Keep credentials out of source, preserve existing hooks when merging, and restrict the unauthenticated server to trusted LANs.
