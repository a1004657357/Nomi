import { describe, expect, it } from 'vitest'
import {
  buildImportedWorkbenchDocument,
  SCRIPT_IMPORT_ACCEPT,
  SCRIPT_IMPORT_MAX_BYTES,
  scriptFileTitle,
} from './scriptImportModel'

describe('scriptImportModel', () => {
  it('从文件名生成文稿标题并声明受支持格式', () => {
    expect(scriptFileTitle('/tmp/咖啡广告.v2.docx')).toBe('咖啡广告.v2')
    expect(scriptFileTitle('')).toBe('导入剧本')
    expect(SCRIPT_IMPORT_ACCEPT).toContain('.docx')
    expect(SCRIPT_IMPORT_ACCEPT).toContain('.xlsx')
    expect(SCRIPT_IMPORT_MAX_BYTES).toBe(20 * 1024 * 1024)
  })

  it('Markdown 保留标题和列表语义', () => {
    const document = buildImportedWorkbenchDocument('# 第一场\n\n- 角色甲\n- 咖啡杯', '分镜.md', 123)
    expect(document).toMatchObject({
      version: 1,
      title: '分镜',
      updatedAt: 123,
      contentJson: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 } },
          { type: 'bulletList' },
        ],
      },
    })
  })

  it('纯文本逐行保留剧本排版和空行', () => {
    const document = buildImportedWorkbenchDocument('△ 第一场\r\n角色甲：你好\r\n\r\n【道具：咖啡杯】', '剧本.txt', 456)
    expect(document.contentJson).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '△ 第一场' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '角色甲：你好' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '【道具：咖啡杯】' }] },
      ],
    })
  })
})
