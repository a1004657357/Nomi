import React from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import { IconFileImport, IconSparkles } from '@tabler/icons-react'
import SelectionGeneratePopover from './SelectionGeneratePopover'
import { confirmDialog } from '../../design'
import { WorkbenchButton, WorkbenchIconButton } from '../../design/actions'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../../ui/toast'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { normalizeWorkbenchContentJson, type CreationDocumentTools } from '../workbenchTypes'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { useNomiRichTextEditor } from '../common/useNomiRichTextEditor'
import { buildRichTextActions, type RichTextAction } from '../common/richTextActions'
import { extractWorkbenchDocumentText } from './creationAiModes'
import { requestFixationPlanning } from '../generationCanvas/agent/fixationLauncher'
import {
  buildImportedWorkbenchDocument,
  SCRIPT_IMPORT_ACCEPT,
  SCRIPT_IMPORT_MAX_BYTES,
} from './scriptImportModel'

// 工具栏分组：格式按语义分 3 簇（强调 / 标题 / 列表·引用）靠左，历史（撤销/重做）推到右端。
// 之前用一个 flex-1 spacer 把 9 个按钮全挤到左侧、右边 ~570px 浪费 —— 这里按语义两端锚定。
const TOOLBAR_LEFT_GROUPS: readonly (readonly string[])[] = [
  ['bold', 'italic'],
  ['h1', 'h2'],
  ['bullet-list', 'ordered-list', 'blockquote'],
]
const TOOLBAR_RIGHT_GROUP: readonly string[] = ['undo', 'redo']

function ToolbarButton({ action }: { action: RichTextAction }): JSX.Element {
  return (
    <WorkbenchIconButton
      className={cn(
        'workbench-editor-toolbar__button',
        'w-[30px] h-[30px] inline-grid place-items-center',
        'border border-transparent rounded-nomi-sm',
        'bg-transparent text-workbench-muted cursor-pointer',
        'hover:bg-workbench-hover',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
      )}
      label={action.label}
      data-active={action.active ? 'true' : 'false'}
      disabled={action.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action.onClick}
      icon={action.icon}
    />
  )
}

function ToolbarDivider(): JSX.Element {
  return <div className="w-px h-[18px] bg-workbench-border mx-1" aria-hidden="true" />
}

