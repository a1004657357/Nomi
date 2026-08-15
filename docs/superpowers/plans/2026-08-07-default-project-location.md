# Default Project Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop users choose the default parent directory used by all future Nomi projects without moving existing projects or application secrets.

**Architecture:** Persist one optional absolute path under Electron `userData`, resolve it through the existing `getProjectsRoot()` single entry point, and expose focused async IPC operations to the existing Settings dialog. Keep the generated-file auto-save preference independent and make all directory mutation/validation happen in the main process.

**Tech Stack:** Electron 31, TypeScript, React 18, i18next, Vitest, Playwright Electron.

---

### Task 1: Persist the project-location preference

**Files:**
- Create: `electron/settings/projectLocationSettings.ts`
- Create: `electron/settings/projectLocationSettings.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Cover missing/corrupt files, rejecting non-absolute stored values, atomically saving an absolute path, and clearing back to `null`. Use `NOMI_SETTINGS_DIR` with a temporary directory so tests never touch the real profile.

```ts
expect(readProjectLocationSettings()).toEqual({ projectsRoot: null })
writeProjectsRoot('/tmp/Nomi Projects')
expect(readProjectLocationSettings()).toEqual({ projectsRoot: '/tmp/Nomi Projects' })
writeProjectsRoot(null)
expect(readProjectLocationSettings()).toEqual({ projectsRoot: null })
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run electron/settings/projectLocationSettings.test.ts`
Expected: FAIL because `projectLocationSettings.ts` does not exist.

- [ ] **Step 3: Implement the minimal settings module**

Use `getSettingsRoot()`, `readJson()`, and `writeJsonFileAtomic()`. Export:

```ts
export type ProjectLocationSettings = { projectsRoot: string | null }
export function readProjectLocationSettings(): ProjectLocationSettings
export function writeProjectsRoot(projectsRoot: string | null): ProjectLocationSettings
```

Normalize with `path.resolve`, but only accept already-absolute non-empty values from disk so malformed settings fail closed to the default.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm vitest run electron/settings/projectLocationSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/settings/projectLocationSettings.ts electron/settings/projectLocationSettings.test.ts
git commit -m "feat(settings): persist default project location"
```

### Task 2: Make the existing project-root resolver honor the preference

**Files:**
- Modify: `electron/runtimePaths.ts`
- Modify: `electron/runtimePaths.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Test the exact precedence and source metadata:

```ts
expect(getProjectsRoot()).toBe(environmentRoot)
delete process.env.NOMI_PROJECTS_DIR
expect(getProjectsRoot()).toBe(customRoot)
writeProjectsRoot(null)
expect(getProjectsRoot()).toBe(path.join(documentsRoot, 'Nomi Projects'))
```

Also test `getProjectLocationState()` returns `{ path, source: 'environment' | 'custom' | 'default' }`.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run electron/runtimePaths.test.ts`
Expected: FAIL because the saved preference and state function are not consulted.

- [ ] **Step 3: Implement the single resolver**

```ts
export type ProjectLocationSource = 'environment' | 'custom' | 'default'
export function getProjectLocationState(): { path: string; source: ProjectLocationSource }
export function getProjectsRoot(): string {
  return getProjectLocationState().path
}
```

Preserve `NOMI_PROJECTS_DIR` as the highest-priority test/developer override.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `pnpm vitest run electron/runtimePaths.test.ts electron/settings/projectLocationSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/runtimePaths.ts electron/runtimePaths.test.ts
git commit -m "feat(projects): honor saved default location"
```

### Task 3: Add validated project-location IPC

**Files:**
- Create: `electron/settings/projectLocationIpc.ts`
- Create: `electron/settings/projectLocationIpc.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`

- [ ] **Step 1: Write failing service and IPC tests**

Inject dialog, shell, and filesystem effects. Verify:

- cancel leaves settings unchanged;
- a selected file is rejected;
- an unwritable directory is rejected;
- a valid directory is saved and returned as `source: 'custom'`;
- reset clears only the preference;
- reveal creates the effective root before opening it;
- environment override reports `source: 'environment'` and cannot be misrepresented as a saved custom path.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run electron/settings/projectLocationIpc.test.ts`
Expected: FAIL because the IPC module does not exist.

- [ ] **Step 3: Implement and register four async operations**

Use one typed result shape:

```ts
type ProjectLocationResult =
  | { ok: true; location: { path: string; source: ProjectLocationSource }; canceled?: boolean }
  | { ok: false; error: 'not-directory' | 'not-writable' | 'open-failed' }
