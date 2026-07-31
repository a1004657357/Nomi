import { describe, expect, it } from 'vitest'
import { archiveOutputFileName, normalizeArchiveCollectionName } from './archiveOutputCollection'

describe('archiveOutputCollection helpers', () => {
  it('清理目录名并保留可读标题', () => {
    expect(normalizeArchiveCollectionName('  夏日清/终版...  ')).toBe('夏日清_终版')
    expect(normalizeArchiveCollectionName('')).toBe('输出收集')
  })

  it('生成有顺序且不含路径字符的文件名', () => {
    expect(archiveOutputFileName(1, '镜头 01/近景', '.MP4')).toBe('02-镜头 01_近景.mp4')
  })
})
