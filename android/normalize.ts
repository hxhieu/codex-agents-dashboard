import { normalizeEvent } from '../src/lib/server/harnesses/index';

export function normalize(body: string, machine: string | null, harness: string | null, id: string): [number, string] {
  try {
    return [204, JSON.stringify(normalizeEvent(JSON.parse(body), machine, harness, () => id))];
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Invalid event.';
    return [400, JSON.stringify({ error: message })];
  }
}
