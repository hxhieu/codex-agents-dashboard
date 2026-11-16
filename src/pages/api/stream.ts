import type { APIRoute } from "astro";
import { eventStream } from "../../lib/server/broadcast";

export const GET: APIRoute = ({ request }) =>
  new Response(eventStream(request.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
