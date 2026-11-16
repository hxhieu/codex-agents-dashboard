import type { AgentEvent } from "./events";

export interface Agent {
  key: string;
  machine: string;
  sessionId: string;
  parentSessionId?: string;
  agentType?: string;
  cwd: string;
  status: string;
  lastSeen: string;
  latestEvent: string;
  tools: Record<string, string>;
  updates: number;
}

export function applyEvent(agents: Agent[], event: AgentEvent): Agent[] {
  const isSubagent =
    event.eventName === "SubagentStart" || event.eventName === "SubagentStop";
  const sessionId =
    isSubagent && event.agentId ? event.agentId : event.sessionId;
  const key = JSON.stringify([event.machine, sessionId]);
  const previous = agents.find((agent) => agent.key === key);
  const tools = { ...previous?.tools };
  let status = "Working";
  switch (event.eventName) {
    case "SessionStart":
      status = "Session started";
      break;
    case "UserPromptSubmit":
      status = "Working";
      break;
    case "PreToolUse":
      tools[event.toolUseId ?? event.toolName ?? "tool"] =
        event.toolName ?? "Tool";
      status = "Using tools";
      break;
    case "PostToolUse":
      delete tools[event.toolUseId ?? event.toolName ?? "tool"];
      status = Object.keys(tools).length ? "Using tools" : "Working";
      break;
    case "PermissionRequest":
      status = "Approval requested";
      break;
    case "Stop":
      status = "Awaiting prompt";
      break;
    case "SessionEnd":
      status = "Session ended";
      break;
    case "Interrupt":
      status = "Interrupted";
      break;
    case "SubagentStart":
      status = "Working";
      break;
    case "SubagentStop":
      status = "Subagent stopped";
      break;
    case "PreCompact":
      status = "Compacting";
      break;
    case "PostCompact":
      status = "Working";
      break;
  }
  if (
    [
      "Stop",
      "SessionEnd",
      "Interrupt",
      "SubagentStop",
      "UserPromptSubmit",
    ].includes(event.eventName)
  ) {
    for (const id of Object.keys(tools)) delete tools[id];
  }
  const next: Agent = {
    key,
    machine: event.machine,
    sessionId,
    parentSessionId: isSubagent ? event.sessionId : previous?.parentSessionId,
    agentType: event.agentType ?? previous?.agentType,
    cwd: event.cwd || previous?.cwd || "",
    status,
    lastSeen: event.receivedAt,
    latestEvent: event.eventName,
    tools,
    updates: (previous?.updates ?? 0) + 1,
  };
  // Bound browser memory while keeping the most recently updated sessions.
  return [next, ...agents.filter((agent) => agent.key !== key)].slice(0, 200);
}
