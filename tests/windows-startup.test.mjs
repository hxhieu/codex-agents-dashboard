import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const exec = promisify(execFile);
const windows = process.platform === "win32";

test("the Windows task launcher handles spaces, sets its environment and propagates Node failures", { skip: !windows }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard startup "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist", "server"), { recursive: true });
  const runner = join(root, "scripts", "start-dashboard.ps1");
  await copyFile(new URL("../scripts/start-dashboard.ps1", import.meta.url), runner);
  await copyFile(new URL("../scripts/watch-task-parent.mjs", import.meta.url), join(root, "scripts", "watch-task-parent.mjs"));
  await writeFile(join(root, "dist", "server", "entry.mjs"), `
    console.log(JSON.stringify({host:process.env.HOST,port:process.env.PORT,
      cwd:process.cwd(),codex:process.env.CODEX_BIN,path:process.env.PATH}));
    process.exit(7);
  `);
  const codex = join(root, "Codex CLI", "codex.exe");
  let failure;
  try {
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", runner, "-NodePath", process.execPath, "-ListenAddress", "127.0.0.1",
      "-Port", "54321", "-CodexPath", codex], { windowsHide: true, timeout: 15_000 });
  } catch (error) { failure = error; }
  assert.equal(failure?.code, 7, failure?.stderr);
  const actual = JSON.parse(failure.stdout.trim());
  assert.equal(actual.host, "127.0.0.1");
  assert.equal(actual.port, "54321");
  assert.equal(actual.cwd.toLowerCase(), root.toLowerCase());
  assert.equal(actual.codex, codex);
  assert.ok(actual.path.toLowerCase().startsWith(join(process.execPath, "..").toLowerCase() + ";"));
});

test("terminating the Windows task host also ends its Node server", { skip: !windows, timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard task stop "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist", "server"), { recursive: true });
  const runner = join(root, "scripts", "start-dashboard.ps1");
  await copyFile(new URL("../scripts/start-dashboard.ps1", import.meta.url), runner);
  await copyFile(new URL("../scripts/watch-task-parent.mjs", import.meta.url), join(root, "scripts", "watch-task-parent.mjs"));
  await writeFile(join(root, "dist", "server", "entry.mjs"),
    'console.log(process.pid); setInterval(() => {}, 1000);');
  const host = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", runner, "-NodePath", process.execPath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serverPid;
  t.after(() => {
    host.kill();
    if (serverPid) { try { process.kill(serverPid); } catch {} }
  });
  let output = "";
  host.stdout.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100 && !output.includes("\n"); attempt++) {
    assert.equal(host.exitCode, null, "The task host exited before starting Node.");
    await delay(50);
  }
  serverPid = Number(output.trim());
  assert.ok(Number.isInteger(serverPid) && serverPid > 0, "The server did not report its PID.");
  const closed = once(host, "close");
  host.kill();
  await closed;
  assert.throws(() => process.kill(serverPid, 0), { code: "ESRCH" });
  serverPid = undefined;
});

test("a missing production build fails the Windows task instead of reporting success", { skip: !windows }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard missing build "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  const runner = join(root, "scripts", "start-dashboard.ps1");
  await copyFile(new URL("../scripts/start-dashboard.ps1", import.meta.url), runner);
  await assert.rejects(
    exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", runner, "-NodePath", process.execPath], { windowsHide: true, timeout: 15_000 }),
    (error) => error.code === 1 && /Production build is\s+missing/.test(error.stderr),
  );
});
