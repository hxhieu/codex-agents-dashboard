import type { APIRoute } from "astro";
import { normalizeEvent } from "../../lib/events";
import { broadcast } from "../../lib/server/broadcast";

const MAX_BYTES = 1024 * 1024;

export const POST: APIRoute = async ({ request }) => {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json(
      { error: "Use Content-Type: application/json." },
      { status: 415 },
    );
  }
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json(
      { error: "A JSON body is required." },
      { status: 400 },
    );
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Body exceeds 1 MiB." }, { status: 413 });
      }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    broadcast(normalizeEvent(payload, request.headers.get("x-machine")));
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof SyntaxError
            ? "Invalid JSON."
            : error instanceof Error
              ? error.message
              : "Invalid event.",
      },
      { status: 400 },
    );
  } finally {
    reader.releaseLock();
  }
};
