import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconAdjustmentsHorizontal, IconFolder, IconInfoCircle, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignSwitch } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'

// 集中设置页（2026-08-01 用户拍板样张）：左 tab 右内容。首批「文件与保存」做实——自动另存开关+目录；
// 其余 tab 占位。复用 OnboardingFloatingPanel 的外壳交互（Portal + Esc + 点遮罩关），布局是居中大 modal。
type SettingsTab = 'file' | 'general' | 'about'

const TABS: { id: SettingsTab; icon: typeof IconFolder; labelKey: string }[] = [
  { id: 'file', icon: IconFolder, labelKey: 'settings.tab.file' },
  { id: 'general', icon: IconAdjustmentsHorizontal, labelKey: 'settings.tab.general' },
  { id: 'about', icon: IconInfoCircle, labelKey: 'settings.tab.about' },
]

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<SettingsTab>('file')
  const [enabled, setEnabled] = React.useState(false)
  const [dir, setDir] = React.useState('')

  // 打开时读当前偏好（主进程 download-prefs.json）。
  React.useEffect(() => {
    void getDesktopBridge()
      ?.assets?.getAutoSavePrefs?.()
      .then((prefs) => {
        if (!prefs) return
        setEnabled(Boolean(prefs.enabled))
        setDir(String(prefs.dir || ''))
      })
      .catch(() => undefined)
  }, [])

  // capture 阶段拦 Esc：先于画布/素材库的 window keydown 关自己（不误触删节点等）。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const persist = React.useCallback((nextEnabled: boolean, nextDir: string): void => {
    void getDesktopBridge()?.assets?.setAutoSavePrefs?.({ enabled: nextEnabled, dir: nextDir }).catch(() => undefined)
  }, [])

  const onToggle = (next: boolean): void => {
    setEnabled(next)
    persist(next, dir)
  }
  const onPickDir = async (): Promise<void> => {
    const res = await getDesktopBridge()?.assets?.pickSaveDir?.()
    if (res?.dir) {
      setDir(res.dir)
      persist(enabled, res.dir)
    }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/45 p-6"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          className="flex max-w-full overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg"
          style={{ width: 600, height: 420 }}
        >
          <aside className="flex w-[168px] flex-none flex-col gap-0.5 border-r border-nomi-line bg-nomi-ink-05 p-3.5">
            <div className="px-3 pb-3 pt-1 text-body-sm font-medium text-nomi-ink">{t('settings.title')}</div>
            {TABS.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-nomi-sm border-0 px-3 py-2 text-left text-body-sm cursor-pointer',
                  tab === id ? 'bg-nomi-ink text-nomi-paper' : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onClick={() => setTab(id)}
              >
                <Icon size={16} stroke={1.7} aria-hidden="true" /> {t(labelKey)}
              </button>
            ))}
          </aside>

          <section className="relative min-w-0 flex-1 overflow-y-auto p-6">
            <button
              type="button"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent cursor-pointer text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
              aria-label={t('settings.close')}
              onClick={onClose}
            >
              <IconX size={16} stroke={1.8} aria-hidden="true" />
            </button>

            {tab === 'file' ? (
              <div>
                <div className="mb-4 text-body font-medium text-nomi-ink">{t('settings.file.title')}</div>

                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-body-sm text-nomi-ink">{t('settings.file.autoSave')}</span>
                  <DesignSwitch
                    checked={enabled}
                    onChange={(event) => onToggle(event.currentTarget.checked)}
                    aria-label={t('settings.file.autoSave')}
                  />
                </div>
                <div className="mb-4 text-caption leading-relaxed text-nomi-ink-40">{t('settings.file.autoSaveHint')}</div>

                <div className={cn('mb-5', !enabled && 'pointer-events-none opacity-45')}>
                  <div className="mb-1.5 text-caption text-nomi-ink-60">{t('settings.file.saveTo')}</div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 font-mono text-caption text-nomi-ink-60">
                      {dir || t('settings.file.noDir')}
                    </div>
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => void onPickDir()}
                      className="inline-flex flex-none items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2 text-caption text-nomi-ink cursor-pointer hover:bg-nomi-ink-05 disabled:cursor-not-allowed"
                    >
                      <IconFolder size={14} stroke={1.7} aria-hidden="true" /> {t('settings.file.pick')}
                    </button>
                  </div>
                </div>

                <div className="border-t border-nomi-line pt-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-body-sm text-nomi-ink-60">{t('settings.file.saveRoot')}</span>
                    <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-40">{t('settings.file.laterTag')}</span>
                  </div>
                  <div className="text-caption leading-relaxed text-nomi-ink-40">{t('settings.file.saveRootHint')}</div>
                </div>
              </div>
            ) : (
              <div className="pt-10 text-center text-caption text-nomi-ink-40">{t('settings.placeholder')}</div>
            )}
          </section>
        </div>
      </div>
    </Portal>
  )
}
