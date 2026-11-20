import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const serviceName = "codexagentsdashboard.exe";
export const localServiceSid = "S-1-5-19";
const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = join(root, ".windows-service");
const configFile = join(stateDir, "config.json");

export function serviceOptions(config, projectRoot = root) {
  const env = [
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: String(config.port) },
    { name: "PATH", value: `${dirname(config.nodePath)};%PATH%` },
  ];
  if (config.account === "local-service") {
    env.push({ name: "DASHBOARD_CODEX_USAGE_DISABLED", value: "1" });
  } else {
    if (config.codexHome) env.push({ name: "CODEX_HOME", value: config.codexHome });
    if (config.codexBin) env.push({ name: "CODEX_BIN", value: config.codexBin });
  }
  return {
    name: "Codex Agents Dashboard",
    description: "Live LAN dashboard for Codex CLI and Claude Code agents.",
    script: join(projectRoot, "scripts", "service-entry.mjs"),
    workingDirectory: projectRoot,
    execPath: config.nodePath,
    nodeOptions: [],
    env,
    wait: 5,
    grow: 0.5,
    maxRetries: 3,
    maxRestarts: 3,
    stopparentfirst: true,
    logging: { mode: "roll-by-size", sizeThreshold: 1024, keepFiles: 2 },
    logpath: join(projectRoot, ".windows-service", "logs"),
  };
}

export function serviceAccountAllowed(serviceSid, userSid, account) {
  return serviceSid === (account === "local-service" ? localServiceSid : userSid);
}

export function installationConfig(nodePath, previous = {}) {
  return {
    nodePath,
    account: "local-service",
    port: Number.isInteger(previous.port) && previous.port > 0 && previous.port <= 65535 ? previous.port : 4321,
  };
}

export function overwriteServiceDefinition(service) {
  // node-windows 1.0.0-beta.8 exposes its generated WinSW configuration via
  // this getter, but has no update method. Keep the registered service and exe.
  writeFileSync(join(service.root, `${service.id}.xml`), service._xml);
}

export function windowsPowerShellEnvironment(environment = process.env) {
  // PowerShell 7 only cleans module paths when it launches powershell.exe
  // directly. Through Node/pnpm, Windows PowerShell inherits incompatible PS7
  // modules. These management commands need only Windows' built-in modules.
  const childEnvironment = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => key.toLowerCase() !== "psmodulepath"));
  const windowsRoot = Object.entries(environment).find(([key]) => key.toLowerCase() === "systemroot")?.[1];
  if (!windowsRoot) throw new Error("SystemRoot is missing; Windows PowerShell cannot be located.");
  childEnvironment.PSModulePath = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
  return childEnvironment;
}

function configureLocalService() {
  console.log(execFileSync(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(root, "scripts", "configure-local-service.ps1"), "-ProjectRoot", root],
    { windowsHide: true, encoding: "utf8", timeout: 120_000, env: windowsPowerShellEnvironment() }).trim());
}

