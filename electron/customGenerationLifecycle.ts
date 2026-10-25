import { app } from 'electron';
import { logError } from './logging/logger';
import type { RunDirectorFn } from './capabilityCore/directorRender';

let additionalBlenderCleanup: (() => number) | undefined;
export function setCustomBlenderCleanup(cancel: () => number): void {
  additionalBlenderCleanup = cancel;
}

export function configureCustomMcpRuntime(enabled: boolean): void {
  if (!enabled) return;
  app.disableHardwareAcceleration();
  for (const flag of ['disable-gpu', 'disable-software-rasterizer', 'in-process-gpu']) app.commandLine.appendSwitch(flag);
}

export const runCustomDirector: RunDirectorFn = async payload => {
  const director = await import('./blender/directorCli');
  return director.runDirectorBlenderRender(payload);
};

/** Called only from the final will-quit teardown, never a cancellable window close. */
export function stopCustomGenerationProcesses(): void {
  const cleanups = [
    () => (require('./ai/codexImagegenRunner') as typeof import('./ai/codexImagegenRunner')).terminateAllCodexImagegenProcesses(),
    () => (require('./blender/blenderRunner') as typeof import('./blender/blenderRunner')).cancelAllBlenderSceneRenders(),
    () => (require('./blender/directorCli') as typeof import('./blender/directorCli')).cancelAllDirectorBlenderRenders(),
    () => (require('./blender/vibingDirectorRunner') as typeof import('./blender/vibingDirectorRunner')).cancelAllVibingDirectorBlenderPlans(),
    () => additionalBlenderCleanup?.(),
  ];
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (error) { logError('main', 'custom-generation-cleanup-failed', error); }
  }
}
