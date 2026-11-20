import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const serviceName = "codexagentsdashboard.exe";
const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = join(root, ".windows-service");
const configFile = join(stateDir, "config.json");

export function serviceOptions(config, projectRoot = root) {
  const env = [
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: String(config.port) },
    { name: "CODEX_HOME", value: config.codexHome },
    { name: "PATH", value: `${dirname(config.nodePath)};%PATH%` },
  ];
  if (config.codexBin) env.push({ name: "CODEX_BIN", value: config.codexBin });
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
  };
}

function powershell(code) {
  return execFileSync(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${code}`],
    { windowsHide: true, encoding: "utf8", timeout: 45_000, env: { ...process.env, DASHBOARD_SERVICE_NAME: serviceName } }).trim();
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
    if (installed) throw new Error("Service is already installed. Use service:start, or uninstall before reinstalling.");
    if (!existsSync(join(root, "dist", "server", "entry.mjs"))) throw new Error("Run pnpm build first.");
    const expected = readFileSync(join(root, ".nvmrc"), "utf8").trim();
    if (process.versions.node !== expected) throw new Error(`Run nvm use ${expected} first.`);
    const codexBin = process.env.CODEX_BIN || powershell("(Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue).Source");
    config = {
      nodePath: realpathSync(process.execPath),
      codexHome: resolve(process.env.CODEX_HOME || join(homedir(), ".codex")),
      codexBin: codexBin ? resolve(codexBin) : undefined,
      port: 4321,
    };
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  } else {
    if (!installed) throw new Error("Service is not installed. Run pnpm service:install first.");
    config = JSON.parse(readFileSync(configFile, "utf8"));
  }

  if (command === "start") {
    // The user enters credentials in Windows Services, never in source, JSON,
    // command arguments, or node-windows' generated service XML.
    powershell("$svc=Get-CimInstance Win32_Service -Filter \"Name='$env:DASHBOARD_SERVICE_NAME'\"; $account=[Security.Principal.NTAccount]::new($svc.StartName); if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'In Windows Services, set Codex Agents Dashboard > Properties > Log On to your Windows account first.' }");
    const alreadyRunning = powershell("(Get-Service $env:DASHBOARD_SERVICE_NAME).Status") === "Running";
    if (alreadyRunning) { console.log("Service is already running."); return; }
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
  // Safe, password-free holding account. Configure the real account in the
  // Services UI before activation, so the service can read Node and Codex files.
  service.logOnAs.domain = "NT AUTHORITY";
  service.logOnAs.account = "LocalService";
  service.logOnAs.password = "";
  if (command === "install") {
    await operation(service, "install", "install");
    if (powershell("[bool](Get-Service -Name $env:DASHBOARD_SERVICE_NAME -ErrorAction SilentlyContinue)") !== "True") throw new Error("Windows did not register the service.");
    powershell("Set-Service $env:DASHBOARD_SERVICE_NAME -StartupType Manual");
    console.log("Installed, stopped. Open Windows Services > Codex Agents Dashboard > Properties > Log On.");
    console.log("Select your Windows account and enter its password there, then run pnpm service:start.");
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
