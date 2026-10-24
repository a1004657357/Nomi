// 把「文字 prompt + 待发附件」拼成 Vercel AI SDK 的 user message content。
// 纯函数（字节读取由 resolveBytes 回调注入），便于单测。
// 图片 → image part；PDF → file part（按模型能力门控）；其它文档 → 计数提示（S4 抽文本接手）。

export type AgentUserAttachment = {
  url: string
  contentType: string
  fileName: string
  kind: 'image' | 'file'
}

type TextPart = { type: 'text'; text: string }
type ImagePart = { type: 'image'; image: Uint8Array; mimeType?: string }
type FilePart = { type: 'file'; data: Uint8Array; mimeType: string; fileName: string }
export type AgentUserContent = string | Array<TextPart | ImagePart | FilePart>

export { modelSupportsImageInput, modelSupportsPdfInput } from '../shared/textModelCapabilities'

function isPdf(attachment: AgentUserAttachment): boolean {
  return attachment.contentType.toLowerCase().includes('pdf') || attachment.fileName.toLowerCase().endsWith('.pdf')
}

export async function buildAgentUserContent(params: {
  prompt: string
  attachments?: AgentUserAttachment[]
  supportsImageInput: boolean
  supportsPdfInput: boolean
  resolveBytes: (url: string) => Uint8Array | null
  /** 文档（docx/xlsx/csv/txt/md）抽文本，注入 prompt（任何文本模型可用）。 */
  extractText: (attachment: AgentUserAttachment) => Promise<string | null>
}): Promise<AgentUserContent> {
  const { prompt, attachments = [], supportsImageInput, supportsPdfInput, resolveBytes, extractText } = params
  if (!attachments.length) return prompt

  const mediaParts: Array<ImagePart | FilePart> = []
  const docBlocks: string[] = []
  let droppedImages = 0
  let droppedPdfs = 0
  let failedDocs = 0

  for (const att of attachments) {
    if (att.kind === 'image') {
      if (!supportsImageInput) { droppedImages += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedImages += 1; continue }
      mediaParts.push({ type: 'image', image: bytes, mimeType: att.contentType })
    } else if (isPdf(att)) {
      if (!supportsPdfInput) { droppedPdfs += 1; continue }
      const bytes = resolveBytes(att.url)
      if (!bytes) { droppedPdfs += 1; continue }
      mediaParts.push({ type: 'file', data: bytes, mimeType: 'application/pdf', fileName: att.fileName })
    } else {
      const text = await extractText(att)
      if (text && text.trim()) docBlocks.push(`〈${att.fileName}〉\n${text.trim()}`)
      else failedDocs += 1
    }
  }

  const notes: string[] = []
  if (droppedImages > 0) {
    notes.push(`（注：${droppedImages} 张图片未发送——当前模型不支持图片输入或读取失败。可在助手里换一个支持图片的模型。）`)
  }
  if (droppedPdfs > 0) {
    notes.push(`（注：${droppedPdfs} 个 PDF 未发送——当前模型不支持 PDF 输入。可换 Claude / GPT-4o / Gemini 等模型。）`)
  }
  if (failedDocs > 0) {
    notes.push(`（注：${failedDocs} 个文档未能读取内容。）`)
  }

  const docSection = docBlocks.length > 0 ? `\n\n[附件文档内容]\n${docBlocks.join('\n\n')}` : ''
  const text = `${[prompt, ...notes].filter(Boolean).join('\n\n')}${docSection}`
  if (!mediaParts.length) return text
  return [{ type: 'text', text }, ...mediaParts]
}
