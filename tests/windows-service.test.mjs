import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { serviceName, serviceOptions } from "../scripts/windows-service.mjs";

test("Windows service configuration pins Node and forwards only dashboard settings without credentials", async () => {
  const config = { nodePath: "C:/Node versions/24.13.0/node.exe", codexHome: "C:/Users/test/.codex",
    codexBin: "C:/Codex CLI/codex.exe", port: 4321, password: "must-not-be-forwarded", secret: "private" };
  const options = serviceOptions(config, "C:/Projects/dashboard with spaces");
  assert.equal(options.execPath, config.nodePath);
  assert.ok(options.script.endsWith("service-entry.mjs"));
  assert.equal(options.workingDirectory, "C:/Projects/dashboard with spaces");
  assert.deepEqual(options.env.map((item) => item.name).sort(), ["CODEX_BIN", "CODEX_HOME", "HOST", "PATH", "PORT"]);
  assert.ok(!JSON.stringify(options).includes(config.password));
  assert.ok(!JSON.stringify(options).includes(config.secret));
  assert.equal(options.stopparentfirst, true);
  assert.equal(options.maxRetries, 3);
  assert.equal(options.logging.mode, "roll-by-size");
  if (process.platform === "win32") {
    const { Service } = (await import("node-windows")).default;
    const service = new Service(options);
    assert.equal(service.id + ".exe", serviceName);
    service.logOnAs.domain = "NT AUTHORITY";
    service.logOnAs.account = "LocalService";
    const originalLog = console.log;
    let xml;
    try { console.log = () => {}; xml = service._xml; } finally { console.log = originalLog; }
    assert.ok(xml.includes("<user>LocalService</user>"));
    assert.ok(xml.includes("<password></password>") || xml.includes("<password/>"));
    assert.ok(xml.includes("<executable>" + resolve(config.nodePath) + "</executable>"));
    assert.ok(!xml.includes("must-not-be-forwarded"));
  }
});

test("the service's ES module starts under Node fork and exits when the wrapper sends shutdown", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard service "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist", "server"), { recursive: true });
  const entry = join(root, "scripts", "service-entry.mjs");
  await copyFile(new URL("../scripts/service-entry.mjs", import.meta.url), entry);
  await writeFile(join(root, "dist", "server", "entry.mjs"), 'process.send("ready"); setInterval(() => {}, 1000);');
  const child = fork(entry, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  t.after(() => child.kill());
  const [message] = await once(child, "message");
  assert.equal(message, "ready");
  const exited = once(child, "exit");
  child.send("shutdown");
  assert.deepEqual(await exited, [0, null]);
});

test("unknown service actions fail without changing Windows services", async () => {
  const exec = promisify(execFile);
  await assert.rejects(exec(process.execPath, ["scripts/windows-service.mjs", "unknown"], { windowsHide: true }),
    (error) => error.code === 1 && /Usage:|require Windows/.test(error.stderr));
});
