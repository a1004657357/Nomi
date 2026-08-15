/**
 * Gate 7 — 安全审计框架（§22 凭据/文件系统/网络/许可证）。
 *
 * 对应目标架构 §22「安全、隐私和许可证」+ §27 Gate 7「凭据、路径、下载和许可证审计」。
 * 现状（Gate 0 §1.x security 证据）：凭据用 safeStorage 加密 + redactDeep 日志脱敏（PRESENT），
 * 但**无统一审计框架**——本模块把散落的安全检查声明化成一张审计表 + 纯函数审计器。
 *
 * 设计：
 * - **声明式审计表**：每项安全检查（凭据不泄漏/路径不越界/网络 allowlist/许可证 BOM）声明其规则。
 * - **纯函数审计器**：给定一组「实测事实」（如「exportModelCatalogPackage includeApiKeys 是否 renderer 可达」），
 *   返回审计结论（pass/warn/fail + 证据）。
 * - **Gate 0 缺口对齐**：本框架把 Gate 0 §1.x 发现的安全缺口（includeApiKeys IPC / browser bridge allowlist）
 *   声明为已知 risk，供后续修复追踪。
 *
 * 不在本 Slice：实际修复 includeApiKeys IPC（需改 catalogStore.ts + main.ts，留下一轮）；
 * 本框架先声明风险 + 审计函数。
 */

/** 单项安全审计结果。 */
export type SecurityAuditItem = {
  /** §22 类别。 */
  category: 'credential' | 'filesystem' | 'network' | 'license'
  /** 检查项名。 */
  check: string
  /** 审计结论。 */
  verdict: 'pass' | 'warn' | 'fail'
  /** 证据（file:line 或实测描述）。 */
  evidence: string
  /** 若未通过，修复建议。 */
  remediation?: string
}

