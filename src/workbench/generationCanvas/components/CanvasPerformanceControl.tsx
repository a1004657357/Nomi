import type { JSX } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustmentsHorizontal } from '../../../vendor/tablerIcons'
import { CanvasNavigationTooltipButton } from './CanvasNavigationTooltipButton'
import { setCanvasPerformancePreference, useCanvasPerformancePreference } from './useCanvasPerformance'

export function CanvasPerformanceControl(): JSX.Element {
  const { t } = useTranslation()
  const smooth = useCanvasPerformancePreference() === 'smooth'
  return (
    <CanvasNavigationTooltipButton
      label={t('canvas.smoothMode')}
      aria-pressed={smooth}
      className={smooth ? 'bg-nomi-accent-soft text-nomi-accent' : undefined}
      onClick={() => setCanvasPerformancePreference(smooth ? 'auto' : 'smooth')}
    >
      <IconAdjustmentsHorizontal size={15} stroke={1.8} aria-hidden="true" />
    </CanvasNavigationTooltipButton>
  )
}
