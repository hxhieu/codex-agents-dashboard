import type { AgentEvent, HookMetadata } from "../../events";
import { normalizeCodexEvent } from "./codex.ts";
import { normalizeClaudeCodeEvent } from "./claude-code.ts";

interface HarnessMapping {
  label: string;
  normalize: (payload: unknown) => HookMetadata;
}

// Register each supported harness explicitly; never infer it from payload content.
const harnessMappings: Readonly<Record<string, HarnessMapping>> = {
  codex: { label: "Codex", normalize: normalizeCodexEvent },
  "claude-code": { label: "Claude Code", normalize: normalizeClaudeCodeEvent },
};

export function normalizeEvent(
  payload: unknown,
  machine: string | null,
  harnessHeader: string | null = null,
  createId: () => string = () => crypto.randomUUID(),
): AgentEvent {
  // Existing installed hooks remain usable until their header is updated.
  const harness = harnessHeader === null ? "codex" : harnessHeader.trim().toLowerCase();
  if (!Object.hasOwn(harnessMappings, harness)) throw new Error("Unsupported X-Harness.");
  const mapping = harnessMappings[harness];
  const machineName = machine?.trim().slice(0, 128);
  if (!machineName) throw new Error("The X-Machine header is required.");
  return {
    ...mapping.normalize(payload),
    id: createId(),
    harness,
    harnessLabel: mapping.label,
    machine: machineName,
    receivedAt: new Date().toISOString(),
  };
}
