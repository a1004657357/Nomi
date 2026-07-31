import { describe, expect, it } from 'vitest'
import { BROWSER_IMAGE_DRAG_MIME } from './browserAssetPopoverConstants'
import { readBrowserImageDragPayload } from './browserAssetPopoverUtils'

function dataTransferWith(entries: Record<string, string>): DataTransfer {
  return {
    getData: (type: string) => entries[type] ?? '',
  } as DataTransfer
}

describe('readBrowserImageDragPayload', () => {
  it('preserves an in-app browser video payload as video', () => {
    const payload = readBrowserImageDragPayload(dataTransferWith({
      [BROWSER_IMAGE_DRAG_MIME]: JSON.stringify({
        url: 'blob:https://jimeng.jianying.com/generated-video',
        title: '即梦生成视频',
        fileName: 'jimeng-result.mp4',
        mediaType: 'video',
      }),
    }))

    expect(payload).toEqual({
      url: 'blob:https://jimeng.jianying.com/generated-video',
      title: '即梦生成视频',
      fileName: 'jimeng-result.mp4',
      mediaType: 'video',
    })
  })
})
