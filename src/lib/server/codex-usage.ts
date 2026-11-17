import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { WeeklyUsage } from "../usage";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function weeklyUsageFromLimits(result: unknown, now = Date.now()): WeeklyUsage {
  const unavailable: WeeklyUsage = {
    status: "unavailable", remainingPercent: null, resetsAt: null,
    checkedAt: new Date(now).toISOString(),
  };
  const response = object(result);
  const buckets = object(response?.rateLimitsByLimitId);
  // Use Codex's bucket, never a different model's quota or an arbitrary window.
  const limits = object(buckets?.codex) ?? object(response?.rateLimits);
  if (!limits || (limits.limitId != null && limits.limitId !== "codex")) return unavailable;
  for (const value of [limits.primary, limits.secondary]) {
    const window = object(value);
    if (window?.windowDurationMins !== 7 * 24 * 60) continue;
    const used = window.usedPercent;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
    let resetsAt: string | null = null;
    if (window.resetsAt != null) {
      if (typeof window.resetsAt !== "number" || !Number.isFinite(window.resetsAt)) continue;
      const reset = new Date(window.resetsAt * 1000);
      // An expired observation cannot tell us the new week's remaining quota.
      if (!Number.isFinite(reset.getTime()) || reset.getTime() <= now) continue;
      resetsAt = reset.toISOString();
    }
    return { ...unavailable, status: "available", remainingPercent: Math.max(0, Math.round(100 - used)), resetsAt };
  }
  return unavailable;
}

type CodexProcess = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "kill"> & {
  once(event: string, listener: () => void): unknown;
};

function startCodex(): CodexProcess {
  return spawn(process.env.CODEX_BIN || "codex", ["--disable", "hooks", "app-server", "--stdio"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
}

/** Read limits without creating/resuming any agent session or returning account data. */
export async function readCodexWeeklyUsage(start = startCodex, timeoutMs = 10_000): Promise<WeeklyUsage> {
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      const child = start();
      let settled = false;
      let initialized = false;
      let buffer = "";
      let bytes = 0;
      const timer = setTimeout(() => finish(new Error("Usage read timed out.")), timeoutMs);
      function finish(error?: Error, result?: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) reject(error); else resolve(result);
      }
      function send(message: unknown) {
        if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`);
      }
      child.once("error", () => finish(new Error("Codex is unavailable.")));
      child.once("exit", () => finish(new Error("Codex exited before returning limits.")));
      child.stdin.on("error", () => finish(new Error("Codex connection closed.")));
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { finish(new Error("Usage response exceeded its limit.")); return; }
        buffer += chunk.toString("utf8");
        let end: number;
        while (!settled && (end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let message: Record<string, unknown> | undefined;
          try { message = object(JSON.parse(line)); } catch { continue; }
          if (!message || (message.id !== 1 && message.id !== 2)) continue;
          if (message.error) { finish(new Error("Codex could not return usage.")); return; }
          if (message.id === 1 && !initialized) {
            initialized = true;
            send({ method: "initialized" });
            send({ id: 2, method: "account/rateLimits/read", params: {} });
          } else if (message.id === 2 && initialized) {
            finish(undefined, message.result);
          }
        }
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "codex_agents_dashboard", version: "0.1.0" } } });
    });
    return weeklyUsageFromLimits(result);
  } catch {
    // Never expose CLI stderr, authentication responses or local paths to LAN clients.
    return weeklyUsageFromLimits(null);
  }
}
