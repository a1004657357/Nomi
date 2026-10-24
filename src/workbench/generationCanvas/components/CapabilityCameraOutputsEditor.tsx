import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import { translateCanvasComponentText } from '../../../i18n/CanvasComponentText'
import { NomiSelect } from '../../../design'

export type CameraOutput = {
  id: string
  label: string
  azimuth: number
  elevation: number
  shotSize: string
}

function inputClass(): string {
  return 'h-8 min-w-0 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink outline-none focus:border-nomi-accent'
}

export function CapabilityCameraOutputsEditor({
  outputs,
  count,
  onChange,
}: {
  outputs: readonly CameraOutput[]
  count: number
  onChange: (index: number, patch: Partial<CameraOutput>) => void
}): JSX.Element {
  useTranslation()
  return (
    <div className="mt-3 divide-y divide-nomi-line border-y border-nomi-line">
      {outputs.slice(0, count).map((output, index) => (
        <div
          key={output.id}
          className="grid grid-cols-[minmax(80px,1fr)_72px_72px_88px] items-center gap-2 py-2"
        >
          <input
            className={inputClass()}
            aria-label={i18n.t("canvasComponents.cameraName", { v0: index + 1 })}
            value={output.label}
            onChange={(event) => onChange(index, { label: event.target.value })}
          />
          <input
            className={inputClass()}
            aria-label={i18n.t("canvasComponents.cameraAzimuth", { v0: index + 1 })}
            type="number"
            min={-180}
            max={180}
            value={output.azimuth}
            onChange={(event) => onChange(index, { azimuth: Number(event.target.value) })}
          />
          <input
            className={inputClass()}
            aria-label={i18n.t("canvasComponents.cameraElevation", { v0: index + 1 })}
            type="number"
            min={-30}
            max={30}
            value={output.elevation}
            onChange={(event) => onChange(index, { elevation: Number(event.target.value) })}
          />
          <NomiSelect
            ariaLabel={i18n.t("canvasComponents.cameraShotSize", { v0: index + 1 })}
            value={output.shotSize}
            options={['特写', '近景', '中景', '全景'].map((value) => ({ value, label: translateCanvasComponentText(value) }))}
            onChange={(value) => onChange(index, { shotSize: value })}
          />
        </div>
      ))}
    </div>
  )
}
