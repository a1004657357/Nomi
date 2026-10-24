#!/usr/bin/env node
// 棘轮/门岗属于目标仓库 main 的树；fork 的 PR 不必整合另一个仓库的官方 main。
// 只读检查真实 tracking tip；是否刷新由 delivery fetch owner 负责，CI 也不得跳过祖先检查。
import { execFileSync, spawnSync } from 'node:child_process'
import { DeliveryError, parseCli, resolveDeliveryTarget } from './git-delivery.mjs'

try {
  const { options } = parseCli(['preflight', ...process.argv.slice(2)])
  for (const [key, value] of Object.entries(options)) {
    if (!['remote', 'base'].includes(key) || typeof value !== 'string' || !value.trim()) {
      throw new DeliveryError('invalid_fresh_base_argument', 'Fresh-base accepts only --remote <name> and --base main.')
    }
  }
  if (options.base !== undefined && options.base !== 'main') {
    throw new DeliveryError('invalid_fresh_base', 'Fresh-base must check the target main branch, not a different branch, HEAD or an arbitrary SHA.')
  }
  const target = resolveDeliveryTarget({ ...options, base: 'main' })
  const mainSha = target.remoteCommit
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', mainSha, 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (ancestry.error || ![0, 1].includes(ancestry.status)) {
    throw new DeliveryError('git_ancestry_failed', `Cannot inspect ancestry of ${target.qualifiedRef}: ${ancestry.error?.message || ancestry.stderr.trim()}`)
  }
  if (ancestry.status === 1) {
    throw new DeliveryError('stale_target_base', `${target.repository} 的 ${target.remoteRef}（${mainSha.slice(0, 12)}）不是 HEAD 的祖先；分支尚未整合目标 main。请刷新并整合这个目标仓库的 main 后重跑，不能用另一个仓库的基线替代。`)
  }
  const timestamp = Number(execFileSync('git', ['log', '-1', '--format=%ct', mainSha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
  const ageHours = (Date.now() / 1000 - timestamp) / 3600
  console.log(`✅ 新鲜基线闸：${target.repository} 的 ${target.remoteRef}（${mainSha.slice(0, 12)}）已整合进 HEAD`)
  if (ageHours > 24) {
    console.log(`   ⚠ ${target.remoteRef} 的提交时间距今 ${Math.round(ageHours)} 小时；这不是 fetch 时间。请通过现有 delivery 流程刷新目标仓库后再确认，不需要合入其他仓库的 main。`)
  }
} catch (error) {
  console.error(`❌ 新鲜基线闸：${error instanceof DeliveryError ? `[${error.code}] ` : ''}${error.message}`)
  process.exitCode = 1
}
