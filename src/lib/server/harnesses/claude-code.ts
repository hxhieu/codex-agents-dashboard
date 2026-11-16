import type { HookEventName, HookMetadata } from "../../events";
import { normalizeHookMetadata } from "./shared.ts";

const eventNames: Readonly<Record<string, HookEventName>> = {
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
  UserPromptSubmit: "UserPromptSubmit",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  // Failed or denied tools must leave the active-tool list too.
  PostToolUseFailure: "PostToolUse",
  PermissionDenied: "PostToolUse",
  PermissionRequest: "PermissionRequest",
  Stop: "Stop",
  StopFailure: "Interrupt",
  SubagentStart: "SubagentStart",
  SubagentStop: "SubagentStop",
  PreCompact: "PreCompact",
  PostCompact: "PostCompact",
};

export function normalizeClaudeCodeEvent(payload: unknown): HookMetadata {
  return normalizeHookMetadata(payload, eventNames);
}
