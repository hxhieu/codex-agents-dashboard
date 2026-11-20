// Task Scheduler can terminate PowerShell without terminating its Node child.
// End this server too when its original launcher disappears; no extra process
// or persisted state is needed. The timer must not keep a failed server alive.
if (process.platform === "win32") {
  const parentPid = process.ppid;
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") process.exit(0);
    }
  }, 1000).unref();
}
