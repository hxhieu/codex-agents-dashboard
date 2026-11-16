import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { applyEvent, groupAgents } from "../src/lib/agents.ts";

const base = {
  machine: "test-pc",
  sessionId: "session-1",
  cwd: "P:/project",
  receivedAt: new Date().toISOString(),
  id: "test",
};

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

test("cyclic parent metadata keeps sessions visible instead of recursing", () => {
  let agents = applyEvent([], { ...base, eventName: "SessionStart" });
  agents = applyEvent(agents, { ...base, eventName: "SubagentStart", agentId: "child" });
  agents = agents.map((agent) => agent.sessionId === "session-1" ? { ...agent, parentSessionId: "child" } : agent);
  const families = groupAgents(agents);
  assert.equal(families.length, 2);
  assert.ok(families.every((node) => node.children.length === 0));
});

test("user questions remain pending through unrelated tool updates and clear when answered", () => {
  for (const toolName of ["request_user_input", "functions.request_user_input_async"]) {
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
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
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
          assert.match(await response.text(), /Agent activity/);
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
    const post = (payload, headers = {}) =>
      fetch(`${origin}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Machine": "test-pc",
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
    };
    const pending = Promise.all([receive(first), receive(second)]);
    assert.equal((await post(incoming)).status, 204);
    const messages = await pending;
    assert.deepEqual(messages[0], messages[1]);
    assert.equal(messages[0].sessionId, "live-session");
    assert.equal(messages[0].machine, "test-pc");
    assert.equal(messages[0].toolUseId, "call-1");
    assert.doesNotMatch(
      JSON.stringify(messages),
      /private-command-marker|private-result-marker|tool_input|tool_response/,
    );
    assert.equal((await post("{broken")).status, 400);
    assert.equal(
      (await post({ ...event, hook_event_name: "unsupported" })).status,
      400,
    );
    assert.equal((await post(event, { "X-Machine": "" })).status, 400);
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
