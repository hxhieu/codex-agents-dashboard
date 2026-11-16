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

export interface AgentNode {
  key: string;
  machine: string;
  sessionId: string;
  agent?: Agent;
  children: AgentNode[];
}

/** Rebuild families from the current tab's events, including parents not yet seen. */
export function groupAgents(agents: Agent[], query = ""): AgentNode[] {
  const nodes = new Map<string, AgentNode>();
  function nodeFor(machine: string, sessionId: string): AgentNode {
    const key = JSON.stringify([machine, sessionId]);
    let node = nodes.get(key);
    if (!node) {
      node = { key, machine, sessionId, children: [] };
      nodes.set(key, node);
    }
    return node;
  }
  for (const agent of agents) nodeFor(agent.machine, agent.sessionId).agent = agent;
  const attached = new Set<string>();
  for (const agent of agents) {
    if (!agent.parentSessionId) continue;
    const node = nodeFor(agent.machine, agent.sessionId);
    const parent = nodeFor(agent.machine, agent.parentSessionId);
    // Ignore cyclic relationships instead of losing cards or recursing forever.
    const visited = new Set([node.key]);
    let ancestor: AgentNode | undefined = parent;
    let cyclic = false;
    while (ancestor) {
      if (visited.has(ancestor.key)) { cyclic = true; break; }
      visited.add(ancestor.key);
      ancestor = ancestor.agent?.parentSessionId
        ? nodes.get(JSON.stringify([ancestor.machine, ancestor.agent.parentSessionId]))
        : undefined;
    }
    if (cyclic) continue;
    parent.children.push(node);
    attached.add(node.key);
  }
  const search = query.trim().toLowerCase();
  function filter(node: AgentNode): AgentNode | undefined {
    const agent = node.agent;
    if (!search || `${node.machine} ${node.sessionId} ${agent?.cwd ?? ""} ${agent?.agentType ?? ""}`.toLowerCase().includes(search)) return node;
    const children = node.children.map(filter).filter((child): child is AgentNode => !!child);
    return children.length ? { ...node, children } : undefined;
  }
  function latest(node: AgentNode): number {
    return Math.max(node.agent ? Date.parse(node.agent.lastSeen) : 0, ...node.children.map(latest));
  }
  return [...nodes.values()]
    .filter((node) => !attached.has(node.key))
    .sort((a, b) => latest(b) - latest(a))
    .map(filter)
    .filter((node): node is AgentNode => !!node);
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
    ["PreToolUse", "PostToolUse"].includes(event.eventName) &&
    Object.values(tools).some((name) =>
      /(?:^|[._])request_user_input(?:_async)?$/.test(name),
    )
  ) {
    status = "Awaiting answer";
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
