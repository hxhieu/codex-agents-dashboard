// Standalone hook filter: emit metadata and cumulative session counts only.
// curl remains responsible for delivery; this helper stores no state.
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_CLAUDE_BYTES = 128 * 1024 * 1024;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const string = (value, max = 256) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

export function codexTokensFromRecords(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    if (records[index].length > 256 * 1024) continue;
    let row;
    try { row = JSON.parse(records[index]); } catch { continue; }
    if (row?.type !== "event_msg" || row.payload?.type !== "token_count") continue;
    const observedAt = timestamp(row.timestamp);
    const usage = row.payload.info?.total_token_usage;
    const total = count(usage?.total_tokens);
    if (total === undefined || !observedAt) continue;
    const result = { total_tokens: total, observed_at: observedAt };
    for (const key of ["input_tokens", "output_tokens", "cached_input_tokens"]) {
      if (count(usage[key]) !== undefined) result[key] = usage[key];
    }
    return result;
  }
}

async function codexSessionTokens(path, targetId) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return;
    const head = Buffer.alloc(Math.min(stat.size, 65536));
    const headRead = await file.read(head, 0, head.length, 0);
    let first;
    try { first = JSON.parse(head.subarray(0, headRead.bytesRead).toString("utf8").split("\n")[0]); } catch { return; }
    // Never label a parent's cumulative count as a child's token consumption.
    if (first?.type !== "session_meta" || first.payload?.id !== targetId) return;
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const tail = Buffer.alloc(Math.min(stat.size, MAX_TAIL_BYTES));
    const { bytesRead } = await file.read(tail, 0, tail.length, start);
    const lines = tail.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start) lines.shift();
    return codexTokensFromRecords(lines);
  } finally { await file.close(); }
}

/** Claude repeats assistant records while streaming; count each message ID once. */
export function claudeTokenAccumulator(targetId) {
  const messages = new Map();
  let observedAt;
  let incomplete = false;
  return {
    add(row) {
      if (row?.type !== "assistant" || (row.agentId ?? row.sessionId) !== targetId) return;
      const usage = row.message?.usage;
      if (!usage) return;
      const id = string(row.message.id, 512);
      const values = [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0].map(count);
      const time = timestamp(row.timestamp);
      if (!id || !time || values.some((value) => value === undefined)) { incomplete = true; return; }
      const previous = messages.get(id) ?? [0, 0, 0, 0];
      messages.set(id, values.map((value, index) => Math.max(previous[index], value)));
      if (!observedAt || time > observedAt) observedAt = time;
    },
    result() {
      if (incomplete || !messages.size || !observedAt) return;
      let input = 0, output = 0, cached = 0;
      for (const [fresh, generated, read, written] of messages.values()) {
        input += fresh + read + written;
        output += generated;
        cached += read;
      }
      if (![input, output, cached, input + output].every(Number.isSafeInteger)) return;
      return { total_tokens: input + output, input_tokens: input, output_tokens: output, cached_input_tokens: cached, observed_at: observedAt };
    },
  };
}

async function claudeSessionTokens(path, targetId) {
  const accumulator = claudeTokenAccumulator(targetId);
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let bytes = 0;
  stream.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_CLAUDE_BYTES) stream.destroy(new Error("Session log exceeded its read limit"));
  });
  // Forward read errors to the iterator as well as the stream.
  stream.on("error", () => lines.close());
  let failed = false;
  stream.on("error", () => { failed = true; });
  try {
    for await (const line of lines) {
      if (line.length > 8 * 1024 * 1024) { failed = true; break; }
      try { accumulator.add(JSON.parse(line)); } catch { /* Ignore partial/non-JSON records. */ }
    }
    if (!failed) return accumulator.result();
  } finally { lines.close(); stream.destroy(); }
}

export async function enrichHook(payload, harness) {
  const report = {};
  for (const key of ["session_id", "hook_event_name", "tool_name", "tool_use_id", "agent_id", "agent_type", "cwd"]) {
    const value = string(payload?.[key], key === "cwd" ? 2048 : 256);
    if (value) report[key] = value;
  }
  if (!report.session_id || !["codex", "claude-code"].includes(harness)) return report;
  const child = report.agent_id && report.agent_id !== report.session_id;
  const targetId = child ? report.agent_id : report.session_id;
  let path = child && payload.agent_transcript_path ? payload.agent_transcript_path : payload.transcript_path;
  if (typeof path !== "string" || !path.endsWith(".jsonl")) return report;
  if (harness === "claude-code" && child && !payload.agent_transcript_path) {
    if (!/^[\w-]+$/.test(targetId)) return report;
    const filename = `agent-${targetId}.jsonl`;
    if (basename(path) !== filename) path = join(dirname(path), basename(path, ".jsonl"), "subagents", filename);
  }
  try {
    const usage = harness === "codex" ? await codexSessionTokens(path, targetId) : await claudeSessionTokens(path, targetId);
    if (usage) report.session_token_usage = usage;
  } catch { /* Missing/unflushed logs leave totals unknown, without interrupting the CLI. */ }
  return report;
}

async function readHook(harness) {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 8 * 1024 * 1024) throw new Error("Hook input exceeded limit");
  }
  return enrichHook(JSON.parse(input), harness);
}

/** Windows bootstrap calls this directly, avoiding nested shell quoting/pipelines. */
export async function sendHook(harness, url) {
  try {
    const report = await readHook(harness);
    if (!report.session_id) return;
    await new Promise((resolve) => {
      const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", [
        "--silent", "--output", process.platform === "win32" ? "NUL" : "/dev/null",
        "--connect-timeout", "0.25", "--max-time", "1",
        "--header", "Content-Type:application/json", "--header", `X-Machine:${hostname()}`,
        "--header", `X-Harness:${harness}`, "--data-binary", "@-", "--", url,
      ], { windowsHide: true, timeout: 1500, stdio: ["pipe", "ignore", "ignore"] });
      child.once("error", resolve);
      child.once("close", resolve);
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(report));
    });
  } catch { /* Reporting failures must never interrupt the CLI or return context. */ }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const harness = process.argv[process.argv.indexOf("--harness") + 1];
    process.stdout.write(JSON.stringify(await readHook(harness)));
  } catch { process.stdout.write("{}"); }
}
