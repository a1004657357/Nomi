export type ParentProcessWatchdogTimer = {
  unref?: () => void;
};

export type ParentProcessWatchdogOptions = {
  enabled: boolean;
  parentPid?: number;
  getCurrentParentPid?: () => number;
  isProcessAlive?: (pid: number) => boolean;
  exit: (code: number) => void;
  schedule?: (callback: () => void, intervalMs: number) => ParentProcessWatchdogTimer;
  clear?: (timer: ParentProcessWatchdogTimer) => void;
  intervalMs?: number;
};

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultSchedule(
  callback: () => void,
  intervalMs: number,
): ParentProcessWatchdogTimer {
  return setInterval(callback, intervalMs);
}

function defaultClear(timer: ParentProcessWatchdogTimer): void {
  clearInterval(timer as ReturnType<typeof setInterval>);
}

export function installParentProcessWatchdog(
  options: ParentProcessWatchdogOptions,
): () => void {
  const expectedParentPid = options.parentPid ?? process.ppid;
  if (!options.enabled || !Number.isInteger(expectedParentPid) || expectedParentPid <= 1) {
    return () => undefined;
  }

  const getCurrentParentPid = options.getCurrentParentPid ?? (() => process.ppid);
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const schedule = options.schedule ?? defaultSchedule;
  const clear = options.clear ?? defaultClear;
  let stopped = false;
  let exitRequested = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clear(timer);
  };

  const checkParent = (): void => {
    if (stopped || exitRequested) return;
    const currentParentPid = getCurrentParentPid();
    const parentAlive = isProcessAlive(expectedParentPid);
    if (currentParentPid === expectedParentPid && parentAlive) return;
    exitRequested = true;
    clear(timer);
    options.exit(0);
  };

  const timer = schedule(checkParent, options.intervalMs ?? 1_000);
  timer.unref?.();
  return stop;
}