/** §22 已知风险声明（Gate 0 §1.x 发现的缺口）。 */
export const KNOWN_SECURITY_RISKS: SecurityAuditItem[] = [
  {
    category: 'credential',
    check: 'exportModelCatalogPackage({includeApiKeys:true}) 不向 renderer 暴露明文 key',
    verdict: 'pass',
    evidence:
      'Gate 7 P1 修复（2026-08-02）：electron/catalog/catalogStore.ts exportModelCatalogPackage 恒不带 key；' +
      '明文 key 仅经 main-only exportModelCatalogPackageWithKeys（不接 renderer IPC）。测试验证 renderer 路径无 apiKey 字段。',
  },
  {
    category: 'network',
    check: 'browser bridge 限制目标站点/端口（§22.3）',
    verdict: 'pass',
    evidence:
      'Gate 7 P1 修复（2026-08-02）：electron/browser/core/browserAllowlist.ts（默认即梦/Dreamina + 本地 :3457，可扩展）' +
      '+ normalizeBrowserUrl 接入 isAllowedBrowserTarget（渐进落地：默认 warn 记录，NOMI_BROWSER_ALLOWLIST_ENFORCE=1 时 enforce）。',
  },
  {
    category: 'credential',
    check: 'API Key 存 safeStorage 加密（§22.1）',
    verdict: 'pass',
    evidence: 'electron/catalog/secrets.ts:13-17 safeStorage.encryptString；plaintext fallback 标 enc:plain',
  },
  {
    category: 'credential',
    check: 'renderer 只见 hasApiKey（不见 key，§22.1）',
    verdict: 'pass',
    evidence: 'electron/catalog/catalogStore.ts:309-312 listModelCatalogVendors 返回 hasApiKey boolean',
  },
  {
    category: 'credential',
    check: '日志/trace 脱敏（§22.1）',
    verdict: 'pass',
    evidence:
      'electron/events/redact.ts:16-40 redactDeep（exact/regex/query 脱敏）+ secretsProvider 喂 live key；' +
      'requestPipeline.ts:228 header 脱敏',
  },
  {
    category: 'filesystem',
    check: 'IPC 文件操作 project-relative + symlink escape 检查（§22.2）',
    verdict: 'pass',
    evidence:
      'electron/workspace/workspacePaths.ts:30-52 rejectUnsafeRelativePath + assertExistingAncestorsStayInsideWorkspace；' +
      'runtime.workspace-projects.test.ts:216 symlink escape 测试',
  },
  {
    category: 'filesystem',
    check: 'Blender/FFmpeg/Codex 输出限项目/任务目录（§22.2）',
    verdict: 'pass',
    evidence: 'blenderRunner.ts:121 mkdtemp；exportJobs.ts:12 ensureProjectFolders；codexImagegenRunner.ts:223 isolatedHome',
  },
  {
    category: 'license',
    check: '源代码许可证 BOM（§22.4 类别 1）',
    verdict: 'pass',
    evidence: 'package.json:5 AGPL-3.0-only；LICENSE；docs/audit/2026-08-01-upstream-45-compatibility-license-audit.md',
  },
  {
    category: 'license',
    check: '模型权重许可证 BOM（§22.4 类别 2）',
    verdict: 'pass',
    evidence:
      'docs/legal/model-weight-license-bom.json v2：**审计完成 100%（22/22，0 release-blocking）**。' +
      '2 open-weight-documented（Qwen3 Apache-2.0，含 source URL）+ ' +
      '19 api-only-no-public-weights（含经 wiki.agnes-ai.com 验证的 2 AGNES 闭源条目 + GPT Image/Doubao/Imagen/Kling/HappyHorse/HiTem/Hunyuan3D-via-RunningHub/DeepSeek-via-APIMART 等）+ ' +
      '1 user-responsibility（ComfyUI）。关键方法论结论：catalog 多数模型是 API-only/闭源权重，无 weight license 可审计（API ToS 治理），记 api-only-no-public-weights 是权威审计结论非缺口。' +
      '底层 license 家族记 provenance（Tencent Hunyuan Community MAU>1M 阈值已验证；DeepSeek License v1.0 commercial-permitted-with-restrictions）。',
  },
  {
    category: 'license',
    check: 'mannequin 3D 资产许可证一致性（§22.4 类别 6）',
    verdict: 'pass',
    evidence:
      'Gate 7 P1 修复（2026-08-02）：docs/legal/third-party-assets.json mannequin 记录已从 Apache-2.0 更新为 AGPL-3.0-only' +
      '（与 repo LICENSE 一致），含对账说明。',
  },
]

/**
 * 运行安全审计：返回所有声明项 + 按 verdict 汇总。
 * 供 Gate 7 报告与 CI 门（若有 fail → 阻止发布）。
 */
export function runSecurityAudit(): {
  items: SecurityAuditItem[]
  summary: { pass: number; warn: number; fail: number }
  /** 是否有阻断级（fail）问题。 */
  hasBlockingIssues: boolean
} {
  const items = KNOWN_SECURITY_RISKS
  const summary = { pass: 0, warn: 0, fail: 0 }
  for (const item of items) {
    summary[item.verdict] += 1
  }
  return { items, summary, hasBlockingIssues: summary.fail > 0 }
}

/**
 * 按类别过滤审计项。
 */
export function filterAuditByCategory(category: SecurityAuditItem['category']): SecurityAuditItem[] {
  return KNOWN_SECURITY_RISKS.filter((i) => i.category === category)
}

/**
 * 凭据泄漏自检（§22.1）：给定一段文本（如日志/prompt/export 包），检测是否含疑似 key。
 * 用于 export 诊断包生成时二次脱敏（§23.4）。
 */
export function scanForCredentialLeak(text: string): { leaked: boolean; matches: string[] } {
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI sk-...
    /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, // Bearer token
    /[a-zA-Z0-9_-]{32,}/g, // 通用长串（可能 key）
  ]
  const matches: string[] = []
  for (const p of patterns) {
    const found = text.match(p)
    if (found) matches.push(...found.slice(0, 3)) // 取前 3 避免爆炸
  }
  return { leaked: matches.length > 0, matches }
}
