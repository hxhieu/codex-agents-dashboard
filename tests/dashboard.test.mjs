import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { applyEvent, groupAgents, removeAgent } from "../src/lib/agents.ts";
import { normalizeEvent } from "../src/lib/server/harnesses/index.ts";

const base = {
  harness: "codex",
  harnessLabel: "Codex",
  machine: "test-pc",
  sessionId: "session-1",
  cwd: "P:/project",
  receivedAt: new Date().toISOString(),
  id: "test",
};

test("removing a card clears its whole family across filters and lets the next update start fresh", () => {
  let agents = [];
  const update = (eventName, extra = {}) => {
    agents = applyEvent(agents, { ...base, eventName, ...extra });
  };
  update("PreToolUse", { toolName: "Bash", toolUseId: "old-call",
    tokenUsage: { totalTokens: 999, observedAt: base.receivedAt } });
  update("PreToolUse", { agentId: "child", agentType: "visible-child", toolName: "Bash" });
  update("PreToolUse", { sessionId: "child", agentId: "grandchild", toolName: "Bash" });
  update("SubagentStart", { agentId: "hidden-sibling" });
  update("SessionEnd", { machine: "other-pc" });
  update("SessionEnd", { harness: "claude-code", harnessLabel: "Claude Code" });
  const [filtered] = groupAgents(agents, "visible-child");
  assert.equal(filtered.children.length, 1);
  agents = removeAgent(agents, filtered.key);
  assert.equal(agents.length, 2);
  assert.ok(agents.every((agent) => agent.machine !== base.machine || agent.harness !== base.harness));
  update("PostModelRequest");
  assert.equal(agents[0].sessionId, base.sessionId);
  assert.equal(agents[0].updates, 1);
  assert.equal(agents[0].tokenUsage, undefined);
  assert.deepEqual(agents[0].tools, {});
  assert.equal(groupAgents(agents).find((node) => node.key === filtered.key).children.length, 0);
});

test("subagent removal leaves its parent and siblings; unobserved parent cards can also be cleared", () => {
  let agents = applyEvent([], { ...base, eventName: "SessionStart" });
  agents = applyEvent(agents, { ...base, eventName: "SubagentStart", agentId: "child" });
  agents = applyEvent(agents, { ...base, eventName: "SubagentStart", agentId: "sibling" });
  agents = applyEvent(agents, { ...base, eventName: "SubagentStart", sessionId: "child", agentId: "grandchild" });
  const parent = groupAgents(agents)[0];
  agents = removeAgent(agents, parent.children.find((node) => node.sessionId === "child").key);
  assert.deepEqual(new Set(agents.map((agent) => agent.sessionId)), new Set([base.sessionId, "sibling"]));
  const orphaned = agents.filter((agent) => agent.parentSessionId);
  const placeholder = groupAgents(orphaned)[0];
  assert.equal(placeholder.agent, undefined);
  assert.deepEqual(removeAgent(orphaned, placeholder.key), []);
});

test("late model observations and tool completions do not reopen idle or ended sessions", () => {
  for (const [ending, expected] of [["Stop", "Awaiting prompt"], ["SessionEnd", "Session ended"],
    ["Interrupt", "Interrupted"], ["SubagentStop", "Subagent stopped"]]) {
    let agents = [];
    const identity = ending === "SubagentStop" ? { agentId: "child" } : {};
    const update = (eventName, extra = {}) => {
      agents = applyEvent(agents, { ...base, ...identity, eventName, ...extra });
    };
    update("PreToolUse", { toolName: "Bash", toolUseId: "call" });
    update(ending);
    const tokenUsage = { totalTokens: 500, observedAt: "2026-11-17T00:00:00Z" };
    update("PostModelRequest", { tokenUsage });
    assert.equal(agents[0].status, expected);
    assert.equal(agents[0].latestEvent, ending);
    assert.equal(agents[0].tokenUsage.totalTokens, 500);
    update("PostToolUse", { toolName: "Bash", toolUseId: "call" });
    update("PreModelRequest");
    assert.equal(agents[0].status, expected);
    assert.equal(agents[0].latestEvent, ending);
    assert.deepEqual(agents[0].tools, {});
    update("UserPromptSubmit");
    assert.equal(agents[0].status, "Working");
    update("PreToolUse", { toolName: "Bash", toolUseId: "new-call" });
    assert.equal(agents[0].status, "Using tools");
  }
});

