import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { installationConfig, localServiceSid, overwriteServiceDefinition, serviceAccountAllowed, serviceName, serviceOptions, windowsPowerShellEnvironment } from "../scripts/windows-service.mjs";

test("Windows PowerShell child environments discard every casing of inherited module paths", () => {
  const env = windowsPowerShellEnvironment({ SYSTEMROOT: "C:/Windows", PSModulePath: "PS7 modules", PSMODULEPATH: "other incompatible modules", KEEP: "unchanged" });
  assert.deepEqual(Object.keys(env).filter((key) => key.toLowerCase() === "psmodulepath"), ["PSModulePath"]);
  assert.equal(env.PSModulePath, join("C:/Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"));
  assert.equal(env.KEEP, "unchanged");
});

test("Node-launched Windows PowerShell loads native ACL commands despite an incompatible parent module path", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard ACL modules "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const badModules = join(root, "incompatible modules");
  const securityModule = join(badModules, "Microsoft.PowerShell.Security");
  await mkdir(securityModule, { recursive: true });
  await writeFile(join(securityModule, "Microsoft.PowerShell.Security.psd1"),
    "@{RootModule='broken.psm1';ModuleVersion='99.0.0';FunctionsToExport=@('Get-Acl','Set-Acl')}");
  await writeFile(join(securityModule, "broken.psm1"), "throw 'Incompatible module must not load'");
  const file = join(root, "runtime file.txt");
  await writeFile(file, "public test fixture");
  const environment = windowsPowerShellEnvironment({ ...process.env, PSModulePath: badModules });
  const { stdout } = await promisify(execFile)(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:DASHBOARD_ACL_TEST_FILE; Set-Acl -LiteralPath $env:DASHBOARD_ACL_TEST_FILE -AclObject $acl; @{nativeModule=(Get-Module Microsoft.PowerShell.Security).ModuleBase;loaded=[bool]$acl} | ConvertTo-Json -Compress"],
    { windowsHide: true, timeout: 15_000, env: { ...environment, DASHBOARD_ACL_TEST_FILE: file } });
  const result = JSON.parse(stdout);
  assert.equal(result.loaded, true);
  const nativeHost = resolve(environment.PSModulePath, "..").toLowerCase();
  const moduleBase = resolve(result.nativeModule).toLowerCase();
  assert.ok(moduleBase === nativeHost || moduleBase.startsWith(nativeHost + "\\"));
  assert.equal(await readFile(file, "utf8"), "public test fixture");
});

test("reinstalling preserves the configured port while replacing the old account and user settings", () => {
  const previous = { port: 54321, nodePath: "old-node", account: "current-user", codexHome: "private-home", codexBin: "private-cli", password: "private-password" };
  assert.deepEqual(installationConfig("new-node", previous), { nodePath: "new-node", account: "local-service", port: 54321 });
  for (const port of [undefined, -1, 0, 65536, "54321"]) {
    assert.equal(installationConfig("new-node", { port }).port, 4321);
  }
});

test("reinstalling overwrites the existing service definition without removing its wrapper", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard reinstall "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, ".windows-service");
  const daemonDir = join(stateDir, "daemon");
  await mkdir(daemonDir, { recursive: true });
  const { Service } = (await import("node-windows")).default;
  const service = new Service(serviceOptions({ account: "local-service", nodePath: process.execPath, port: 54321 }, root));
  service.directory(stateDir);
  service.logOnAs.domain = "NT AUTHORITY";
  service.logOnAs.account = "LocalService";
  service.logOnAs.password = "";
  const definition = join(daemonDir, `${service.id}.xml`);
  const wrapper = join(daemonDir, `${service.id}.exe`);
  await writeFile(definition, "old-user-config");
  await writeFile(wrapper, "existing-wrapper");
  const originalLog = console.log;
  try { console.log = () => {}; overwriteServiceDefinition(service); } finally { console.log = originalLog; }
  const xml = await readFile(definition, "utf8");
  assert.ok(!xml.includes("old-user-config"));
  assert.ok(xml.includes("<user>LocalService</user>"));
  assert.match(xml, /name="PORT" value="54321"/);
  assert.ok(!xml.includes("CODEX_HOME"));
  assert.equal(await readFile(wrapper, "utf8"), "existing-wrapper");
});

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

test("LocalService setup does not inherit a user's Codex login and validates the built-in account by SID", () => {
  const config = { account: "local-service", nodePath: process.execPath, port: 4321,
    codexHome: "private-user-home", codexBin: "private-user-codex" };
  const options = serviceOptions(config);
  assert.deepEqual(options.env.map((entry) => entry.name).sort(), ["DASHBOARD_CODEX_USAGE_DISABLED", "HOST", "PATH", "PORT"]);
  assert.ok(!JSON.stringify(options).includes("private-user"));
  assert.equal(serviceAccountAllowed(localServiceSid, "user-sid", "local-service"), true);
  assert.equal(serviceAccountAllowed("user-sid", "user-sid", "local-service"), false);
  assert.equal(serviceAccountAllowed("S-1-5-18", "user-sid", "local-service"), false);
  assert.equal(serviceAccountAllowed("user-sid", "user-sid", undefined), true);
});

test("LocalService permission setup can be previewed without changing files or starting a service", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard local service "));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ["dist", "node_modules", "scripts", ".windows-service/daemon"]) await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, "scripts", "service-entry.mjs"), "");
  const configFile = join(root, ".windows-service", "config.json");
  const xmlFile = join(root, ".windows-service", "daemon", "codexagentsdashboard.xml");
  const config = JSON.stringify({ nodePath: process.execPath, codexHome: "private-user-home", port: 4321 });
  const xml = "<service><serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user><password/></serviceaccount></service>";
  await writeFile(configFile, config);
  await writeFile(xmlFile, xml);
  const setupScript = join(root, "scripts", "configure-local-service.ps1");
  await copyFile(new URL("../scripts/configure-local-service.ps1", import.meta.url), setupScript);
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    setupScript, "-WhatIf"],
    { windowsHide: true, timeout: 15_000 });
  assert.match(stdout, /What if:/);
  const { readFile, stat } = await import("node:fs/promises");
  assert.equal(await readFile(configFile, "utf8"), config);
  assert.equal(await readFile(xmlFile, "utf8"), xml);
  await assert.rejects(stat(join(root, ".windows-service", "logs")), { code: "ENOENT" });
});

test("the service's ES module starts under Node fork and exits when the wrapper sends shutdown", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dashboard service "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist", "server"), { recursive: true });
  const entry = join(root, "scripts", "service-entry.mjs");
  await copyFile(new URL("../scripts/service-entry.mjs", import.meta.url), entry);
  await writeFile(join(root, "dist", "server", "entry.mjs"), 'process.send({ready:true,home:process.env.CODEX_HOME??null,bin:process.env.CODEX_BIN??null}); setInterval(() => {}, 1000);');
  const child = fork(entry, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, DASHBOARD_CODEX_USAGE_DISABLED: "1", CODEX_HOME: "private-user-home", CODEX_BIN: "private-user-codex" } });
  t.after(() => child.kill());
  const [message] = await once(child, "message");
  assert.deepEqual(message, { ready: true, home: null, bin: null });
  const exited = once(child, "exit");
  child.send("shutdown");
  assert.deepEqual(await exited, [0, null]);
});

test("unknown service actions fail without changing Windows services", async () => {
  const exec = promisify(execFile);
  await assert.rejects(exec(process.execPath, ["scripts/windows-service.mjs", "unknown"], { windowsHide: true }),
    (error) => error.code === 1 && /Usage:|require Windows/.test(error.stderr));
});
