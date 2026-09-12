import { dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { createProject, readProject } from './projects/repository'
import { openWorkspaceFolder, selectWorkspaceFolder } from './workspace/workspaceIpc'
import { listWorkspaceFiles, resolveWorkspaceFilePath } from './workspace/workspaceFileIndex'
import { registerWorkspaceFileDeleteIpc } from './workspace/workspaceFileDelete'
import { getSettingsRoot } from './runtimePaths'
import { assertTrustedSender } from './ipcSenderGuard'

type RegisterDesktopIntegrationIpcOptions = {
  setCancelBlenderRendersOnQuit: (cancel: () => number) => void
}

function registerProviderLoginIpc(): void {
  ipcMain.handle('nomi:dreamina:status', async (event) => {
    assertTrustedSender(event)
    const { dreaminaStatus } = await import('./catalog/dreaminaLoginIpc')
    return dreaminaStatus()
  })
  ipcMain.handle('nomi:dreamina:login-start', async (event) => {
    assertTrustedSender(event)
    const { dreaminaLoginStart } = await import('./catalog/dreaminaLoginIpc')
    return dreaminaLoginStart()
  })
  ipcMain.handle('nomi:dreamina:login-poll', async (event, deviceCode: unknown) => {
    assertTrustedSender(event)
    const { dreaminaLoginPoll } = await import('./catalog/dreaminaLoginIpc')
    return dreaminaLoginPoll(String(deviceCode || ''))
  })
  ipcMain.handle('nomi:dreamina:logout', async (event) => {
    assertTrustedSender(event)
    const { dreaminaLogout } = await import('./catalog/dreaminaLoginIpc')
    return dreaminaLogout()
  })
  ipcMain.handle('nomi:dreamina:install', async (event) => {
    assertTrustedSender(event)
    const { dreaminaInstall } = await import('./catalog/dreaminaLoginIpc')
    return dreaminaInstall()
  })
  ipcMain.handle('nomi:jimeng-web:status', async (event) => {
    assertTrustedSender(event)
    const { jimengWebStatus } = await import('./jimengWeb/ipc')
    return jimengWebStatus()
  })
  ipcMain.handle('nomi:jimeng-web:open-login', async (event) => {
    assertTrustedSender(event)
    const { jimengWebOpenLogin } = await import('./jimengWeb/ipc')
    return jimengWebOpenLogin()
  })
  ipcMain.handle('nomi:jimeng-web:open-admin', async (event, baseUrl: unknown) => {
    assertTrustedSender(event)
    const { jimengWebOpenAdmin } = await import('./jimengWeb/ipc')
    return jimengWebOpenAdmin(baseUrl)
  })
  ipcMain.handle('nomi:jimeng-web:start-runner', async (event) => {
    assertTrustedSender(event)
    const { jimengWebStartExtensionRunner } = await import('./jimengWeb/ipc')
    return jimengWebStartExtensionRunner()
  })
  ipcMain.handle('nomi:jimeng-web:stop-runner', async (event) => {
    assertTrustedSender(event)
    const { jimengWebStopExtensionRunner } = await import('./jimengWeb/ipc')
    return jimengWebStopExtensionRunner()
  })
}

function registerWorkspaceIpc(): void {
  const selectedWorkspaceRoots = new Set<string>()
  ipcMain.handle('nomi:workspace:select-folder', async (event) => {
    assertTrustedSender(event)
    const selection = await selectWorkspaceFolder({ showOpenDialog: (options) => dialog.showOpenDialog(options) })
    if (!selection.canceled) selectedWorkspaceRoots.add(selection.rootPath)
    return selection
  })
  ipcMain.handle('nomi:workspace:open-folder', (event, payload) => {
    assertTrustedSender(event)
    return openWorkspaceFolder(payload, {
      createProject,
      selectedRootPaths: selectedWorkspaceRoots,
      confirmInitialize: async (rootPath) => {
        const result = await dialog.showMessageBox({
          type: 'question',
          buttons: ['取消', '初始化'],
          defaultId: 1,
          cancelId: 0,
          message: '初始化 Nomi 项目文件夹？',
          detail: `Nomi 会在此文件夹创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/.\n\n${rootPath}`,
        })
        return result.response === 1
      },
    })
  })
  ipcMain.handle('nomi:workspace:list-files', (event, payload) => {
    assertTrustedSender(event)
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || '').trim()
    if (!projectId) throw new Error('projectId is required')
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null
    const rootPath = typeof project?.lastKnownRootPath === 'string' ? project.lastKnownRootPath : ''
    if (!rootPath) throw new Error('Project folder is unavailable')
    const limit = (payload as { limit?: unknown } | null)?.limit
    return listWorkspaceFiles({ rootPath, maxFiles: typeof limit === 'number' ? limit : undefined })
  })
  ipcMain.handle('nomi:workspace:reveal-file', (event, payload) => {
    assertTrustedSender(event)
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || '').trim()
    const relativePath = String((payload as { relativePath?: unknown } | null)?.relativePath || '').trim()
    if (!projectId) throw new Error('projectId is required')
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null
    const rootPath = typeof project?.lastKnownRootPath === 'string' ? path.resolve(project.lastKnownRootPath) : ''
    if (!rootPath) throw new Error('Project folder is unavailable')
    shell.showItemInFolder(resolveWorkspaceFilePath(rootPath, relativePath))
    return { ok: true }
  })
  registerWorkspaceFileDeleteIpc({ readProject })
  ipcMain.handle('nomi:workspace:reveal-project-folder', (event, payload) => {
    assertTrustedSender(event)
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || '').trim()
    if (!projectId) throw new Error('projectId is required')
    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null
    const rootPath = typeof project?.lastKnownRootPath === 'string' ? path.resolve(project.lastKnownRootPath) : ''
    if (!rootPath) throw new Error('Project folder is unavailable')
    void shell.openPath(rootPath)
    return { ok: true }
  })
}