function powershell(code) {
  return execFileSync(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${code}`],
    { windowsHide: true, encoding: "utf8", timeout: 45_000,
      env: { ...windowsPowerShellEnvironment(), DASHBOARD_SERVICE_NAME: serviceName } }).trim();
}

function operation(service, method, event) {
  return new Promise((resolveOperation, reject) => {
    const timer = setTimeout(() => reject(new Error("Service operation timed out. Check Windows Services.")), 45_000);
    const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolveOperation(); };
    service.once(event, () => finish());
    service.once("error", (error) => finish(new Error(String(error))));
    service.once("invalidinstallation", () => finish(new Error("The service installation is incomplete.")));
    service.once("alreadyinstalled", () => finish(new Error("Service files already exist. Uninstall before reinstalling.")));
    service[method]();
  });
}

async function portIsFree(port) {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolveFree(true)));
  });
}

async function main(command) {
  if (process.platform !== "win32") throw new Error("Windows service commands require Windows.");
  if (!["install", "start", "stop", "uninstall", "status"].includes(command)) {
    throw new Error("Usage: node scripts/windows-service.mjs install|start|stop|uninstall|status");
  }
  if (command === "status") {
    console.log(powershell("Get-CimInstance Win32_Service -Filter \"Name='$env:DASHBOARD_SERVICE_NAME'\" | Select-Object Name,State,StartMode,StartName | ConvertTo-Json" ) || "Service is not installed.");
    return;
  }
  if (powershell("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)") !== "True") {
    throw new Error("Administrator rights are required. Open PowerShell as administrator under the same Windows account and rerun this command.");
  }
  const installed = powershell("[bool](Get-Service -Name $env:DASHBOARD_SERVICE_NAME -ErrorAction SilentlyContinue)") === "True";
  if (command === "stop") {
    powershell("Stop-Service -Name $env:DASHBOARD_SERVICE_NAME; (Get-Service $env:DASHBOARD_SERVICE_NAME).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))");
    console.log("Service stopped.");
    return;
  }

  let config;
  if (command === "install") {
    if (!existsSync(join(root, "dist", "server", "entry.mjs"))) throw new Error("Run pnpm build first.");
    const expected = readFileSync(join(root, ".nvmrc"), "utf8").trim();
    if (process.versions.node !== expected) throw new Error(`Run nvm use ${expected} first.`);
    const previous = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8").replace(/^\uFEFF/, "")) : {};
    config = installationConfig(realpathSync(process.execPath), previous);
    if (installed) {
      // Stop before replacing any live configuration; never unregister/delete
      // the working service as part of a routine reinstall.
      powershell("Stop-Service $env:DASHBOARD_SERVICE_NAME; (Get-Service $env:DASHBOARD_SERVICE_NAME).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30)); Set-Service $env:DASHBOARD_SERVICE_NAME -StartupType Manual");
    }
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  } else {
    if (!installed) throw new Error("Service is not installed. Run pnpm service:install first.");
    config = JSON.parse(readFileSync(configFile, "utf8").replace(/^\uFEFF/, ""));
  }

  if (command === "start") {
    const identity = JSON.parse(powershell("$svc=Get-CimInstance Win32_Service -Filter \"Name='$env:DASHBOARD_SERVICE_NAME'\"; $account=[Security.Principal.NTAccount]::new($svc.StartName); @{serviceSid=$account.Translate([Security.Principal.SecurityIdentifier]).Value; userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress"));
    if (!serviceAccountAllowed(identity.serviceSid, identity.userSid, config.account)) {
      throw new Error("The service account does not match its setup. Rerun pnpm service:install to configure password-free LocalService.");
    }
    const alreadyRunning = powershell("(Get-Service $env:DASHBOARD_SERVICE_NAME).Status") === "Running";
    if (alreadyRunning) { console.log("Service is already running."); return; }
    if (config.account === "local-service") configureLocalService();
    // Retain the old task until the replacement is configured. Restore it if
    // starting the service fails, so migration does not leave the dashboard down.
    const oldTask = powershell("$task=Get-ScheduledTask -TaskName 'Codex Agents Dashboard' -TaskPath '\\' -ErrorAction SilentlyContinue; if ($task -and $task.Description -eq 'Starts the production Codex Agents Dashboard at sign-in.') { Disable-ScheduledTask -InputObject $task | Out-Null; Stop-ScheduledTask -InputObject $task; 'True' } else { 'False' }") === "True";
    try {
      for (let i = 0; i < 30 && !(await portIsFree(config.port)); i++) await delay(100);
      if (!(await portIsFree(config.port))) throw new Error(`Port ${config.port} is in use. Stop the existing server first.`);
      powershell("Start-Service $env:DASHBOARD_SERVICE_NAME; (Get-Service $env:DASHBOARD_SERVICE_NAME).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))");
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${config.port}/`, { signal: AbortSignal.timeout(1000) });
          if (response.ok && (await response.text()).includes("Codex")) { ready = true; break; }
        } catch {}
        await delay(250);
      }
      if (!ready) throw new Error("Service started but the dashboard did not respond. Check Windows Event Viewer and .windows-service/daemon logs.");
      powershell("Set-Service $env:DASHBOARD_SERVICE_NAME -StartupType Automatic");
      if (oldTask) powershell("Unregister-ScheduledTask -TaskName 'Codex Agents Dashboard' -TaskPath '\\' -Confirm:$false");
      console.log(`Service is running at http://localhost:${config.port}. Automatic Windows startup is enabled.`);
    } catch (error) {
      try { powershell("Set-Service $env:DASHBOARD_SERVICE_NAME -StartupType Manual; Stop-Service $env:DASHBOARD_SERVICE_NAME -ErrorAction SilentlyContinue"); } catch {}
      if (oldTask) powershell("Enable-ScheduledTask -TaskName 'Codex Agents Dashboard' | Out-Null; Start-ScheduledTask -TaskName 'Codex Agents Dashboard'");
      throw error;
    }
    return;
  }

  const { Service } = (await import("node-windows")).default;
  const service = new Service(serviceOptions(config));
  service.directory(stateDir);
  // Built-in account: never put a user password into generated service XML.
  service.logOnAs.domain = "NT AUTHORITY";
  service.logOnAs.account = "LocalService";
  service.logOnAs.password = "";
  if (command === "install") {
    mkdirSync(join(stateDir, "logs"), { recursive: true });
    if (installed) overwriteServiceDefinition(service);
    else await operation(service, "install", "install");
    if (powershell("[bool](Get-Service -Name $env:DASHBOARD_SERVICE_NAME -ErrorAction SilentlyContinue)") !== "True") throw new Error("Windows did not register the service.");
    powershell("Set-Service $env:DASHBOARD_SERVICE_NAME -StartupType Manual");
    configureLocalService();
    console.log(`${installed ? "Updated" : "Installed"}, stopped, as LocalService without a password. Run pnpm service:start.`);
    console.log("The existing scheduled task is unchanged until the service starts successfully.");
  } else {
    powershell("Stop-Service $env:DASHBOARD_SERVICE_NAME -ErrorAction SilentlyContinue");
    await operation(service, "uninstall", "uninstall");
    console.log("Service uninstalled. The dashboard source and build are retained.");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
