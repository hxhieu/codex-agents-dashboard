import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyEvent, groupAgents } from "../src/lib/agents.ts";
import { hookEvents } from "../src/lib/events.ts";
import { normalizeEvent } from "../src/lib/server/harnesses/index.ts";

const payload = { session_id: "parent", hook_event_name: "PreToolUse", cwd: "P:/project" };

test("the registered Codex mapping preserves supported metadata and discards payload identities and private content", () => {
  for (const eventName of hookEvents) {
    const event = normalizeEvent({
      ...payload, hook_event_name: eventName, agent_id: "child", agent_type: "worker",
      tool_name: "Bash", tool_use_id: "call", harness: "fake", harnessLabel: "Fake",
      machine: "fake", sessionId: "fake", eventName: "fake", prompt: "private-prompt",
      tool_input: { command: "private-command" }, tool_response: "private-response",
    }, " test-pc ", " Codex ");
    assert.equal(event.harness, "codex");
    assert.equal(event.harnessLabel, "Codex");
    assert.equal(event.machine, "test-pc");
    assert.equal(event.sessionId, "parent");
    assert.equal(event.eventName, eventName);
    assert.equal(event.agentId, "child");
    assert.equal(event.agentType, "worker");
    assert.equal(event.toolUseId, "call");
    assert.doesNotMatch(JSON.stringify(event), /private-|fake/);
  }
});

test("old hooks default to Codex while unregistered harnesses and events are rejected", () => {
  assert.equal(normalizeEvent(payload, "test-pc").harness, "codex");
  for (const harness of ["", " ", "unknown", "constructor", "__proto__"]) {
    assert.throws(() => normalizeEvent(payload, "test-pc", harness), /Unsupported X-Harness/);
  }
  for (const eventName of ["unsupported", "constructor", "__proto__"]) {
    assert.throws(() => normalizeEvent({ ...payload, hook_event_name: eventName }, "test-pc", "codex"), /Unsupported hook_event_name/);
  }
});

test("session state and parent trees remain isolated when different harnesses reuse IDs on one machine", () => {
  const codex = normalizeEvent(payload, "test-pc", "codex");
  // A future adapter must remain isolated even when its IDs match Codex's IDs.
  const other = { ...codex, harness: "future-test", harnessLabel: "Future test" };
  let agents = applyEvent([], codex);
  agents = applyEvent(agents, other);
  agents = applyEvent(agents, { ...codex, eventName: "SubagentStart", agentId: "child" });
  agents = applyEvent(agents, { ...other, eventName: "SubagentStart", agentId: "child" });
  agents = applyEvent(agents, { ...codex, eventName: "PermissionRequest", agentId: "child" });
  assert.equal(agents.length, 4);
  const families = groupAgents(agents);
  assert.equal(families.length, 2);
  const codexFamily = families.find((node) => node.harness === "codex");
  const otherFamily = families.find((node) => node.harness === "future-test");
  assert.equal(codexFamily.children[0].agent.status, "Approval requested");
  assert.equal(otherFamily.children[0].agent.status, "Working");
  const filtered = groupAgents(agents, "future-test");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].harness, "future-test");
  const missingParent = groupAgents(agents.filter((agent) => agent.parentSessionId));
  assert.equal(missingParent.length, 2);
  assert.equal(missingParent.find((node) => node.harness === "codex").harnessLabel, "Codex");
});

test("both Codex hook configurations identify every reporter and preserve startup and delivery behavior", () => {
  for (const path of ["../hooks/codex.json", "../examples/hooks.json"]) {
    const config = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    assert.equal(config.hooks.SessionStart[0].matcher, "^startup$");
    for (const [eventName, groups] of Object.entries(config.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          assert.match(hook.command, /--header X-Harness:codex/);
          assert.match(hook.commandWindows, /sendHook\('codex',/);
          assert.doesNotMatch(hook.commandWindows, /cmd\.exe/);
          if (path === "../hooks/codex.json") {
            assert.match(hook.command, /-- "\$CODEX_DASHBOARD_URL"/);
            assert.match(hook.commandWindows, /process\.env\.CODEX_DASHBOARD_URL/);
          }
          assert.match(hook.command, /--max-time 1/);
          assert.equal(hook.async, eventName !== "SessionEnd");
        }
      }
    }
  }
});