function WorkbenchEditorToolbar({
  editor,
  canExtract,
  onImportScript,
  onExtractAssets,
}: {
  editor: Editor | null
  canExtract: boolean
  onImportScript: () => void
  onExtractAssets: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const actions = buildRichTextActions(editor)
  const byId = new Map(actions.map((action) => [action.id, action]))
  const pick = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((a): a is RichTextAction => Boolean(a))
  const leftGroups = TOOLBAR_LEFT_GROUPS.map(pick).filter((group) => group.length > 0)
  const rightGroup = pick(TOOLBAR_RIGHT_GROUP)
  return (
    <div
      className={cn(
        'workbench-editor-toolbar',
        'h-[44px] flex items-center gap-1 px-3',
        'border-b border-workbench-border-soft bg-workbench-surface',
      )}
      aria-label={t('creationAi.editor.toolbarAria')}
    >
      <WorkbenchIconButton
        className="workbench-editor-toolbar__button size-[30px]"
        label="导入剧本"
        onClick={onImportScript}
        icon={<IconFileImport size={16} />}
      />
      <WorkbenchButton
        className="h-[30px] px-2 text-body-sm whitespace-nowrap"
        disabled={!canExtract}
        title={canExtract ? '提取角色、场景和道具参考卡' : '请先写入或导入剧本'}
        onClick={onExtractAssets}
      >
        <IconSparkles size={15} />
        提取设定
      </WorkbenchButton>
      {leftGroups.length > 0 ? <ToolbarDivider /> : null}
      {leftGroups.map((group, index) => (
        <React.Fragment key={group[0]?.id ?? index}>
          {index > 0 ? <ToolbarDivider /> : null}
          {group.map((action) => (
            <ToolbarButton key={action.id} action={action} />
          ))}
        </React.Fragment>
      ))}
      <div className="flex-1" aria-hidden="true" />
      {rightGroup.map((action) => (
        <ToolbarButton key={action.id} action={action} />
      ))}
    </div>
  )
}

export default function WorkbenchEditor(): JSX.Element {
  const { t } = useTranslation()
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const setWorkbenchDocument = useWorkbenchStore((state) => state.setWorkbenchDocument)
  const setCreationDocumentTools = useWorkbenchStore((state) => state.setCreationDocumentTools)
  const setCreationSelectionText = useWorkbenchStore((state) => state.setCreationSelectionText)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const storyboardPlannerLauncher = useWorkbenchStore((state) => state.storyboardPlannerLauncher)
  const [selectionState, setSelectionState] = React.useState({ text: '', version: 0 })
  const scrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocumentRef = React.useRef(workbenchDocument)
  const scriptInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    workbenchDocumentRef.current = workbenchDocument
  }, [workbenchDocument])

  const editorContent = React.useMemo(
    () => normalizeWorkbenchContentJson(workbenchDocument.contentJson) as JSONContent,
    [workbenchDocument.contentJson],
  )

  const handleChange = React.useCallback(
    (contentJson: JSONContent) => {
      setWorkbenchDocument({ ...workbenchDocumentRef.current, contentJson, updatedAt: Date.now() })
    },
    [setWorkbenchDocument],
  )

  const handleSelectionChange = React.useCallback(
    (text: string) => {
      setSelectionState((current) => {
        if (!current.text && !text.trim()) return current
        return { text, version: current.version + 1 }
      })
      setCreationSelectionText(text)
    },
    [setCreationSelectionText],
  )

  const clearSelectionText = React.useCallback(() => {
    setSelectionState((current) => ({ text: '', version: current.version + 1 }))
    setCreationSelectionText('')
  }, [setCreationSelectionText])

  const { editor, tools } = useNomiRichTextEditor({
    content: editorContent,
    placeholder: t('creationAi.editor.placeholder'),
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
  })

  const documentText = React.useMemo(
    () => extractWorkbenchDocumentText(workbenchDocument),
    [workbenchDocument],
  )

  const handleScriptFile = React.useCallback(async (file: File) => {
    if (file.size > SCRIPT_IMPORT_MAX_BYTES) {
      toast('剧本文件不能超过 20 MB', 'error')
      return
    }
    if (documentText) {
      const confirmed = await confirmDialog({
        title: '替换当前文稿？',
        message: '导入剧本会替换创作区当前文稿，画布中的已有节点不会改变。',
        confirmLabel: '继续导入',
      })
      if (!confirmed) return
    }
    try {
      const bridge = getDesktopBridge()
      let text = ''
      if (bridge?.files?.extractText) {
        const result = await bridge.files.extractText({
          fileName: file.name,
          contentType: file.type,
          bytes: await file.arrayBuffer(),
        })
        text = result.text
      } else if (/\.(?:txt|md|markdown|csv)$/i.test(file.name)) {
        text = await file.text()
      } else {
        throw new Error('当前运行环境不支持解析这个剧本文件')
      }
      if (!text.trim()) throw new Error('剧本文件没有可读取的文字')
      setWorkbenchDocument(buildImportedWorkbenchDocument(text, file.name))
      clearSelectionText()
      toast(`已导入《${file.name}》`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '剧本导入失败', 'error')
    }
  }, [clearSelectionText, documentText, setWorkbenchDocument])

  const handleExtractAssets = React.useCallback(() => {
    const storyText = extractWorkbenchDocumentText(workbenchDocumentRef.current)
    if (!storyText) {
      toast('请先写入或导入剧本', 'warning')
      return
    }
    setWorkspaceMode('generation')
    window.setTimeout(() => {
      requestFixationPlanning({ storyText, source: 'script-import-toolbar' })
    }, 60)
    toast('正在整理角色、场景和道具，请在 Agent 计划卡确认', 'info')
  }, [setWorkspaceMode])

  // Publish creation document tools = the shared rich-text read/write surface (read full/selection,
  // insert/replace/append). The AI panel reads these to apply approved write-tool calls.
  const creationDocumentToolsRef = React.useRef<CreationDocumentTools | null>(null)
  React.useEffect(() => {
    if (!editor) return
    const toolsApi: CreationDocumentTools = {
      readFullText: tools.readFullText,
      readSelectionText: tools.readSelectionText,
      insertAtCursor: tools.insertAtCursor,
      replaceSelection: tools.replaceSelection,
      appendToEnd: tools.appendToEnd,
    }
    setCreationDocumentTools(toolsApi)
    creationDocumentToolsRef.current = toolsApi
    return () => {
      if (creationDocumentToolsRef.current === toolsApi) {
        setCreationDocumentTools(null)
        creationDocumentToolsRef.current = null
      }
    }
  }, [editor, tools, setCreationDocumentTools])

  return (
    <section
      className={cn(
        'workbench-editor',
        'relative w-full h-full min-h-0',
        'grid grid-rows-[44px_minmax(0,1fr)]',
        'border border-workbench-border rounded-workbench',
        'bg-workbench-surface-solid shadow-workbench-md',
        'overflow-hidden',
      )}
      aria-label={t('creationAi.editor.documentAria')}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <input
        ref={scriptInputRef}
        className="hidden"
        type="file"
        accept={SCRIPT_IMPORT_ACCEPT}
        aria-label="选择剧本文件"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void handleScriptFile(file)
        }}
      />
      <WorkbenchEditorToolbar
        editor={editor}
        canExtract={Boolean(documentText)}
        onImportScript={() => scriptInputRef.current?.click()}
        onExtractAssets={handleExtractAssets}
      />
      <SelectionGeneratePopover
        editor={editor}
        selectedText={selectionState.text}
        selectionVersion={selectionState.version}
        onStoryboard={storyboardPlannerLauncher ? () => storyboardPlannerLauncher() : undefined}
        onCreated={clearSelectionText}
      />
      <div
        ref={scrollRef}
        className={cn(
          'workbench-editor__scroll',
          'min-w-0 min-h-0 overflow-auto',
          // Tiptap Placeholder 渲染：空文档第一段显示 data-placeholder（仿 PromptEditor，
          // 补上创作编辑器缺失的 ::before 规则——根因，不是只在这一处贴症状）。
          '[&_.is-editor-empty]:before:content-[attr(data-placeholder)]',
          '[&_.is-editor-empty]:before:text-nomi-ink-40 [&_.is-editor-empty]:before:float-left',
          '[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:h-0',
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}
