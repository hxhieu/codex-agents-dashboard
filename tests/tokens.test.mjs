import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, copyFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { enrichHook, codexTokensFromRecords, claudeTokenAccumulator } from "../hooks/session-tokens.mjs";
import { normalizeEvent } from "../src/lib/server/harnesses/index.ts";
import { applyEvent } from "../src/lib/agents.ts";
import { formatTokens, uncachedSessionTokens } from "../src/lib/tokens.ts";

const older = "2026-11-17T01:00:00Z";
const newer = "2026-11-17T02:00:00Z";

test("displayed used tokens exclude cached input and preserve million-token precision", () => {
  const usage = { totalTokens: 66781373, inputTokens: 66582069, outputTokens: 199304,
    cachedInputTokens: 65712384, observedAt: newer };
  assert.equal(uncachedSessionTokens(usage), 1068989);
  assert.equal(formatTokens(uncachedSessionTokens(usage)), "1.07M");
  assert.equal(uncachedSessionTokens({ ...usage, inputTokens: 100, outputTokens: 20, cachedInputTokens: 100 }), 20);
  assert.equal(uncachedSessionTokens({ ...usage, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }), 0);
  assert.equal(uncachedSessionTokens(), undefined);
  assert.equal(uncachedSessionTokens({ totalTokens: 500, observedAt: newer }), undefined);
});
const codexCount = (time, total, last = 12) => JSON.stringify({
  timestamp: time, type: "event_msg", payload: { type: "token_count", info: {
    total_token_usage: { total_tokens: total, input_tokens: total - 10, output_tokens: 10, cached_input_tokens: 3 },
    last_token_usage: { total_tokens: last }, model_context_window: 200000,
  } },
});
const assistant = (id, time, usage, extra = {}) => ({
  type: "assistant", sessionId: "parent", timestamp: time,
  message: { id, usage, content: [{ text: "private-message" }] }, ...extra,
});

test("Codex reports the latest cumulative total rather than its current context or request count", () => {
  const usage = codexTokensFromRecords([codexCount(older, 100), codexCount(newer, 500), '{"partial":']);
  assert.equal(usage.total_tokens, 500);
  assert.equal(usage.input_tokens, 490);
  assert.equal(usage.output_tokens, 10);
  assert.equal(usage.observed_at, "2026-11-17T02:00:00.000Z");
  assert.equal(usage.model_context_window, undefined);
});

test("Claude totals deduplicate streaming records and include cache tokens without counting child requests", () => {
  const accumulator = claudeTokenAccumulator("parent");
  accumulator.add(assistant("one", older, { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 }));
  accumulator.add(assistant("one", newer, { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 }));
  accumulator.add(assistant("two", newer, { input_tokens: 40, output_tokens: 12 }));
  accumulator.add(assistant("child-message", newer, { input_tokens: 999, output_tokens: 999 }, { agentId: "child" }));
  accumulator.add({ type: "system", subtype: "compact_boundary", sessionId: "parent", timestamp: newer });
  assert.deepEqual(accumulator.result(), {
    total_tokens: 120, input_tokens: 100, output_tokens: 20, cached_input_tokens: 30,
    observed_at: "2026-11-17T02:00:00.000Z",
  });
  const empty = claudeTokenAccumulator("parent");
  assert.equal(empty.result(), undefined);
  empty.add(assistant(undefined, newer, { input_tokens: 10, output_tokens: 4 }));
  assert.equal(empty.result(), undefined);
});

test("the standalone helper reads token metadata, strips private content, and never copies parent totals onto children", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-tokens-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "parent.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "session_meta", payload: { id: "parent", base_instructions: "private-instructions" } }),
    JSON.stringify({ type: "response_item", payload: { text: "private-conversation" } }),
    codexCount(newer, 500), "",
  ].join("\n"));
  const payload = { session_id: "parent", hook_event_name: "PostToolUse", transcript_path: path,
    tool_input: { command: "private-command" }, tool_response: "private-output", prompt: "private-prompt" };
  const report = await enrichHook(payload, "codex");
  assert.equal(report.session_token_usage.total_tokens, 500);
  assert.doesNotMatch(JSON.stringify(report), /private-|transcript_path|base_instructions|tool_response|tool_input/);
  assert.equal((await enrichHook({ ...payload, agent_id: "child" }, "codex")).session_token_usage, undefined);
  assert.equal((await enrichHook({ ...payload, transcript_path: join(directory, "missing.jsonl") }, "codex")).session_token_usage, undefined);
  assert.equal((await enrichHook({ ...payload, transcript_path: directory }, "codex")).session_token_usage, undefined);

  await writeFile(path, JSON.stringify(assistant("parent-message", newer, { input_tokens: 400, output_tokens: 100 })) + "\n");
  const childDirectory = join(directory, "parent", "subagents");
  await mkdir(childDirectory, { recursive: true });
  await writeFile(join(childDirectory, "agent-child.jsonl"), JSON.stringify(assistant("child-message", newer,
    { input_tokens: 40, output_tokens: 10 }, { agentId: "child" })) + "\n");
  assert.equal((await enrichHook(payload, "claude-code")).session_token_usage.total_tokens, 500);
  const child = await enrichHook({ ...payload, agent_id: "child" }, "claude-code");
  assert.equal(child.session_token_usage.total_tokens, 50);
});

