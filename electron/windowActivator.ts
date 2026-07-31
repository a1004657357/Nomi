export type ActivatableWindow = {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
};

export function createWindowActivator<TWindow extends ActivatableWindow>(options: {
  getWindows(): TWindow[];
  createWindow(): Promise<TWindow> | TWindow;
}): () => Promise<TWindow> {
  let pendingCreation: Promise<TWindow> | null = null;

  return async () => {
    const existing = options.getWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }

    if (!pendingCreation) {
      pendingCreation = Promise.resolve(options.createWindow()).finally(() => {
        pendingCreation = null;
      });
    }
    const created = await pendingCreation;
    created.focus();
    return created;
  };
}