test("model observations preserve active tools and questions or approvals without losing token updates", () => {
  for (const [eventName, extra, expected] of [
    ["PreToolUse", { toolName: "Bash", toolUseId: "a" }, "Using tools"],
    ["PreToolUse", { toolName: "request_user_input", toolUseId: "q" }, "Awaiting answer"],
    ["PermissionRequest", { toolName: "Bash" }, "Approval requested"],
  ]) {
    let agents = applyEvent([], { ...base, eventName, ...extra });
    const tools = agents[0].tools;
    agents = applyEvent(agents, { ...base, eventName: "PostModelRequest",
      tokenUsage: { totalTokens: 100, observedAt: "2026-11-17T00:00:00Z" } });
    assert.equal(agents[0].status, expected);
    assert.deepEqual(agents[0].tools, tools);
    assert.equal(agents[0].tokenUsage.totalTokens, 100);
  }
});

test("parallel tools stay active until all finish; lifecycle and subagent identities stay distinct", () => {
  let agents = [];
  const update = (eventName, extra = {}) => {
    agents = applyEvent(agents, { ...base, eventName, ...extra });
  };
  update("PreToolUse", { toolName: "Bash", toolUseId: "a" });
  update("PreToolUse", { toolName: "Bash", toolUseId: "b" });
  update("PostToolUse", { toolName: "Bash", toolUseId: "a" });
  assert.equal(agents[0].status, "Using tools");
  assert.deepEqual(Object.keys(agents[0].tools), ["b"]);
  update("Stop");
  assert.equal(agents[0].status, "Awaiting prompt");
  assert.deepEqual(agents[0].tools, {});
  update("SubagentStart", { agentId: "child", agentType: "worker" });
  assert.equal(agents[0].sessionId, "child");
  assert.equal(agents[0].parentSessionId, "session-1");
  assert.equal(agents[1].status, "Awaiting prompt");
  update("SubagentStop", { agentId: "child" });
  assert.equal(agents[0].status, "Subagent stopped");
  update("SessionStart", { machine: "other-pc" });
  assert.equal(agents.length, 3);
});

test("subagents join their parent card even when the parent reports later", () => {
  let agents = applyEvent([], {
    ...base, eventName: "SubagentStart", agentId: "child-a", agentType: "researcher",
  });
  let families = groupAgents(agents);
  assert.equal(families.length, 1);
  assert.equal(families[0].sessionId, "session-1");
  assert.equal(families[0].agent, undefined);
  assert.equal(families[0].children[0].agent.agentType, "researcher");
  agents = applyEvent(agents, { ...base, eventName: "SessionStart" });
  agents = applyEvent(agents, {
    ...base, eventName: "SubagentStart", agentId: "child-b", agentType: "reviewer",
  });
  agents = applyEvent(agents, {
    ...base, eventName: "SubagentStart", sessionId: "child-a", agentId: "grandchild", agentType: "reader",
  });
  agents = applyEvent(agents, {
    ...base, eventName: "PreToolUse", sessionId: "child-a", toolName: "Bash", toolUseId: "child-tool",
  });
  agents = applyEvent(agents, { ...base, eventName: "SessionStart", machine: "another-pc" });
  families = groupAgents(agents);
  assert.equal(families.length, 2);
  const parent = families.find((node) => node.machine === "test-pc");
  assert.equal(parent.agent.sessionId, "session-1");
  assert.equal(parent.children.length, 2);
  const child = parent.children.find((node) => node.sessionId === "child-a");
  assert.equal(child.agent.status, "Using tools");
  assert.equal(child.children[0].sessionId, "grandchild");
  assert.equal(families.find((node) => node.machine === "another-pc").children.length, 0);
  const filtered = groupAgents(agents, "researcher");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sessionId, "session-1");
  assert.equal(filtered[0].children.length, 1);
  assert.equal(filtered[0].children[0].children.length, 1);
  assert.equal(groupAgents(agents, "nonexistent").length, 0);
  assert.equal(groupAgents(agents, "test-pc")[0].children.length, 2);
});

