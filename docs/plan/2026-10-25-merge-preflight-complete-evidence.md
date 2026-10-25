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

## 第二批：Tree 完整性与 Rename 展示计数

23d 的跨表示强等式过强。用户实测同一 SHA：M50=6797(67R)、M100=6853(11R)、raw=6864，GitHub=6807；不能猜阈值或假称 raw 与 API 相等。

- 完整性 owner 改为 native Git：验证 base/head/唯一 merge-base 的完整树及本地 blob 对象；完整 no-renames diff 清单必须与两棵树的变化路径精确相等、唯一、状态一致。patch 必须成功且非空（存在变化时）。
- 保留所有 A/D 路径送入原分类，允许保守命中，不改四类/设计卡/独立验收规则。
- 设 raw=A+D+其他，r 个 rename 只能一对一折叠 A/D，故 0<=r<=min(A,D)，只接受 API count 属于 [raw-min(A,D),raw]。这是表示可行性检查，不代替上面的逐路径完整性证明。
- 双端 repo 的 owner/name/full_name 必须自洽，base repo 必须等于请求目标；head 可以是合法 fork，但不能缺失或身份冲突。报告保留两端 repo+SHA、merge-base、raw 和 API 范围。
- 322 路径真 Git 夹具含一个纯 rename 与两个带编辑 rename，M50=319、M100=321、模拟 API=320；接受合法区间，拒绝上下界之外的计数。
- 负对照覆盖缺未变化 blob、缺 patch、Git 失败、漏路径、相同总数替换路径、重复路径，以及双端 repo 错配。Node-only，禁止重型门岗/网络/App/Provider。
- D 约束：所有 Git 子进程（包括 gitPaths helper）局部设置 GIT_ALLOW_PROTOCOL=''，不依赖旧 Apple Git 忽略的 GIT_NO_LAZY_FETCH；partial-clone 夹具用本地 transport canary 先证明阳性，再断言预检零调用，不访问真实网络。
- 完整 patch 强制 --text/--no-textconv/--no-ext-diff/--no-color，保持 64MiB 输出上限；binary 属性和任意后缀不得隐藏新增取消文本，不缩减分类范围。
- 原生 --output-indicator-new=> 区分新增数据与 +++ 文件头，再还原原 addedLines 形状；源行以 ++ 开头仍完整保留，不另造 patch parser。

### 第二批补充设计格

| 格 | 结论与边界 |
| --- | --- |
| 5 中途表 | 只读扫描，无付费或后台任务；中断不能产生完整通过收据；不自动 fetch，不重试网络。 |
| 6 外部数据与失败 | PR 双端身份、对象、tree、patch、计数可行范围逐项失败封闭；API 不可用不能触发 legacy 豁免。 |
| 7 性能预算 | 三棵快照只读遍历与 blob metadata batch-check；patch 保持 64MiB 原上限，超限拒绝，不调预算。 |
| 8 真实条件 | 实际 Apple Git 2.39.3；真临时 Git/partial-clone canary/CLI 已验，真实 PR 网络、Windows 和 App 均 unverified。 |

### 第二批验证

- 修改前：43 项回归中 12 项失败；合法 rename 表示计数被强等式拒绝；缺未变化 blob 实际返回 clean。D 的 binary/旧 Git 两项另行先红；++ 源行/文件头消歧也先红。
- 修改后最终定向 Node 与原 gitPaths 回归 50/50 通过，0 skipped/cancelled；binary 与旧 Git 独立回归 2/2 通过。单份 v3 validateRootCauseChange 校验通过，git diff --check 通过；不运行全仓门岗。
- 本地 transport canary 允许协议时真实触发，禁止协议时预检及共享 NUL helper 均零调用；不访问真实网络，不修改用户 Git 全局配置。
- 用户真实数字有 6864-6807=57 且 M50 已证明可形成67组，故 57<=67<=min(A,D)，该展示计数在数学可行范围内；不推断 GitHub 算法。真实 PR 完整扫描仍待协调者/D 验收。
