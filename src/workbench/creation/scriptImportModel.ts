import type { WorkbenchDocument } from '../workbenchTypes'
import { markdownToTiptapContent } from './markdownToTiptap'

export const SCRIPT_IMPORT_ACCEPT = '.txt,.md,.markdown,.docx,.xlsx,.xls,.csv'
export const SCRIPT_IMPORT_MAX_BYTES = 20 * 1024 * 1024

type TiptapParagraph = {
  type: 'paragraph'
  content?: Array<{ type: 'text'; text: string }>
}
function fileExtension(fileName: string): string {
  const match = fileName.trim().toLowerCase().match(/\.([^.]+)$/)
  return match?.[1] || ''
}

export function scriptFileTitle(fileName: string): string {
  const normalized = fileName.trim().replace(/^.*[/\\]/, '')
  const withoutExtension = normalized.replace(/\.(?:txt|md|markdown|docx|xlsx|xls|csv)$/i, '').trim()
  return withoutExtension || '导入剧本'
}

function plainTextToTiptapContent(text: string): TiptapParagraph[] {
  const normalized = String(text || '').replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return []
  return normalized.split('\n').map((line) => {
    if (!line) return { type: 'paragraph' }
    return { type: 'paragraph', content: [{ type: 'text', text: line }] }
  })
}

export function buildImportedWorkbenchDocument(
  text: string,
  fileName: string,
  updatedAt = Date.now(),
): WorkbenchDocument {
  const content = ['md', 'markdown'].includes(fileExtension(fileName))
    ? markdownToTiptapContent(text)
    : plainTextToTiptapContent(text)
  return {
    id: crypto.randomUUID(),
    version: 1,
    title: scriptFileTitle(fileName),
    contentJson: { type: 'doc', content },
    updatedAt,
  }
}
