import { desktopT } from "../../desktopStrings";
/**
 * Gate 7 P1 修复 — browser bridge 目标站点/端口 allowlist（§22.3）。
 *
 * 对应目标架构 §22.3「Browser bridge 只连接明确本地端口和目标站点」。
 * 现状（Gate 0 §1.x security 证据）：`normalizeBrowserUrl`（browserViewUtils.ts:54）只查 protocol；
 * 任何 HTTP(S) 站点可加载；无端口锁——本 Slice 加 allowlist。
 *
 * 设计（保守默认 + 可扩展）：
 * - **默认 allowlist**：只允许 browser bridge 实际用的目标站点（即梦/Dreamina Seedance 捕获）
 *   + 本地扩展端口（127.0.0.1:3457，见 jimengWeb.ts:16）。
 * - **可扩展**：用户/配置可加站点（如新 Provider 的 web 桥），但默认拒绝未知。
 * - **纯函数**：`isAllowedBrowserTarget` 判定 url 是否在 allowlist；`assertAllowedBrowserTarget` 抛错。
 *
 * 不在本 Slice：实际接入 normalizeBrowserUrl（需改 browserViewUtils.ts + 全链路回归，留下一轮接入；
 * 本 Slice 先交付 allowlist 函数 + 测试，供下一轮在 normalizeBrowserUrl 调用）。
 */

/** allowlist 条目：host + 可选端口（缺省=任意端口）+ 路径前缀（可选）。 */
type AllowlistEntry = {
  /** 主机名（小写，不含端口）。支持精确匹配。 */
  host: string
  /** 允许的端口（缺省=任意）。 */
  port?: number
  /** 路径前缀（缺省=任意路径）。 */
  pathPrefix?: string
  /** 用途说明（供审计）。 */
  purpose: string
}

/**
 * 默认 browser bridge allowlist。
 * 来源：Gate 0 §1.4 证据——jimeng-web (Dreamina Seedance 捕获) + 本地扩展端口 127.0.0.1:3457。
 *
 * 注：即梦/Dreamina 的实际域名随地区变化；此处列已知主域名，可经扩展 API 加。
 */
const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  // 即梦 Web / Dreamina（Seedance 视频网页桥捕获目标）
  { host: 'jimeng.jianying.com', purpose: '即梦 Web 创作台（Seedance 视频桥）' },
  { host: 'dreamina.jianying.com', purpose: 'Dreamina 创作台（Seedance 视频桥）' },
  { host: 'dreamina.com', purpose: 'Dreamina 创作台（Seedance 视频桥）' },
  { host: 'www.dreamina.com', purpose: 'Dreamina 创作台（Seedance 视频桥）' },
  // 本地扩展端口（Seedance2 Chrome 扩展 local server，jimengWeb.ts:16）
  { host: '127.0.0.1', port: 3457, purpose: 'Seedance2 Chrome 扩展 local server（127.0.0.1:3457）' },
  { host: 'localhost', port: 3457, purpose: 'Seedance2 Chrome 扩展 local server（localhost:3457）' },
  { host: 'app.pavo-ai.cn', purpose: 'Pavo Web 创作台' },
  { host: '127.0.0.1', port: 3458, purpose: 'Pavo Web Adapter local server（127.0.0.1:3458）' },
  { host: 'localhost', port: 3458, purpose: 'Pavo Web Adapter local server（localhost:3458）' },
]

/** 运行时可扩展的额外 allowlist（供配置加新 Provider web 桥）。 */
const extraAllowlist: AllowlistEntry[] = []

/** 加一条额外 allowlist 条目（供配置/用户加新站点）。 */
export function addBrowserAllowlistEntry(entry: {
  host: string
  port?: number
  pathPrefix?: string
  purpose: string
}): void {
  extraAllowlist.push({
    host: entry.host.toLowerCase().trim(),
    ...(entry.port != null ? { port: entry.port } : {}),
    ...(entry.pathPrefix ? { pathPrefix: entry.pathPrefix } : {}),
    purpose: entry.purpose,
  })
}

/** 清空额外 allowlist（测试用）。 */
export function resetBrowserAllowlistForTests(): void {
  extraAllowlist.length = 0
}

/** 当前生效的完整 allowlist（默认 + 额外）。 */
export function getBrowserAllowlist(): readonly AllowlistEntry[] {
  return [...DEFAULT_ALLOWLIST, ...extraAllowlist]
}

/**
 * 判定一个 url 是否在 browser bridge allowlist 内（§22.3）。
 *
 * 规则：
 * - 非 http(s) → 拒。
 * - host 必须精确匹配某条目（不允通配，防 *.evil.com）。
 * - port 指定时必须匹配。
 * - pathPrefix 指定时 url 路径必须以它开头。
 */
export function isAllowedBrowserTarget(url: unknown): { allowed: boolean; reason: string; matchedEntry?: AllowlistEntry } {
  const value = String(url ?? '').trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { allowed: false, reason: desktopT("custom.workflow.browserInvalidUrl") }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: desktopT("custom.workflow.browserProtocol", { value0: parsed.protocol }) }
  }
  const host = parsed.hostname.toLowerCase()
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  for (const entry of getBrowserAllowlist()) {
    if (entry.host !== host) continue
    if (entry.port != null && entry.port !== port) continue
    if (entry.pathPrefix && !parsed.pathname.startsWith(entry.pathPrefix)) continue
    return { allowed: true, reason: desktopT("custom.workflow.browserMatched", { value0: entry.purpose }), matchedEntry: entry }
  }
  return { allowed: false, reason: desktopT("custom.workflow.browserHostDenied", { value0: host, value1: port }) }
}

/**
 * 断言 url 在 allowlist 内；不在则抛错（供 normalizeBrowserUrl 接入用）。
 */
export function assertAllowedBrowserTarget(url: unknown): void {
  const result = isAllowedBrowserTarget(url)
  if (!result.allowed) {
    throw new Error(desktopT("custom.browser.core.browserAllowlist.text1", { value0: `${result.reason}` }))
  }
}
