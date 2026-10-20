import type { JSX } from 'react'
import React from 'react'
import {
  IconArrowsMove,
  IconCube,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconRoute,
  IconRotate,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import type { Scene3DTransformMode } from './scene3dTypes'
import { PanelButton } from './scene3dToolbar'

type Scene3DFullscreenToolbarProps = {
  nodeTitle: string
  transformMode: Scene3DTransformMode
  onTransformModeChange: (mode: Scene3DTransformMode) => void
  onCaptureViewport: () => void
  trajectoryMode: boolean
  trajectoryPlaying: boolean
  onToggleTrajectoryMode: () => void
  onTrajectoryPlayChange: (playing: boolean) => void
  characterPossessButton?: React.ReactNode
  flySpeed: number
  onFlySpeedChange: (speed: number) => void
  onClose: () => void
}

export function Scene3DFullscreenToolbar({
  nodeTitle,
  transformMode,
  onTransformModeChange,
  onCaptureViewport,
  trajectoryMode,
  trajectoryPlaying,
  onToggleTrajectoryMode,
  onTrajectoryPlayChange,
  characterPossessButton,
  flySpeed,
  onFlySpeedChange,
  onClose,
}: Scene3DFullscreenToolbarProps): JSX.Element {
  return (
    <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
        <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
      </div>
      <div className="ml-auto flex min-w-0 max-w-[72vw] items-center gap-2 overflow-x-auto">
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title="移动" active={transformMode === 'translate'} onClick={() => onTransformModeChange('translate')}>
            <IconArrowsMove size={15} />
          </PanelButton>
          <PanelButton title="旋转" active={transformMode === 'rotate'} onClick={() => onTransformModeChange('rotate')}>
            <IconRotate size={15} />
          </PanelButton>
        </div>
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title="当前视口截图" onClick={onCaptureViewport}>
            <IconPhoto size={15} />
            <span>截图</span>
          </PanelButton>
        </div>
        <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
          <PanelButton title={trajectoryMode ? '退出轨迹模式' : '进入轨迹模式'} active={trajectoryMode} onClick={onToggleTrajectoryMode}>
            <IconRoute size={15} />
            <span>轨迹</span>
          </PanelButton>
          <PanelButton
            title={trajectoryPlaying ? '暂停轨迹播放' : '播放轨迹'}
            active={trajectoryPlaying}
            onClick={() => onTrajectoryPlayChange(!trajectoryPlaying)}
          >
            {trajectoryPlaying ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
          </PanelButton>
        </div>
        {characterPossessButton}
        <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-muted)]">
          <IconWorld size={14} />
          <span>速度</span>
          <input
            className="h-1.5 w-24 accent-[var(--nomi-ink)]"
            max={16}
            min={1}
            step={0.5}
            type="range"
            value={flySpeed}
            onChange={(event) => onFlySpeedChange(Number(event.currentTarget.value))}
          />
        </label>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title="退出 3D 场景"
          onClick={onClose}
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  )
}
