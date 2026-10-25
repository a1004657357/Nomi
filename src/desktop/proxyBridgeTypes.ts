/** 代理三态：跟随系统探测 / 只对 Nomi 生效的自定义地址 / 强制直连。 */
export type DesktopProxyMode = 'system' | 'custom' | 'off'

/** 用户选了什么 × 实际生效什么。两者不一致时正是用户最需要看见的（如探到 SOCKS 但用不了）。 */
export type DesktopProxyStatus = {
  localProxyDetected?: boolean
  localProxySample?: string
  mode: DesktopProxyMode
  customUrl: string
  /** 实际生效的代理地址；直连时空串。 */
  activeUrl: string
  /** 探到但本版用不了（SOCKS 等）的人话详情；否则空串。 */
  unsupported: string
  source: 'env' | 'system' | 'custom' | ''
}

export type DesktopProxyProbeAttempt = { target: string; ok: boolean; ms: number; error: string }

/** ok = 上传链里**任一** host 可达（那就送得出图）；tried 逐项留痕，用来看「是不是已经断了一半」。 */
export type DesktopProxyProbe = {
  ok: boolean
  ms: number
  target: string
  error: string
  tried: DesktopProxyProbeAttempt[]
}
