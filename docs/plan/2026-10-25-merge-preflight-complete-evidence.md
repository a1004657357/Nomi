# Merge Preflight Complete Evidence

类别：其他；实现线：B；只在隔离 worktree 修改合并扫描及定向回归。

## 设计卡

| 格 | 结论 | 证据 |
| --- | --- | --- |
| ★1 用户怎么用 | 协调者扫描真实 PR 时，先取得目标仓 PR 完整元数据，再对绑定的 base/head SHA 计算完整变更，最后执行原设计卡、四类和验收规则。大 diff、未知规则时间不得变成空清单或历史豁免。 | scripts/merge-preflight.mjs |
| ★2 谁说了算 | GitHub PR 元数据拥有目标仓、PR 号、base/head SHA 和 changed_files；本地 Git 三点 diff 拥有准确路径、状态和新增行。规则历史豁免只接受有效日期证据。 | gitPaths.mjs；隔离 Git 夹具 |
| ★3 一致与复用 | 复用 gitNameStatus 的 NUL safe 路径解析和既有分类/报告函数，不增加依赖、REST 分页副本、自动 fetch 或另一套分类规则。 | scripts/lib/gitPaths.mjs |
| ★4 全状态 | 元数据或 Git 对象/共同祖先/文件数不完整：明确失败且不分类；规则时间未知：明确提示并严格检查；有效旧 PR：保留原警告兼容；完整新 PR：照旧判定。 | 定向 Node 测试 |
| ★9 验收与回滚 | 先运行新增回归见红，再运行本文件既有和新增 Node 测试见绿；协调线集成后复跑真实 PR #2。回滚 revert 本提交，不改 workflow、阈值、分类或预算。 | node --test scripts/merge-preflight.node-test.mjs |

## 验证边界

- 真临时 Git 仓库：300+ 文件、换行/中文路径、重命名、仅增加行的修改文件，以及分叉后 base 独有文件。
- 证明差异绑定元数据 SHA 而非本地 HEAD，也不是两点 diff。
- 缺失/无效 SHA、缺对象、无共同祖先、文件总数不符、元数据异常必须失败。
- 缺失 #961、未知或损坏时间不再 grandfather；有有效日期的 legacy 仍兼容。
- 准确症状：原 view.files 仍在，被错误清空的是 diff 文本，因而漏掉 AbortController/AbortSignal 分类。CLI 夹具保留完整非空 files。
- 四类类别和目录/扩展名规则不变；新增 src/**/*.tsx 的通配仅增加 dotAll，使 Git 合法换行文件名同样执行原规则，避免 NUL 解码后再次漏判。
- 本轮不跑真实 gh 请求、App、浏览器、Provider、benchmark 或重型门岗；真实 PR 验收未执行。

## 红绿结果

- 用父版本真实脚本替换 CLI 夹具内的脚本副本（不改 worktree），非空 317 项 files + HTTP406 + 缺 #961 真实得到 exit 0；CLI 回归准确报红，且报告遗漏可打断类别。
- 当前实现定向 Node 回归与既有 gitPaths 回归：36/36 通过，0 skipped/cancelled；原规则测试保留，未知时间旧错误期望改为 strict。
- 新回归加入既有 merge-preflight.node-test.mjs，已由现有 test:eng-system 调用，不新增平行门岗或修改 package.json。
- 单份 v3 合同通过既有 validateRootCauseChange 校验；未运行全仓合同门。
- Git 对象不可用时返回失败并要求调用者准备准确对象；不添加 REST 猜测回退、自动 fetch 或工作区 HEAD 回退。
