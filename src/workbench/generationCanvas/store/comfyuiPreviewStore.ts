// ComfyUI 活预览帧的会话级瞬态存储（P 轨）。刻意独立于画布主 store：
// 预览帧是高频瞬态（≤2fps 的 dataURL），绝不进 node.meta / 持久化 project.json——
// 关掉项目/终态即弃。GeneratingOverlay 订阅它；comfyuiProgressBridge 写它。
import { create } from 'zustand'

type ComfyuiPreviewState = {
  byNode: Record<string, string>
  setPreview: (nodeId: string, dataUrl: string) => void
  clearPreview: (nodeId: string) => void
}

export const useComfyuiPreviewStore = create<ComfyuiPreviewState>((set) => ({
  byNode: {},
  setPreview: (nodeId, dataUrl) =>
    set((state) => ({ byNode: { ...state.byNode, [nodeId]: dataUrl } })),
  clearPreview: (nodeId) =>
    set((state) => {
      if (!(nodeId in state.byNode)) return state
      const next = { ...state.byNode }
      delete next[nodeId]
      return { byNode: next }
    }),
}))
