export const hookEvents = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "Interrupt",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PreModelRequest",
  "PostModelRequest",
] as const;

export type HookEventName = (typeof hookEvents)[number];

export interface AgentEvent {
  id: string;
  machine: string;
  sessionId: string;
  eventName: HookEventName;
  receivedAt: string;
  cwd: string;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  agentType?: string;
}

function field(value: unknown, limit = 256): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;
}

/** Whitelist metadata; never forward prompts, commands, or tool output. */
export function normalizeEvent(
  payload: unknown,
  machine: string | null,
): AgentEvent {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Expected a JSON object.");
  }
  const input = payload as Record<string, unknown>;
  const sessionId = field(input.session_id);
  const eventName = field(input.hook_event_name);
  const machineName = field(machine, 128);
  if (!machineName) throw new Error("The X-Machine header is required.");
  if (!sessionId) throw new Error("session_id is required.");
  if (!hookEvents.includes(eventName as HookEventName)) {
    throw new Error("Unsupported hook_event_name.");
  }
  return {
    id: crypto.randomUUID(),
    machine: machineName,
    sessionId,
    eventName: eventName as HookEventName,
    receivedAt: new Date().toISOString(),
    cwd: field(input.cwd, 2048) ?? "",
    toolName: field(input.tool_name),
    toolUseId: field(input.tool_use_id),
    agentId: field(input.agent_id),
    agentType: field(input.agent_type),
  };
}