test("ordinary subagent hooks recreate child rows after refresh without overwriting the parent", () => {
  const parent = { session_id: "root", cwd: "P:/project" };
  const child = { ...parent, agent_id: "child", agent_type: "worker" };
  const event = (input) => normalizeEvent(input, "test-pc");
  // The browser opened after SubagentStart, so its first event is a tool update.
  let agents = applyEvent([], event({ ...child, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "child-tool" }));
  let family = groupAgents(agents)[0];
  assert.equal(family.sessionId, "root");
  assert.equal(family.agent, undefined);
  assert.equal(family.children[0].sessionId, "child");
  assert.equal(family.children[0].agent.status, "Using tools");
  agents = applyEvent(agents, event({ ...parent, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_use_id: "parent-tool" }));
  agents = applyEvent(agents, event({ ...child, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "child-tool" }));
  agents = applyEvent(agents, event({ ...child, hook_event_name: "PermissionRequest", tool_name: "Bash" }));
  family = groupAgents(agents)[0];
  assert.equal(family.agent.status, "Using tools");
  assert.deepEqual(family.agent.tools, { "parent-tool": "apply_patch" });
  assert.equal(family.children.length, 1);
  assert.equal(family.children[0].agent.status, "Approval requested");
  agents = applyEvent(agents, event({ ...child, hook_event_name: "SubagentStop" }));
  family = groupAgents(agents)[0];
  assert.equal(family.children[0].agent.status, "Subagent stopped");
  assert.equal(family.agent.status, "Using tools");
});

test("subagent lifecycle events require a child ID instead of updating the parent", () => {
  for (const hook_event_name of ["SubagentStart", "SubagentStop"]) {
    assert.throws(() => normalizeEvent({ session_id: "parent", hook_event_name }, "test-pc"), /agent_id is required/);
  }
});

test("parent cards sort by project name and retain their order through activity updates", () => {
  let agents = [];
  const update = (sessionId, cwd, extra = {}) => {
    agents = applyEvent(agents, { ...base, eventName: "SessionStart", sessionId, cwd, ...extra });
  };
  update("zulu", "P:\\Zulu");
  update("alpha-b", "P:\\Alpha\\", { machine: "b-pc" });
  update("ten", "/work/project10");
  update("two", "/work/project2/");
  update("alpha-a2", "/work/alpha", { machine: "a-pc" });
  update("alpha-a1", "/work/alpha", { machine: "a-pc" });
  const order = () => groupAgents(agents).map((node) => node.sessionId);
  const expected = ["alpha-a1", "alpha-a2", "alpha-b", "two", "ten", "zulu"];
  assert.deepEqual(order(), expected);
  update("zulu", "P:\\Zulu", { eventName: "PreToolUse", toolName: "Bash", toolUseId: "latest", receivedAt: "2099-01-01T00:00:00Z" });
  update("zulu", "P:\\Zulu", { eventName: "SubagentStart", agentId: "busy-child", receivedAt: "2099-01-02T00:00:00Z" });
  assert.deepEqual(order(), expected);
  assert.deepEqual(groupAgents([...agents].reverse()).map((node) => node.sessionId), expected);
  update("unknown-parent", "", { eventName: "SubagentStart", agentId: "orphan" });
  assert.deepEqual(order(), [...expected, "unknown-parent"]);
});

test("cyclic parent metadata keeps sessions visible instead of recursing", () => {
  let agents = applyEvent([], { ...base, eventName: "SessionStart" });
  agents = applyEvent(agents, { ...base, eventName: "SubagentStart", agentId: "child" });
  agents = agents.map((agent) => agent.sessionId === "session-1" ? { ...agent, parentSessionId: "child" } : agent);
  const families = groupAgents(agents);
  assert.equal(families.length, 2);
  assert.ok(families.every((node) => node.children.length === 0));
});

test("blocking user questions remain pending through unrelated tools and clear when the tool returns", () => {
  for (const toolName of ["request_user_input", "functions.request_user_input"]) {
    let agents = [];
    const update = (eventName, extra = {}) => {
      agents = applyEvent(agents, { ...base, eventName, ...extra });
    };
    update("PreToolUse", { toolName, toolUseId: "question" });
    assert.equal(agents[0].status, "Awaiting answer");
    update("PreToolUse", { toolName: "Bash", toolUseId: "other" });
    assert.equal(agents[0].status, "Awaiting answer");
    update("PostToolUse", { toolName: "Bash", toolUseId: "other" });
    assert.equal(agents[0].status, "Awaiting answer");
    update("PostToolUse", { toolName, toolUseId: "question" });
    assert.equal(agents[0].status, "Working");
    update("PermissionRequest", { toolName: "Bash" });
    assert.equal(agents[0].status, "Approval requested");
    update("Stop");
    assert.equal(agents[0].status, "Awaiting prompt");
  }
});