function registerDirectorIpc(setCancelBlenderRendersOnQuit: (cancel: () => number) => void): void {
  ipcMain.handle('nomi:scene3d:render-blender', async (event, payload) => {
    assertTrustedSender(event)
    const blender = await import('./blender/blenderRunner')
    const director = await import('./blender/directorCli')
    setCancelBlenderRendersOnQuit(() => blender.cancelAllBlenderSceneRenders() + director.cancelAllDirectorBlenderRenders())
    return blender.runBlenderSceneRender(payload)
  })
  ipcMain.handle('nomi:scene3d:render-director-blender', async (event, payload) => {
    assertTrustedSender(event)
    const blender = await import('./blender/blenderRunner')
    const director = await import('./blender/directorCli')
    setCancelBlenderRendersOnQuit(() => blender.cancelAllBlenderSceneRenders() + director.cancelAllDirectorBlenderRenders())
    return director.runDirectorBlenderRender(payload)
  })
  ipcMain.handle('nomi:scene3d:cancel-blender', async (event, jobId) => {
    assertTrustedSender(event)
    const blender = await import('./blender/blenderRunner')
    const director = await import('./blender/directorCli')
    const normalizedJobId = String(jobId || '')
    return { cancelled: blender.cancelBlenderSceneRender(normalizedJobId) || director.cancelDirectorBlenderRender(normalizedJobId) }
  })
  ipcMain.handle('nomi:vibing-director:apply-blender-plan', async (event, payload) => {
    assertTrustedSender(event)
    const director = await import('./blender/vibingDirectorRunner')
    const blender = await import('./blender/blenderRunner')
    const legacyDirector = await import('./blender/directorCli')
    setCancelBlenderRendersOnQuit(() => (
      blender.cancelAllBlenderSceneRenders()
      + legacyDirector.cancelAllDirectorBlenderRenders()
      + director.cancelAllVibingDirectorBlenderPlans()
    ))
    return director.runVibingDirectorBlenderPlan(payload as Parameters<typeof director.runVibingDirectorBlenderPlan>[0])
  })
  ipcMain.handle('nomi:vibing-director:cancel-blender-plan', async (event, jobId) => {
    assertTrustedSender(event)
    const director = await import('./blender/vibingDirectorRunner')
    return { cancelled: director.cancelVibingDirectorBlenderPlan(String(jobId || '').trim()) }
  })
  ipcMain.handle('nomi:vibing-director:import-asset', async (event, payload) => {
    assertTrustedSender(event)
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (raw.source === 'kenney') throw new Error('Kenney 资产请使用 Director 内的开源资产目录导入')
    const selection = await dialog.showOpenDialog({
      title: '导入 Blender 资产',
      buttonLabel: '导入到 Director 资产库',
      properties: ['openFile'],
      filters: [{ name: 'Blender 资产', extensions: ['blend', 'glb', 'gltf', 'fbx', 'obj'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
    const assets = await import('./blender/vibingDirectorAssets')
    return assets.importVibingDirectorAsset({
      projectId: String(raw.projectId || ''),
      directorNodeId: String(raw.directorNodeId || ''),
      sourcePath: selection.filePaths[0],
      source: raw.source as Parameters<typeof assets.importVibingDirectorAsset>[0]['source'],
      ...(typeof raw.license === 'string' ? { license: raw.license } : {}),
    })
  })
  ipcMain.handle('nomi:vibing-director:import-existing-asset', async (event, payload) => {
    assertTrustedSender(event)
    const assets = await import('./blender/vibingDirectorAssets')
    return assets.importVibingDirectorAssetFromUrl(payload as Parameters<typeof assets.importVibingDirectorAssetFromUrl>[0])
  })
  ipcMain.handle('nomi:vibing-director:list-catalog-assets', async (event, payload) => {
    assertTrustedSender(event)
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const catalog = await import('./blender/vibingDirectorCatalog')
    return catalog.listVibingDirectorCatalogAssets(
      typeof raw.query === 'string' ? raw.query : '',
      typeof raw.limit === 'number' ? raw.limit : 60,
    )
  })
  ipcMain.handle('nomi:vibing-director:import-catalog-asset', async (event, payload) => {
    assertTrustedSender(event)
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const catalog = await import('./blender/vibingDirectorCatalog')
    return catalog.importVibingDirectorCatalogAsset({
      projectId: String(raw.projectId || ''),
      directorNodeId: String(raw.directorNodeId || ''),
      catalogAssetId: String(raw.catalogAssetId || ''),
      cacheDir: path.join(getSettingsRoot(), 'cache', 'vibing-director-catalog'),
    })
  })
  ipcMain.handle('nomi:vibing-director:open-blender', async (event, payload) => {
    assertTrustedSender(event)
    const director = await import('./blender/vibingDirectorRunner')
    return director.openVibingDirectorBlend(payload as Parameters<typeof director.openVibingDirectorBlend>[0])
  })
  ipcMain.handle('nomi:vibing-director:open-asset-source', async (event, source) => {
    assertTrustedSender(event)
    const urls = {
      kenney: 'https://kenney.nl/assets/furniture-kit',
      polyhaven: 'https://polyhaven.com/models',
      quaternius: 'https://quaternius.com/packs.html',
      blenderkit: 'https://www.blenderkit.com/asset-base/',
    } as const
    const key = String(source || '') as keyof typeof urls
    if (!urls[key]) throw new Error('不支持的 Director 资产来源')
    await shell.openExternal(urls[key])
    return { opened: true }
  })
}

export function registerDesktopIntegrationIpc(options: RegisterDesktopIntegrationIpcOptions): void {
  registerProviderLoginIpc()
  registerWorkspaceIpc()
  registerDirectorIpc(options.setCancelBlenderRendersOnQuit)
}
