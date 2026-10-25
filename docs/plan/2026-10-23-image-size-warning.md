# 图片尺寸规格 warning 设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：图片规格验收。负责人：尺寸调查线。类别：长跑；不新增付费调用或界面。

| 格 | 决定与证据 |
|---|---|
| 1 用户怎么用 | 选择尺寸、确认生成、等待、取回原图、查看现有技术自检 warning、决定是否显式后处理。历史真实任务：10/21 CLIProxy 文生图和参考改图均请求 1024x1024、原图 1254x1254；本轮只做离线回归，不冒充真测。 |
| 2 谁说了算 | 请求规格取实际编译后的出站 body/fields 并随任务封存；实际尺寸归落盘文件 probe；判据归 technicalCheck，持久化/广播归 reviewTrace。门表见同日 root-cause 合同。 |
| 3 一致与复用 | 复用 runTechnicalCheck、review.technical.completed、assetSidecar；画布和 Agent 两条回收链同一判据。不调用 normalizeImageDimensions（该流程会裁图）。 |
| 4 全状态 | 无精确规格不宣称精确通过；匹配记录 matched；不符为 mismatch warning；探测失败为 unavailable warning；任务 succeeded 不变。中英文走 desktopStrings。 |
| 5 中途表 | 尚未生成/取消/断网：不增加请求、不扣新费用；取回后自检失败不阻断结果。关窗/重启/连点均不触发生成重试；已落账 sidecar/event 保留，旧任务无出站快照不能补猜。 |
| 6 外部数据与失败 | 供应商可能返回动态尺寸；HTTP 成功不等于尺寸匹配。保留实际字节；原件与预览区分；不归咎 key/额度。外部代理只读调查报告在 handoff/reports/cliproxy-image-size-review-20261023.md。 |
| 7 性能预算 | 仅图片且有明确像素规格时等待免费本地 probe 落账；无额外网络请求。视频维持已有异步检查。最大规模性能 unverified。 |
| 8 真实条件 | 本轮 Windows/真付费/重启真进程/英文窗口/键盘/最小窗口均 unverified；仅离线测试。主线程正在生成，已加载模块不会因源文件写入自动升级。 |
| 9 验收与回滚 | 红绿覆盖 exact/mismatch/未知/探测失败、原件 hash、sidecar/event、画布与 Agent 传参。独立验收由主线程另行执行；本线报告不是独立审查签字。不提交；回滚只撤本线精确 diff，保留其他 dirty。 |

## 生效边界

最终报告记录源码写入完成 UTC 时间及文件 hash。源码运行器首次 import 在此之后才可能加载新逻辑；已 import 的模块、已构建 Electron 和旧任务封存回执不能据此宣称已覆盖。不得重启主线程、修改 paid harness/launcher 或进行真实调用。

## Cache Miss 补修设计卡（2026-10-23）

| 格 | 决定与证据 |
|---|---|
| 1 用户怎么用 | 图片已受理后关窗/重启、TTL/LRU 驱逐、重新取回，只 GET 原任务；原请求 1024x1024 即使现目录变成 2048x2048 仍按 1024 验收。历史两张 1254 原件不改写，本轮仅离线。 |
| 2 谁说了算 | runtime.admitTask 是受理缓存写入口，taskResultQuery.rebuildCachedTaskFromPayload 是实际恢复 owner；taskAdmission 的 ids 也仅内存。事件日志旁路会吞 IO，提交幂等镜像仅覆盖有 key/初始化的入口且有 TTL，均不能代替规格耐久回执。 |
| 3 一致与复用 | 仅保存图片规格的项目内 .nomi/tasks/image-size 回执，复用 projectDirById 和 writeJsonFileAtomic；不另建任务状态机、不碰幂等/付费语义。 |
| 4 全状态 | 已知精确规格恢复 exact；已封存未指定规格保持 unspecified；旧/缺失/损坏/身份不符为 unavailable（requested:null），不能 guessed 或 matched。 |
| 5 中途表 | 重启/驱逐/断网/连点只读同一回执，不上传、不 create；保存失败只警告，不把已受理改失败，恢复缺失时 unavailable。取消和任务成功状态不变。 |
| 6 外部失败 | 身份由 project/vendor/model/taskKind/taskId 组成并逐字段校验；不能信恢复 payload 的尺寸、taskextras 或当前 catalog。 |
| 7 性能 | 单小 JSON 同步原子写，新快照按任务一个文件；回收读一个文件，不扫全事件。真实规模性能 unverified。 |
| 8 真实条件 | macOS 离线临时项目覆盖实际 admit/cache-clear/module-reload/query；真实调用、其他平台、打包 Electron 均 unverified。 |
| 9 验收回滚 | 新增存储/实际恢复链红绿，复跑原尺寸测试与生产 tsc noEmit；独立 review 归主线程。不提交、不回滚别人的 dirty。 |