test("only valid explicit session totals reach the browser; zero is known and per-request usage is ignored", () => {
  const payload = { session_id: "parent", hook_event_name: "PostModelRequest", token_usage: { total_tokens: 999 } };
  assert.equal(normalizeEvent(payload, "test-pc", "codex").tokenUsage, undefined);
  const snapshot = { total_tokens: 0, input_tokens: 0, output_tokens: 0, observed_at: newer, private: "private-content" };
  assert.equal(normalizeEvent({ ...payload, session_token_usage: snapshot }, "test-pc").tokenUsage.totalTokens, 0);
  for (const invalid of [
    { ...snapshot, total_tokens: -1 }, { ...snapshot, total_tokens: "12" },
    { ...snapshot, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, observed_at: "invalid" }, { ...snapshot, input_tokens: 1 },
  ]) assert.equal(normalizeEvent({ ...payload, session_token_usage: invalid }, "test-pc").tokenUsage, undefined);
  const normalized = normalizeEvent({ ...payload, session_token_usage: snapshot }, "test-pc");
  assert.doesNotMatch(JSON.stringify(normalized), /private-content/);
});

test("token snapshots survive unrelated hooks, ignore reordered older values and stay isolated per agent and harness", () => {
  const payload = { session_id: "parent", hook_event_name: "PostToolUse" };
  const update = (count, time, extra = {}, harness = "codex") => normalizeEvent({ ...payload, ...extra,
    session_token_usage: { total_tokens: count, observed_at: time } }, "test-pc", harness);
  let agents = applyEvent([], update(500, newer));
  agents = applyEvent(agents, update(100, older));
  assert.equal(agents[0].tokenUsage.totalTokens, 500);
  agents = applyEvent(agents, normalizeEvent({ ...payload, hook_event_name: "Stop" }, "test-pc"));
  assert.equal(agents[0].tokenUsage.totalTokens, 500);
  agents = applyEvent(agents, update(50, newer, { agent_id: "child" }));
  agents = applyEvent(agents, update(70, newer, {}, "claude-code"));
  assert.equal(agents.find((agent) => agent.harness === "codex" && agent.sessionId === "parent").tokenUsage.totalTokens, 500);
  assert.equal(agents.find((agent) => agent.sessionId === "child").tokenUsage.totalTokens, 50);
  assert.equal(agents.find((agent) => agent.harness === "claude-code").tokenUsage.totalTokens, 70);
});

test("Windows hooks work through cmd, Windows PowerShell and PowerShell 7 with helper paths containing spaces", {
  skip: process.platform !== "win32", timeout: 15_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard tokens home "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".codex"));
  await copyFile(new URL("../hooks/session-tokens.mjs", import.meta.url), join(directory, ".codex/session-tokens.mjs"));
  const transcript = join(directory, "session.jsonl");
  await writeFile(transcript, [JSON.stringify({ type: "session_meta", payload: { id: "parent" } }), codexCount(newer, 500), ""].join("\n"));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { if (server.listening) server.close(); });
  const config = JSON.parse(await readFile(new URL("../hooks/codex.json", import.meta.url), "utf8"));
  const command = config.hooks.PostToolUse[0].hooks[0].commandWindows
    .replace(/http:\/\/[^\s'"]+/, `http://127.0.0.1:${server.address().port}/api/events`);
  const shells = ["cmd.exe", "powershell.exe"];
  if (existsSync(join(process.env.ProgramFiles ?? "C:/Program Files", "PowerShell/7/pwsh.exe"))) shells.push("pwsh.exe");
  for (const shell of shells) {
    const received = new Promise((resolve) => server.once("request", async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(204).end();
      resolve({ body: JSON.parse(body), headers: request.headers });
    }));
    const cmd = shell === "cmd.exe";
    const child = spawn(shell, cmd ? ["/d", "/s", "/c", `"${command}"`] : ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true, windowsVerbatimArguments: cmd,
      env: { ...process.env, USERPROFILE: directory, CODEX_HOME: join(directory, ".codex") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = once(child, "exit");
    child.stdin.end(JSON.stringify({ session_id: "parent", hook_event_name: "PostToolUse", transcript_path: transcript,
      tool_input: { command: "private-command" } }));
    assert.equal((await exited)[0], 0, `${shell}: ${output}`);
    assert.equal(output, "", shell);
    const report = await received;
    assert.equal(report.headers["x-harness"], "codex");
    assert.ok(report.headers["x-machine"]);
    assert.equal(report.body.session_token_usage.total_tokens, 500, shell);
    assert.doesNotMatch(JSON.stringify(report.body), /private-command|transcript_path|tool_input/);
  }
});
