import type { HookEventName, HookMetadata } from "../../events";
import { normalizeHookMetadata } from "./shared.ts";

const eventNames: Readonly<Record<string, HookEventName>> = {
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
  UserPromptSubmit: "UserPromptSubmit",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  PermissionRequest: "PermissionRequest",
  Stop: "Stop",
  Interrupt: "Interrupt",
  SubagentStart: "SubagentStart",
  SubagentStop: "SubagentStop",
  PreCompact: "PreCompact",
  PostCompact: "PostCompact",
  PreModelRequest: "PreModelRequest",
  PostModelRequest: "PostModelRequest",
};

/** Translate Codex hooks into dashboard metadata, discarding private content. */
export function normalizeCodexEvent(payload: unknown): HookMetadata {
  return normalizeHookMetadata(payload, eventNames);
}
