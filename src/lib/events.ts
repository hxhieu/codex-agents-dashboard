import type { SessionTokenUsage } from "./tokens";

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
  harness: string;
  harnessLabel: string;
  machine: string;
  sessionId: string;
  eventName: HookEventName;
  receivedAt: string;
  cwd: string;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  agentType?: string;
  tokenUsage?: SessionTokenUsage;
}

export type HookMetadata = Omit<AgentEvent, "id" | "harness" | "harnessLabel" | "machine" | "receivedAt">;
