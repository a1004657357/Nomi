import React from 'react'
import {
  IconAlertCircle,
  IconCircleCheck,
  IconExternalLink,
  IconPlayerStopFilled,
  IconRefresh,
  IconServerBolt,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { cn } from '../../utils/cn'
import { FoldableModelCard } from './FoldableModelCard'

export type WebBridgeStatus = {
  server: {
    ok: boolean
    serverUrl: string
    error?: string
    sseClients?: number
    taskTotal?: number
  }
  runner: {
    available: boolean
    browserOpen: boolean
    clientOnline: boolean
    extensionDir?: string
    userDataDir?: string
    error?: string
  }
  cookieCount: number
  likelyLoggedIn: boolean
}

type WebBridgeApi = {
  openLogin: () => Promise<unknown>
  openAdmin: (baseUrl?: string) => Promise<unknown>
  startRunner: () => Promise<{ error?: string }>
  stopRunner: () => Promise<unknown>
}

type Props = {
  bridgeKey: 'jimengWeb' | 'pavoWeb'
  name: string
  subtitle: string
  description: string
  status: WebBridgeStatus | null
  onChanged: () => void
}

export function WebBridgeConnectionCard({ bridgeKey, name, subtitle, description, status, onChanged }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const api = getDesktopBridge()?.[bridgeKey] as WebBridgeApi | undefined
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  if (!api || !status) return null

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      const result = await operation() as { error?: string } | undefined
      if (result?.error) setError(result.error)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const connected = status.server.ok
  const clientOnline = connected && (status.runner.clientOnline || (status.server.sseClients ?? 0) > 0)
  const statusLabel = clientOnline
    ? t('onboardingProviders.webBridge.status.clientOnline')
    : connected
      ? t('onboardingProviders.webBridge.status.serverOnline')
      : t('onboardingProviders.webBridge.status.waiting')

  return (
    <FoldableModelCard
      glyph={<IconServerBolt size={16} stroke={1.6} />}
      glyphTone="ink"
      name={name}
      subtitle={subtitle}
      status={connected ? 'ok' : 'todo'}
      statusLabel={statusLabel}
      defaultExpanded
    >
      {connected ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
          <IconCircleCheck size={17} className="mt-0.5 shrink-0 text-workbench-success" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.webBridge.bridgeOnline')}</div>
            <div className="mt-0.5 text-caption text-nomi-ink-60">
              {status.server.serverUrl}
              {status.server.sseClients != null ? ` · ${t('onboardingProviders.webBridge.clients', { count: status.server.sseClients })}` : ''}
              {status.server.taskTotal != null ? ` · ${t('onboardingProviders.webBridge.tasks', { count: status.server.taskTotal })}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-nomi-sm border border-workbench-danger/30 bg-workbench-danger/5 px-3 py-2.5">
          <IconAlertCircle size={17} className="mt-0.5 shrink-0 text-workbench-danger" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.webBridge.bridgeOffline')}</div>
            <div className="mt-0.5 text-caption text-nomi-ink-60">{t('onboardingProviders.webBridge.bridgeOfflineHint')}</div>
          </div>
        </div>
      )}

      {connected && !clientOnline ? (
        <div className="flex items-start gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
          <IconAlertCircle size={17} className="mt-0.5 shrink-0 text-nomi-ink-40" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.webBridge.clientOffline')}</div>
            <div className="mt-0.5 text-caption text-nomi-ink-60">{t('onboardingProviders.webBridge.clientOfflineHint')}</div>
          </div>
        </div>
      ) : null}

      <div className="text-caption leading-relaxed text-nomi-ink-60">{description}</div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void run(api.startRunner)} disabled={busy || !status.runner.available}
          className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink', 'hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50')}>
          {t('onboardingProviders.webBridge.start')}
          <IconServerBolt size={14} stroke={1.6} />
        </button>
        <button type="button" onClick={() => void run(api.stopRunner)} disabled={busy || !status.runner.browserOpen}
          className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink', 'hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50')}>
          {t('onboardingProviders.webBridge.stop')}
          <IconPlayerStopFilled size={14} />
        </button>
        <button type="button" onClick={() => void run(api.openLogin)} disabled={busy}
          className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink', 'hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50')}>
          {t('onboardingProviders.webBridge.login')}
          <IconExternalLink size={14} stroke={1.6} />
        </button>
        <button type="button" onClick={() => void run(() => api.openAdmin(status.server.serverUrl))} disabled={busy}
          className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line text-body-sm text-nomi-ink', 'hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-50')}>
          {t('onboardingProviders.webBridge.admin')}
          <IconExternalLink size={14} stroke={1.6} />
        </button>
      </div>

      <button type="button" onClick={() => { onChanged(); toast(t('onboardingProviders.webBridge.refreshed'), 'success') }}
        className="inline-flex h-8 items-center gap-1 self-start px-2 text-caption text-nomi-ink-50 hover:text-nomi-accent">
        <IconRefresh size={13} stroke={1.7} />
        {t('onboardingProviders.webBridge.refresh')}
      </button>

      <div className="text-micro text-nomi-ink-40">
        {status.likelyLoggedIn
          ? t('onboardingProviders.webBridge.cookiesFound', { count: status.cookieCount })
          : t('onboardingProviders.webBridge.loginRequired')}
      </div>
      {status.runner.extensionDir ? <div className="truncate text-micro text-nomi-ink-40">{t('onboardingProviders.webBridge.extensionDir', { path: status.runner.extensionDir })}</div> : null}
      {status.runner.userDataDir ? <div className="truncate text-micro text-nomi-ink-40">{t('onboardingProviders.webBridge.sessionDir', { path: status.runner.userDataDir })}</div> : null}
      {!status.runner.available ? <div className="text-caption text-workbench-danger">{t('onboardingProviders.webBridge.extensionMissing')}</div> : null}
      {status.server.error ? <div className="text-caption text-workbench-danger">{status.server.error}</div> : null}
      {status.runner.error ? <div className="text-caption text-workbench-danger">{status.runner.error}</div> : null}
      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
