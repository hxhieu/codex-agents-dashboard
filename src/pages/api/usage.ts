import type { APIRoute } from "astro";
import { readCodexWeeklyUsage } from "../../lib/server/codex-usage";

export const GET: APIRoute = async () => Response.json(await readCodexWeeklyUsage(), {
  headers: { "Cache-Control": "no-store" },
});
