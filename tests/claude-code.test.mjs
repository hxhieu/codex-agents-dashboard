import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyEvent, groupAgents } from "../src/lib/agents.ts";
import { normalizeEvent } from "../src/lib/server/harnesses/index.ts";

const config = JSON.parse(readFileSync(new URL("../hooks/claude-code.json", import.meta.url), "utf8"));
const base = { session_id: "parent", cwd: "/work/project" };
const event = (name, extra = {}) => normalizeEvent({ ...base, hook_event_name: name, ...extra }, "test-pc", "claude-code");

test("every Claude reporter uses supported settings fields and maps to a safe dashboard event", () => {
  assert.deepEqual(Object.keys(config), ["hooks"]);
  for (const [name, groups] of Object.entries(config.hooks)) {
    const mapped = event(name, {
      agent_id: "child", agent_type: "Explore", tool_name: "Bash", tool_use_id: "call",
      tool_input: { command: "private-command" }, error: "private-error",
      last_assistant_message: "private-message", transcript_path: "private-path",
    });
    assert.equal(mapped.harnessLabel, "Claude Code");
    assert.equal(mapped.agentId, "child");
    assert.doesNotMatch(JSON.stringify(mapped), /private-/);
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.deepEqual(Object.keys(hook).sort(), ["async", "command", "shell", "timeout", "type"]);
        assert.equal(hook.type, "command");
        assert.equal(hook.shell, "bash");
        assert.equal(hook.async, name !== "SessionEnd");
        assert.match(hook.command, /X-Harness:claude-code/);
        assert.match(hook.command, /--max-time 1/);
        assert.match(hook.command, /\|\| true$/);
      }
    }
  }
  assert.throws(() => event("PreModelRequest"), /Unsupported hook_event_name/);
  assert.throws(() => event("SubagentStart"), /agent_id is required/);
});

test("Claude questions, approvals, failed tools and error-ended turns preserve parallel call state", () => {
  let agents = [];
  const update = (name, extra = {}) => { agents = applyEvent(agents, event(name, extra)); };
  update("PreToolUse", { tool_name: "AskUserQuestion", tool_use_id: "question" });
  assert.equal(agents[0].status, "Awaiting answer");
  update("PreToolUse", { tool_name: "Bash", tool_use_id: "parallel" });
  update("PostToolUseFailure", { tool_name: "Bash", tool_use_id: "parallel" });
  assert.equal(agents[0].status, "Awaiting answer");
  assert.deepEqual(agents[0].tools, { question: "AskUserQuestion" });
  update("PostToolUse", { tool_name: "AskUserQuestion", tool_use_id: "question" });
  assert.equal(agents[0].status, "Working");
  update("PreToolUse", { tool_name: "Bash", tool_use_id: "denied" });
  update("PermissionRequest", { tool_name: "Bash", tool_use_id: "denied" });
  assert.equal(agents[0].status, "Approval requested");
  update("PermissionDenied", { tool_name: "Bash", tool_use_id: "denied" });
  assert.deepEqual(agents[0].tools, {});
  assert.equal(agents[0].status, "Working");
  update("PreToolUse", { tool_name: "Bash", tool_use_id: "unfinished" });
  update("StopFailure");
  assert.equal(agents[0].status, "Interrupted");
  assert.deepEqual(agents[0].tools, {});
  update("Stop");
  assert.equal(agents[0].status, "Awaiting prompt");
});

test("Claude child tools recreate subagents after refresh without overwriting a Codex session with the same ID", () => {
  const parent = normalizeEvent({ ...base, hook_event_name: "Stop" }, "test-pc", "codex");
  let agents = applyEvent([], parent);
  agents = applyEvent(agents, event("PreToolUse", {
    agent_id: "child", agent_type: "Explore", tool_name: "Read", tool_use_id: "read",
  }));
  let families = groupAgents(agents);
  assert.equal(families.length, 2);
  assert.equal(families.find((node) => node.harness === "codex").agent.status, "Awaiting prompt");
  assert.equal(families.find((node) => node.harness === "claude-code").agent, undefined);
  agents = applyEvent(agents, event("SessionStart"));
  agents = applyEvent(agents, event("SubagentStop", { agent_id: "child" }));
  families = groupAgents(agents);
  assert.equal(families.find((node) => node.harness === "claude-code").children[0].agent.status, "Subagent stopped");
});

const bash = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "/bin/bash";

test("the generated Bash command forwards stdin and hostname, emits no output, and ignores network failure", {
  skip: !existsSync(bash), timeout: 15_000,
}, async (t) => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reporterPath = fileURLToPath(new URL("../hooks/session-tokens.mjs", import.meta.url)).replace(/\\/g, "/");
  const command = config.hooks.PreToolUse[0].hooks[0].command
    .replace(/http:\/\/[^\s]+/, `${origin}/api/events`)
    .replace('${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-tokens.mjs', reporterPath);
  async function run() {
    const child = spawn(bash, ["-c", command], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = once(child, "exit");
    child.stdin.end(JSON.stringify({ ...base, hook_event_name: "PreToolUse" }));
    assert.equal((await exited)[0], 0);
    assert.equal(output, "");
  }
  const received = new Promise((resolve) => {
    server.once("request", async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(204).end();
      resolve({ headers: request.headers, body: JSON.parse(body) });
    });
  });
  await run();
  const request = await received;
  assert.equal(request.headers["x-harness"], "claude-code");
  assert.ok(request.headers["x-machine"]);
  assert.equal(request.headers["content-type"], "application/json");
  assert.deepEqual(request.body, { ...base, hook_event_name: "PreToolUse" });
  await new Promise((resolve) => server.close(resolve));
  await run();
});
