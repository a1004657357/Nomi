export type DesktopWebBridgeRunnerStatus = {
  available: boolean
  running: boolean
  browserOpen: boolean
  serverManaged: boolean
  clientOnline: boolean
  engine: 'electron'
  drawerReady?: boolean
  fallbackPanelOpen?: boolean
  extensionDir?: string
  userDataDir?: string
  serverPid?: number
  extensionId?: string
  panelUrl?: string
  jimengUrl?: string
  pavoUrl?: string
  error?: string
  lastLog?: string
}

export type DesktopWebBridgeStatus = {
  server: {
    ok: boolean
    serverUrl: string
    error?: string
    version?: string
    sseClients?: number
    taskTotal?: number
  }
  runner: DesktopWebBridgeRunnerStatus
  loginWindowOpen: boolean
  cookieCount: number
  likelyLoggedIn: boolean
  loginUrl: string
}

export type DesktopWebBridge = {
  status: () => Promise<DesktopWebBridgeStatus>
  openLogin: () => Promise<{ ok: boolean; url: string }>
  openAdmin: (baseUrl?: string) => Promise<{ ok: boolean; url: string }>
  startRunner: () => Promise<DesktopWebBridgeRunnerStatus>
  stopRunner: () => Promise<DesktopWebBridgeRunnerStatus>
}
