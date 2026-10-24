import type { JSX } from 'react'
import React from 'react'
import { IconPhoto, IconTerminal2 } from '@tabler/icons-react'

export const CODEX_IMAGEGEN_VENDOR_KEY = 'codex'

export function CodexImagegenManage(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-nomi-line-soft pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 max-w-full items-center gap-2 [overflow-wrap:anywhere]">
          <IconTerminal2 size={16} stroke={1.7} className="shrink-0 text-nomi-ink-60" />
          <span className="text-caption font-medium text-nomi-ink-80">本机 Codex 图片通道</span>
        </div>
        <span className="min-w-0 max-w-full rounded-full bg-workbench-success-soft px-2 py-0.5 text-micro text-workbench-success [overflow-wrap:anywhere]">
          无需 API Key
        </span>
      </div>
      <div className="flex gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2">
        <IconPhoto size={15} stroke={1.6} className="mt-0.5 shrink-0 text-nomi-ink-40" />
        <div className="text-caption leading-relaxed text-nomi-ink-60">
          Nomi 使用本机 ChatGPT/Codex 登录态调用内置 <span className="font-medium text-nomi-ink-80">image_gen.imagegen</span>，
          生成完成后自动写回当前项目素材。未登录时会直接提示先登录，失败不会自动重复提交。
        </div>
      </div>
    </div>
  )
}