test("Codex async questions wait for user input after acknowledgement, background work and Stop", () => {
  for (const toolName of ["request_user_input_async", "functions.request_user_input_async"]) {
    for (const order of [["PreToolUse", "PostToolUse"], ["PostToolUse", "PreToolUse"]]) {
      let agents = [];
      const update = (eventName, extra = {}) => {
        agents = applyEvent(agents, { ...base, eventName, ...extra });
      };
      for (const eventName of order) update(eventName, { toolName, toolUseId: "question" });
      assert.equal(agents[0].status, "Awaiting answer");
      update("PreToolUse", { toolName: "Bash", toolUseId: "other" });
      update("PostToolUse", { toolName: "Bash", toolUseId: "other" });
      update("PreCompact");
      update("PostCompact");
      update("Stop");
      update("PostModelRequest");
      assert.equal(agents[0].status, "Awaiting answer");
      assert.deepEqual(agents[0].tools, { question: toolName });
      update("UserPromptSubmit");
      assert.equal(agents[0].status, "Working");
      assert.deepEqual(agents[0].tools, {});
      update("PostToolUse", { toolName, toolUseId: "question" });
      assert.equal(agents[0].status, "Working");
    }
  }
});

test("ending or interrupting a session dismisses its async question without a late completion reopening it", () => {
  for (const [eventName, status] of [["SessionEnd", "Session ended"],
    ["Interrupt", "Interrupted"], ["SubagentStop", "Subagent stopped"]]) {
    const identity = eventName === "SubagentStop" ? { agentId: "child" } : {};
    const question = { ...base, ...identity, toolName: "request_user_input_async", toolUseId: "question" };
    let agents = applyEvent([], { ...question, eventName: "PreToolUse" });
    agents = applyEvent(agents, { ...base, ...identity, eventName });
    agents = applyEvent(agents, { ...question, eventName: "PostToolUse" });
    assert.equal(agents[0].status, status);
    assert.deepEqual(agents[0].tools, {});
  }
});