```

Register `nomi:settings:project-location-get`, `-pick`, `-reset`, and `-reveal`. Add a `settings.projectLocation` namespace to preload and `DesktopBridge`; do not mix these operations into the assets namespace.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run electron/settings/projectLocationIpc.test.ts electron/runtimePaths.test.ts electron/settings/projectLocationSettings.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/settings electron/main.ts electron/preload.ts src/desktop/bridge.ts
git commit -m "feat(settings): expose project location controls"
```

### Task 4: Replace the placeholder with the real Settings UI

**Files:**
- Create: `src/workbench/settings/ProjectLocationSection.tsx`
- Modify: `src/workbench/settings/SettingsDialog.tsx`
- Modify: `src/i18n/locales/settings.ts`
- Create: `tests/ux/project-location-settings.walk.mjs`

- [ ] **Step 1: Write the failing Electron journey**

Launch with an isolated `NOMI_SETTINGS_DIR` whose `project-location.json` points to a temporary root. Assert the File & saving tab shows the effective path, “Open folder”, and “Restore default”, and no longer shows the placeholder. Create a project and verify its `.nomi/project.json` appears under the custom root. Toggle dark mode and capture both themes.

- [ ] **Step 2: Build and run the journey to verify RED**

Run: `pnpm run build && node tests/ux/project-location-settings.walk.mjs`
Expected: FAIL because the current UI still renders the “Later” placeholder.

- [ ] **Step 3: Implement the focused section**

`ProjectLocationSection` loads the bridge state on mount and tracks `loading`/`busy`. It keeps the old state on failures, maps result errors through i18n, and uses the existing toast system. Render token-only controls inside the existing section:

```tsx
<div data-settings-project-location>
  <div data-project-location-path title={location.path}>{location.path}</div>
  <button onClick={pick}>更改…</button>
  <button onClick={reveal}>打开文件夹</button>
  {location.source === 'custom' ? <button onClick={reset}>恢复默认</button> : null}
</div>
```

When `source === 'environment'`, show a concise managed-environment hint and disable change/reset so the UI never claims an overridden choice is active.

- [ ] **Step 4: Run the journey and focused tests to verify GREEN**

Run: `pnpm run build && node tests/ux/project-location-settings.walk.mjs && pnpm vitest run electron/settings/projectLocationSettings.test.ts electron/runtimePaths.test.ts electron/settings/projectLocationIpc.test.ts`
Expected: PASS with light/dark screenshots saved under `docs/design/mockups/2026-08-07-project-location/`.

- [ ] **Step 5: Commit**

```bash
git add src/workbench/settings src/i18n/locales/settings.ts tests/ux/project-location-settings.walk.mjs docs/design/mockups/2026-08-07-project-location
git commit -m "feat(settings): choose new project location"
```

### Task 5: Full verification and delivery

**Files:**
- Review all files changed by Tasks 1–4.

- [ ] **Step 1: Run the complete project gate**

Run: `pnpm run gates`
Expected: all file-size, token, dangling-token, archetype, secret, i18n, control, site, lint, typecheck, test, and build checks pass.

- [ ] **Step 2: Inspect screenshots against the approved design**

Read both light and dark screenshots. Confirm the path is legible, actions do not wrap or overflow, auto-save remains visually separate, the placeholder is gone, and the explanatory copy says only future projects are affected.

- [ ] **Step 3: Verify the final diff and commits**

Run: `git diff origin/main...HEAD --check && git status --short && git log --oneline origin/main..HEAD`
Expected: only this feature's source, tests, spec, plan, and verification screenshots are present; `node_modules` remains untracked and is not staged.

- [ ] **Step 4: Push the detached worktree commits to main**

Run: `git push origin HEAD:main`
Expected: push succeeds without force. If remote main advanced, fetch and replay only these commits in a fresh detached worktree, rerun the gates, then push.
