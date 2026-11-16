import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent } from "../src/lib/agents.ts";
import { updateTabAttention } from "../src/lib/attention.ts";

test("the tab flags waiting parents and subagents, then clears as work resumes or the view resets", () => {
  const icon = {
    href: "/favicon.svg",
    getAttribute() { return this.href; },
    setAttribute(_name, value) { this.href = value; },
  };
  const page = { title: "Codex / Agents", querySelector() { return icon; } };
  const base = {
    harness: "codex", harnessLabel: "Codex",
    machine: "test-pc", sessionId: "parent", cwd: "P:/project",
    receivedAt: new Date().toISOString(), id: "test",
  };
  let agents = [];
  function update(eventName, extra = {}) {
    agents = applyEvent(agents, { ...base, eventName, ...extra });
    updateTabAttention(agents, page);
  }

  update("Stop");
  assert.equal(page.title, "(1 waiting) Codex / Agents");
  assert.equal(icon.href, "/favicon-attention.svg");
  update("PreToolUse", { agentId: "child", toolName: "request_user_input", toolUseId: "question" });
  assert.equal(page.title, "(2 waiting) Codex / Agents");
  update("PreToolUse", { toolName: "Bash", toolUseId: "parent-tool" });
  assert.equal(page.title, "(1 waiting) Codex / Agents");
  update("PostToolUse", { agentId: "child", toolName: "request_user_input", toolUseId: "question" });
  assert.equal(page.title, "Codex / Agents");
  assert.equal(icon.href, "/favicon.svg");
  update("PermissionRequest", { agentId: "child", toolName: "Bash" });
  assert.equal(page.title, "(1 waiting) Codex / Agents");
  update("SubagentStop", { agentId: "child" });
  assert.equal(page.title, "Codex / Agents");
  update("Stop");
  updateTabAttention([], page);
  assert.equal(page.title, "Codex / Agents");
  assert.equal(icon.href, "/favicon.svg");
});
