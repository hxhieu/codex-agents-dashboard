import type { AgentEvent } from "../events";

type Listener = (frame: string) => void;
// Share only live connections across route modules and development reloads.
const shared = globalThis as typeof globalThis & {
  __codexListeners?: Set<Listener>;
};
const listeners = (shared.__codexListeners ??= new Set<Listener>());
const encoder = new TextEncoder();

export function broadcast(event: AgentEvent): void {
  const frame = `event: agent\ndata: ${JSON.stringify(event)}\n\n`;
  for (const listener of listeners) listener(frame);
}

export function eventStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  let dispose = () => {};
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        let timer: ReturnType<typeof setInterval>;
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          listeners.delete(send);
          signal.removeEventListener("abort", close);
          try {
            controller.close();
          } catch {
            /* Already cancelled by the browser. */
          }
        };
        const send: Listener = (frame) => {
          if (closed) return;
          // Disconnect slow consumers instead of accumulating event history.
          if ((controller.desiredSize ?? 0) <= 0) {
            close();
            return;
          }
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            close();
          }
        };
        dispose = close;
        listeners.add(send);
        timer = setInterval(() => send(": keepalive\n\n"), 15_000);
        signal.addEventListener("abort", close, { once: true });
        send(": connected\n\n");
        if (signal.aborted) close();
      },
      cancel() {
        dispose();
      },
    },
    { highWaterMark: 32 },
  );
}
