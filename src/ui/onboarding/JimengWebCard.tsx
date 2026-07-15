/**
 * 即梦 Web（实验）接入卡。
 *
 * 这不是 API key 供应商，而是本机网页登录/扩展桥通道：模型已内置可选；
 * 可用性取决于 Nomi 专用 Seedance 扩展任务服务是否在 127.0.0.1:3457 运行，以及即梦网页账号状态。
 */
import React from 'react'
import {
  IconServerBolt,
  IconExternalLink,
  IconCircleCheck,
  IconAlertCircle,
  IconRefresh,
  IconPlayerStopFilled,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'

export type JimengWebStatus = {
  server: { ok: boolean; serverUrl: string; error?: string; version?: string; sseClients?: number; taskTotal?: number }
  runner: {
    available: boolean
    running: boolean
    browserOpen: boolean
    serverManaged: boolean
    clientOnline: boolean
    engine: 'electron'
    drawerReady: boolean
    fallbackPanelOpen: boolean
    extensionDir?: string
    userDataDir?: string
    serverPid?: number
    extensionId?: string
    panelUrl?: string
    jimengUrl: string
    error?: string
    lastLog?: string
  }
  loginWindowOpen: boolean
  cookieCount: number
  likelyLoggedIn: boolean
  loginUrl: string
}

type Props = {
  status: JimengWebStatus | null
  onChanged: () => void
}

export function JimengWebCard({ status, onChanged }: Props): JSX.Element | null {
  const jimengWeb = getDesktopBridge()?.jimengWeb
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  if (!jimengWeb || !status) return null

  const openLogin = async () => {
    setBusy(true)
    setError('')
    try {
      await jimengWeb.openLogin()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openAdmin = async () => {
    setBusy(true)
    setError('')
    try {
      await jimengWeb.openAdmin(status.server.serverUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startRunner = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await jimengWeb.startRunner()
      if (next.error) setError(next.error)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stopRunner = async () => {
    setBusy(true)
    setError('')
    try {
      await jimengWeb.stopRunner()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const refresh = () => {
    onChanged()
    toast('已刷新即梦 Web 状态', 'success')
  }

  const connected = status.server.ok
  const clientOnline = connected && (status.server.sseClients || 0) > 0
  const statusLabel = clientOnline ? '扩展在线' : connected ? '服务在线' : '待启动'

  return (
    <FoldableModelCard
      glyph={<IconServerBolt size={16} stroke={1.6} />}
      glyphTone="ink"
      name="即梦 Web"
      subtitle="网页登录实验通道 · Seedance 扩展桥"
      status={connected ? 'ok' : 'todo'}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {connected ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
          <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">本地扩展桥在线</div>
            <div className="text-caption text-nomi-ink-60 mt-0.5">
              {status.server.serverUrl}
              {status.server.sseClients != null ? ` · 扩展客户端 ${status.server.sseClients}` : ''}
              {status.server.taskTotal != null ? ` · 任务 ${status.server.taskTotal}` : ''}
              {status.runner.browserOpen ? ' · Nomi Electron' : ''}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-nomi-sm border border-workbench-danger/30 bg-workbench-danger/5 px-3 py-2.5">
          <IconAlertCircle size={17} className="shrink-0 mt-0.5 text-workbench-danger" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">本地扩展桥未连接</div>
            <div className="text-caption text-nomi-ink-60 mt-0.5">
              可由 Nomi 启动 Seedance 扩展运行器，或继续手动运行 <code className="font-mono">node mock-server.js</code>
              。
            </div>
          </div>
        </div>
      )}

      {connected && !clientOnline ? (
        <div className="flex items-start gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
          <IconAlertCircle size={17} className="shrink-0 mt-0.5 text-nomi-ink-40" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">任务服务在线，扩展客户端未在线</div>
            <div className="text-caption text-nomi-ink-60 mt-0.5">
              启动运行器后，扩展面板会保持 SSE 连接并领取 Nomi 推送的任务。
            </div>
          </div>
        </div>
      ) : null}

      <div className="text-caption text-nomi-ink-60 leading-relaxed">
        在生成画布选择「即梦 Web Seedance 2.0（实验）」后，Nomi
        会把任务推给本机扩展桥；扩展完成上传后，视频会自动写回当前项目画布。
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={startRunner}
          disabled={busy || !status.runner.available}
          className={cn(
            'h-9 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink',
            'inline-flex items-center justify-center gap-1.5 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50',
          )}
        >
          启动运行器
          <IconServerBolt size={14} stroke={1.6} />
        </button>
        <button
          type="button"
          onClick={stopRunner}
          disabled={busy || !status.runner.browserOpen}
          className={cn(
            'h-9 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink',
            'inline-flex items-center justify-center gap-1.5 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50',
          )}
        >
          停止运行器
          <IconPlayerStopFilled size={14} />
        </button>
        <button
          type="button"
          onClick={openLogin}
          disabled={busy}
          className={cn(
            'h-9 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink',
            'inline-flex items-center justify-center gap-1.5 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50',
          )}
        >
          登录网页
          <IconExternalLink size={14} stroke={1.6} />
        </button>
        <button
          type="button"
          onClick={openAdmin}
          disabled={busy}
          className={cn(
            'h-9 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink',
            'inline-flex items-center justify-center gap-1.5 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50',
          )}
        >
          扩展管理
          <IconExternalLink size={14} stroke={1.6} />
        </button>
      </div>

      <button
        type="button"
        onClick={refresh}
        className="self-start h-8 px-2 text-caption text-nomi-ink-50 inline-flex items-center gap-1 hover:text-nomi-accent"
      >
        <IconRefresh size={13} stroke={1.7} />
        刷新状态
      </button>

      {status.likelyLoggedIn ? (
        <div className="text-micro text-nomi-ink-40">
          Electron 即梦会话已有 cookie；扩展桥生成仍以扩展所在浏览器的即梦登录态为准。
        </div>
      ) : null}
      {status.runner.extensionDir ? (
        <div className="text-micro text-nomi-ink-40 truncate">扩展目录：{status.runner.extensionDir}</div>
      ) : null}
      {status.runner.userDataDir ? (
        <div className="text-micro text-nomi-ink-40 truncate">运行器会话：{status.runner.userDataDir}</div>
      ) : null}
      {status.runner.browserOpen ? (
        <div className="text-micro text-nomi-ink-40">
          运行内核：Nomi 内置 Electron
          {status.runner.drawerReady ? ' · 即梦页抽屉已注入' : status.runner.fallbackPanelOpen ? ' · 后台面板保底' : ''}
        </div>
      ) : null}
      {!status.runner.available ? (
        <div className="text-caption text-workbench-danger">
          未找到 Seedance 扩展目录；可设置 NOMI_SEEDANCE_EXTENSION_DIR。
        </div>
      ) : null}
      {status.server.error ? <div className="text-caption text-workbench-danger">{status.server.error}</div> : null}
      {status.runner.error ? <div className="text-caption text-workbench-danger">{status.runner.error}</div> : null}
      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