test(
  "built server broadcasts metadata live to multiple browsers without replay",
  { timeout: 30_000 },
  async (t) => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const server = spawn(process.execPath, ["dist/server/entry.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), CODEX_BIN: "missing-codex-for-dashboard-tests" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let logs = "";
    server.stdout.on("data", (chunk) => {
      logs = (logs + chunk).slice(-8000);
    });
    server.stderr.on("data", (chunk) => {
      logs = (logs + chunk).slice(-8000);
    });
    const streams = [];
    t.after(async () => {
      await Promise.allSettled(streams.map((reader) => reader.cancel()));
      const exited = once(server, "exit");
      server.kill();
      if (server.exitCode === null) await exited;
    });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          const html = await response.text();
          assert.match(html, /Agent activity/);
          assert.ok(html.indexOf('Codex weekly left') < html.indexOf('Last update'));
          assert.match(html, /aria-label="Dark mode"/);
          assert.ok(html.indexOf('src="/theme.js"') < html.indexOf('<body'), 'Theme preference loads before the dashboard body.');
          ready = true;
          break;
        }
      } catch {
        /* Server is still starting. */
      }
      if (server.exitCode !== null) throw new Error(logs);
      await delay(100);
    }
    assert.ok(ready, logs);
    const themeScript = await fetch(`${origin}/theme.js`);
    assert.equal(themeScript.status, 200);
    assert.match(await themeScript.text(), /codex-dashboard-theme/);
    const usageResponse = await fetch(`${origin}/api/usage`);
    assert.equal(usageResponse.status, 200);
    assert.equal(usageResponse.headers.get("cache-control"), "no-store");
    const usage = await usageResponse.json();
    assert.equal(usage.status, "unavailable");
    assert.equal(usage.remainingPercent, null);
    assert.equal(usage.resetsAt, null);
    const post = (payload, headers = {}) =>
      fetch(`${origin}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Machine": "test-pc",
          "X-Harness": "codex",
          ...headers,
        },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
    const event = {
      session_id: "before-connect",
      hook_event_name: "SessionStart",
      cwd: "P:/project",
    };
    assert.equal((await post(event)).status, 204);
    async function connect() {
      const response = await fetch(`${origin}/api/stream`);
      assert.match(response.headers.get("content-type"), /text\/event-stream/);
      const reader = response.body.getReader();
      streams.push(reader);
      const first = await reader.read();
      assert.equal(new TextDecoder().decode(first.value), ": connected\n\n");
      return reader;
    }
    async function receive(reader) {
      let text = "";
      while (!text.includes("\n\n")) {
        const { done, value } = await reader.read();
        assert.equal(done, false);
        text += new TextDecoder().decode(value);
      }
      const data = text.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(data, text);
      return JSON.parse(data.slice(6));
    }
    const first = await connect();
    const second = await connect();
    const incoming = {
      ...event,
      session_id: "live-session",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "call-1",
      tool_input: { command: "private-command-marker" },
      tool_response: "private-result-marker",
      session_token_usage: { total_tokens: 234567, input_tokens: 200000, output_tokens: 34567,
        observed_at: "2026-11-17T00:00:00Z", private: "private-token-marker" },
    };
    const pending = Promise.all([receive(first), receive(second)]);
    assert.equal((await post(incoming)).status, 204);
    const messages = await pending;
    assert.deepEqual(messages[0], messages[1]);
    assert.equal(messages[0].sessionId, "live-session");
    assert.equal(messages[0].machine, "test-pc");
    assert.equal(messages[0].harness, "codex");
    assert.equal(messages[0].harnessLabel, "Codex");
    assert.equal(messages[0].toolUseId, "call-1");
    assert.equal(messages[0].tokenUsage.totalTokens, 234567);
    assert.doesNotMatch(
      JSON.stringify(messages),
      /private-command-marker|private-result-marker|private-token-marker|tool_input|tool_response/,
    );
    const childPending = Promise.all([receive(first), receive(second)]);
    assert.equal((await post({
      ...incoming, agent_id: "live-child", agent_type: "worker", tool_use_id: "child-call",
    })).status, 204);
    const childMessages = await childPending;
    assert.deepEqual(childMessages[0], childMessages[1]);
    const family = groupAgents(applyEvent(applyEvent([], messages[0]), childMessages[0]))[0];
    assert.equal(family.agent.sessionId, "live-session");
    assert.deepEqual(Object.keys(family.agent.tools), ["call-1"]);
    assert.equal(family.children[0].sessionId, "live-child");
    assert.deepEqual(Object.keys(family.children[0].agent.tools), ["child-call"]);
    let idleState = applyEvent([], messages[0]);
    for (const hookEvent of ["Stop", "PostModelRequest", "PostToolUse"]) {
      const ordered = Promise.all([receive(first), receive(second)]);
      assert.equal((await post({ ...incoming, hook_event_name: hookEvent,
        session_token_usage: { total_tokens: 345678, input_tokens: 300000, output_tokens: 45678,
          cached_input_tokens: 250000, observed_at: "2026-11-17T01:00:00Z" } })).status, 204);
      const updates = await ordered;
      assert.deepEqual(updates[0], updates[1]);
      idleState = applyEvent(idleState, updates[0]);
      assert.equal(idleState[0].status, "Awaiting prompt");
      assert.equal(idleState[0].latestEvent, "Stop");
      assert.equal(idleState[0].tokenUsage.totalTokens, 345678);
    }
    const claudePending = Promise.all([receive(first), receive(second)]);
    assert.equal((await post({ ...incoming, tool_name: "AskUserQuestion" }, { "X-Harness": "claude-code" })).status, 204);
    const claudeMessages = await claudePending;
    assert.deepEqual(claudeMessages[0], claudeMessages[1]);
    assert.equal(claudeMessages[0].harness, "claude-code");
    assert.equal(claudeMessages[0].harnessLabel, "Claude Code");
    assert.equal(applyEvent([], claudeMessages[0])[0].status, "Awaiting answer");
    assert.equal((await post("{broken")).status, 400);
    assert.equal(
      (await post({ ...event, hook_event_name: "unsupported" })).status,
      400,
    );
    assert.equal((await post(event, { "X-Machine": "" })).status, 400);
    for (const harness of ["unknown", "", "constructor", "__proto__"]) {
      assert.equal((await post(event, { "X-Harness": harness })).status, 400);
    }
    assert.equal(
      (await post(event, { "Content-Type": "text/plain" })).status,
      415,
    );
    assert.equal(
      (await post({ ...event, padding: "x".repeat(1024 * 1024) })).status,
      413,
    );
    // A fresh connection sees only events posted after it connects.
    const third = await connect();
    const next = receive(third);
    assert.equal(
      (await post({ ...event, session_id: "after-refresh" })).status,
      204,
    );
    assert.equal((await next).sessionId, "after-refresh");
  },
);
