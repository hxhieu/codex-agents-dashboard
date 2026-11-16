import type { HookEventName, HookMetadata } from "../../events";

function field(value: unknown, limit = 256): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;
}

/** Read only the metadata shared by Codex and Claude Code hook payloads. */
export function normalizeHookMetadata(
  payload: unknown,
  eventNames: Readonly<Record<string, HookEventName>>,
): HookMetadata {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Expected a JSON object.");
  }
  const input = payload as Record<string, unknown>;
  const sessionId = field(input.session_id);
  const rawEvent = field(input.hook_event_name);
  const eventName = rawEvent && Object.hasOwn(eventNames, rawEvent) ? eventNames[rawEvent] : undefined;
  if (!sessionId) throw new Error("session_id is required.");
  if (!eventName) throw new Error("Unsupported hook_event_name.");
  const agentId = field(input.agent_id);
  if ((eventName === "SubagentStart" || eventName === "SubagentStop") && !agentId) {
    throw new Error("agent_id is required for subagent lifecycle events.");
  }
  return {
    sessionId,
    eventName,
    cwd: field(input.cwd, 2048) ?? "",
    toolName: field(input.tool_name),
    toolUseId: field(input.tool_use_id),
    agentId,
    agentType: field(input.agent_type),
  };
}
