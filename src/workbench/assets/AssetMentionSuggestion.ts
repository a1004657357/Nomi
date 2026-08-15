import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import AssetMentionSuggestionList, { type MentionSuggestionItem, type MentionSuggestionListRef } from './AssetMentionSuggestionList'

// 打 @ 唤起 suggestion(规范 §4 快捷路径)。候选由 getCandidates(query) 注入 —— 三组：
// 「当前参考」(已在 image_ref 槽里、与发送投影同一数组) / 「画布」已出图的节点 / 「素材库」。
// 后两组选中后**会先真的建立引用**(建边 / 落上传槽)再插 chip，由调用方的 onSelect 负责(见 mentionCandidates.ts)。
// query 现在**参与过滤**(候选多了、有名字可搜)，与旧版「打 @ 即全列」不同。
// 下拉用 ReactRenderer 渲染到 body(逃 composer overflow 裁剪)+ 向上翻转 + 视口 clamp(规范 §5 / 本会话遮挡教训)。

const MARGIN = 8
const GAP = 4

function positionPopup(el: HTMLElement, rect: DOMRect | null): void {
  if (!rect) return
  const h = el.offsetHeight || 44
  const w = el.offsetWidth || 200
  let top = rect.bottom + GAP
  if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, rect.top - GAP - h)
  let left = rect.left
  if (left + w > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - w
  left = Math.max(MARGIN, left)
  el.style.top = `${top}px`
  el.style.left = `${left}px`
}

export function createAssetMentionSuggestion(options: {
  getCandidates: (query: string) => MentionSuggestionItem[]
  /** 选中一条候选。返回最终该插的 chip 编号（建边/落槽后算出来的）；返回 null = 没插成（如能力校验没过）。 */
  onSelect: (item: MentionSuggestionItem) => number | null
}): Extension {
  return Extension.create({
    name: 'assetMentionSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '@',
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }): MentionSuggestionItem[] => options.getCandidates(query || ''),
          command: ({ editor, range, props }) => {
            const item = props as MentionSuggestionItem
            // 先建立真实引用（可能被能力校验拒），拿到最终编号再插 chip；拒了就只删掉 @ 触发段、不留假引用。
            const index = options.onSelect(item)
            const chain = editor.chain().focus().deleteRange(range)
            if (index === null) { chain.run(); return }
            chain.insertAssetMention(item.url, index).run()
          },
          render: () => {
            let renderer: ReactRenderer<MentionSuggestionListRef> | null = null
            let el: HTMLElement | null = null
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(AssetMentionSuggestionList, { props, editor: props.editor })
                el = document.createElement('div')
                el.style.position = 'fixed'
                el.style.zIndex = '60'
                document.body.appendChild(el)
                el.appendChild(renderer.element)
                positionPopup(el, props.clientRect?.() ?? null)
              },
              onUpdate: (props) => {
                renderer?.updateProps(props)
                if (el) positionPopup(el, props.clientRect?.() ?? null)
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') return true
                return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => {
                el?.remove()
                el = null
                renderer?.destroy()
                renderer = null
              },
            }
          },
        }),
      ]
    },
  })
}
