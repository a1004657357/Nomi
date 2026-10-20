import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeProjectOpened, withProjectAction } from '../workbench/project/projectCanvasReadSurface'
import { createProjectSessionTestHarness } from '../workbench/project/projectSessionTestHarness'

const KEY = 'nomi-workbench-last-active-project-v1'
const store = new Map<string, string>()
let session: ReturnType<typeof createProjectSessionTestHarness>

describe('project action authority replaces the deleted desktop reader', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => store.get(key) ?? null } })
    session = createProjectSessionTestHarness()
  })
  afterEach(() => { session.dispose(); vi.unstubAllGlobals() })

  it('issues only the hydrated project', async () => {
    await session.open('proj-A')
    expect(withProjectAction(project => project.binding.projectId)).toBe('proj-A')
  })
  it('does not grant authority from persisted last-active before hydration', () => {
    store.set(KEY, 'proj-persisted')
    expect(withProjectAction(project => project.binding.projectId)).toBeUndefined()
  })
  it('does not replace the open project with persisted state', async () => {
    await session.open('proj-current')
    store.set(KEY, 'proj-stale')
    expect(withProjectAction(project => project.binding.projectId)).toBe('proj-current')
  })
  it('revokes authority on close despite persisted state', async () => {
    store.set(KEY, 'proj-stale')
    await session.open('proj-current')
    const project = withProjectAction(project => project)!
    session.close()
    expect(() => project.assertCurrent()).toThrow()
    expect(withProjectAction(project => project.binding.projectId)).toBeUndefined()
  })
  it('has no implicit local project when no project is open', () => {
    expect(withProjectAction(project => project.binding.projectId)).toBeUndefined()
  })
  it('does not revive an old lifetime after A to B to A', async () => {
    await session.open('proj-A')
    const first = withProjectAction(project => project)!
    await session.open('proj-B')
    await session.open('proj-A')
    expect(() => first.assertCurrent()).toThrow()
    expect(withProjectAction(project => project.binding.projectId)).toBe('proj-A')
  })
  it('notifies adopted projects and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectOpened(project => listener(project.binding.projectId))
    await session.open('proj-A')
    await session.open('proj-B')
    unsubscribe()
    await session.open('proj-C')
    expect(listener.mock.calls).toEqual([['proj-A'], ['proj-B']])
  })
})
