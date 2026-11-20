import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { readCodexWeeklyUsage, weeklyUsageFromLimits } from "../src/lib/server/codex-usage.ts";

const now = Date.parse("2026-11-17T00:00:00Z");
const weekly = { usedPercent: 41, windowDurationMins: 10080, resetsAt: now / 1000 + 86400 };

test("password-free service mode returns unavailable without launching Codex", async (t) => {
  const previous = process.env.DASHBOARD_CODEX_USAGE_DISABLED;
  process.env.DASHBOARD_CODEX_USAGE_DISABLED = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.DASHBOARD_CODEX_USAGE_DISABLED;
    else process.env.DASHBOARD_CODEX_USAGE_DISABLED = previous;
  });
  let starts = 0;
  const usage = await readCodexWeeklyUsage(() => { starts++; throw new Error("Must not start"); });
  assert.equal(starts, 0);
  assert.equal(usage.status, "unavailable");
  assert.equal(usage.remainingPercent, null);
});

test("weekly remaining quota comes from either Codex window and preserves zero remaining", () => {
  for (const slot of ["primary", "secondary"]) {
    const usage = weeklyUsageFromLimits({ rateLimits: { limitId: "codex", [slot]: weekly } }, now);
    assert.equal(usage.status, "available");
    assert.equal(usage.remainingPercent, 59);
    assert.equal(usage.resetsAt, "2026-11-18T00:00:00.000Z");
    assert.equal(usage.checkedAt, new Date(now).toISOString());
  }
  const exhausted = weeklyUsageFromLimits({ rateLimits: { primary: { ...weekly, usedPercent: 100 } } }, now);
  assert.equal(exhausted.remainingPercent, 0);
  assert.equal(exhausted.status, "available");
  assert.equal(weeklyUsageFromLimits({ rateLimits: { primary: { ...weekly, usedPercent: 104 } } }, now).remainingPercent, 0);
});

test("the Codex bucket takes precedence and short, expired or malformed limits stay unavailable", () => {
  const result = {
    rateLimits: { limitId: "other-model", primary: { ...weekly, usedPercent: 5 } },
    rateLimitsByLimitId: { codex: { primary: weekly }, "other-model": { primary: weekly } },
  };
  assert.equal(weeklyUsageFromLimits(result, now).remainingPercent, 59);
  for (const value of [
    null, {}, { rateLimits: { primary: { ...weekly, windowDurationMins: 300 } } },
    { rateLimits: { primary: { ...weekly, resetsAt: now / 1000 } } },
    { rateLimits: { primary: { ...weekly, usedPercent: "41" } } },
    { rateLimits: { primary: { ...weekly, usedPercent: NaN } } },
    { rateLimits: { primary: { ...weekly, usedPercent: -1 } } },
    { rateLimits: { primary: { ...weekly, resetsAt: "tomorrow" } } },
    { rateLimits: { limitId: "other-model", primary: weekly } },
  ]) {
    const usage = weeklyUsageFromLimits(value, now);
    assert.equal(usage.status, "unavailable");
    assert.equal(usage.remainingPercent, null);
  }
});

function processDouble(onRequest) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  child.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) {
      queueMicrotask(() => onRequest(JSON.parse(line), child));
    }
  });
  return child;
}

test("usage reading only initializes and requests limits, filters account fields and stops its subprocess", async () => {
  const methods = [];
  const child = processDouble((request, child) => {
    methods.push(request.method);
    if (request.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    if (request.id === 2) {
      const result = {
        rateLimits: { primary: { ...weekly, resetsAt: Date.now() / 1000 + 86400 } },
        email: "private-account", token: "private-token", credits: { balance: "private-balance" },
      };
      const message = `${JSON.stringify({ id: 2, result })}\n`;
      child.stdout.write(message.slice(0, 12));
      child.stdout.write(message.slice(12));
    }
  });
  const usage = await readCodexWeeklyUsage(() => child);
  assert.equal(usage.remainingPercent, 59);
  assert.deepEqual(methods, ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(child.killed, true);
  assert.doesNotMatch(JSON.stringify(usage), /private-|token|email|credits/);
});

test("usage errors, missing CLI, early exits and timeouts return unavailable and clean up", async () => {
  const failed = processDouble((request, child) => {
    if (request.id) child.stdout.write(`${JSON.stringify({ id: request.id, error: { message: "private-auth-error" } })}\n`);
  });
  assert.equal((await readCodexWeeklyUsage(() => failed)).status, "unavailable");
  assert.equal(failed.killed, true);
  const exited = processDouble((_request, child) => { child.emit("exit", 1); });
  assert.equal((await readCodexWeeklyUsage(() => exited)).status, "unavailable");
  const timedOut = processDouble(() => {});
  assert.equal((await readCodexWeeklyUsage(() => timedOut, 10)).status, "unavailable");
  assert.equal(timedOut.killed, true);
  const missing = processDouble(() => {});
  queueMicrotask(() => missing.emit("error", new Error("private-path")));
  const usage = await readCodexWeeklyUsage(() => missing);
  assert.equal(usage.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(usage), /private-/);
});
