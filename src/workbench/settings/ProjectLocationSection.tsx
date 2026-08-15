import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconFolderOpen, IconRefresh, IconSettings } from '@tabler/icons-react'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type {
  DesktopProjectLocation,
  DesktopProjectLocationError,
  DesktopProjectLocationResult,
} from '../../desktop/settingsBridge'
import { toast } from '../../ui/toast'

const ERROR_KEY: Record<DesktopProjectLocationError, string> = {
  'not-directory': 'settings.file.projectLocationErrorNotDirectory',
  'not-writable': 'settings.file.projectLocationErrorNotWritable',
  'open-failed': 'settings.file.projectLocationErrorOpenFailed',
  'managed-by-environment': 'settings.file.projectLocationManaged',
}

export function ProjectLocationSection(): JSX.Element {
  const { t } = useTranslation()
  const [location, setLocation] = React.useState<DesktopProjectLocation | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let active = true
    const api = getDesktopBridge()?.settings?.projectLocation
    if (!api) {
      setLoading(false)
      return () => { active = false }
    }
    void api.get()
      .then((result) => {
        if (active && result.ok) setLocation(result.location)
      })
      .catch(() => {
        if (active) toast(t('settings.file.projectLocationErrorUnknown'), 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t])

  const run = async (action: () => Promise<DesktopProjectLocationResult>): Promise<void> => {
    setBusy(true)
    try {
      const result = await action()
      if (result.ok) {
        if (!result.canceled) setLocation(result.location)
      } else {
        toast(t(ERROR_KEY[result.error]), 'error')
      }
    } catch {
      toast(t('settings.file.projectLocationErrorUnknown'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const api = getDesktopBridge()?.settings?.projectLocation
  const managed = location?.source === 'environment'
  const unavailable = loading || busy || !api

  return (
    <div className="border-t border-nomi-line pt-4" data-settings-project-location aria-busy={loading || busy}>
      <div className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.file.projectLocation')}</div>
      <div
        className="truncate rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 font-mono text-caption text-nomi-ink-60"
        data-project-location-path
        title={location?.path || undefined}
      >
        {location?.path || (loading ? t('settings.file.projectLocationLoading') : t('settings.file.projectLocationUnavailable'))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <DesignButton
          type="button"
          variant="filled"
          disabled={unavailable || managed}
          leftSection={<IconSettings size={14} stroke={1.7} aria-hidden="true" />}
          onClick={() => { if (api) void run(api.pick) }}
        >
          {t('settings.file.projectLocationChange')}
        </DesignButton>
        <DesignButton
          type="button"
          variant="default"
          disabled={unavailable || !location}
          leftSection={<IconFolderOpen size={14} stroke={1.7} aria-hidden="true" />}
          onClick={() => { if (api) void run(api.reveal) }}
        >
          {t('settings.file.projectLocationReveal')}
        </DesignButton>
        {location?.source === 'custom' ? (
          <DesignButton
            type="button"
            variant="subtle"
            disabled={unavailable}
            leftSection={<IconRefresh size={14} stroke={1.7} aria-hidden="true" />}
            onClick={() => { if (api) void run(api.reset) }}
          >
            {t('settings.file.projectLocationReset')}
          </DesignButton>
        ) : null}
      </div>

      <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">
        {managed ? t('settings.file.projectLocationManaged') : t('settings.file.projectLocationHint')}
      </div>
    </div>
  )
}
