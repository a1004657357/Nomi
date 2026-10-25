# TSX 冗余绑定清理设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：其他，现有界面不变。基点：`38eae0b1cc3e2edd214c3dac5d9f2f0ae49f378f`，不读取或混入主线未提交代码。

| 格 | 决定与证据 |
| --- | --- |
| ★1 用户怎么用 | 创作者继续使用节点选中/连线/上传、角色场景道具卡预览、图视频弹层与白板；本批只减 lint 冗余，不移动样式、不删控件、不跑真实 Provider。 |
| ★2 谁说了算 | 测量/observer 仍由 useNodeMediaMeasurement 唯一持有，组件保留原顺序调用；公开 Props 仍由原 TS 类型持有。door-map 补齐 Props 类型读入口后为 9 个保留入口，不合并或删除入口。 |
| ★3 一致与复用 | 原 ESLint no-unused-vars 识别到 6 个 TSX 的 14 项；无新依赖/框架。只去未用导入、纯常量/纯条件、未用解构，hook 的未用返回值改为同位置直接调用。 |
| ★4 全状态 | JSX、class/style、文字、分支、回调、公开 Props、hook 顺序和订阅清理不变，因此空/加载/成功/失败/取消/过期显示均不变；用前后 AST 对照和聚焦回归验证，不以静态测试冒充 App 实测。 |
| ★9 验收与回滚 | lint 先红后绿；6 个文件聚焦 ESLint、测量/节点已有回归、JSX/Props/hooks/调用对照；TSX 全量仅做同命令前后计数，非全仓 build/lint。协调线在合入后复跑总 warning 上限；回滚本批单独 commit。 |

本分支 fresh TSX lint：521 文件、0 errors、48 warnings，其中 no-unused-vars 14、Fast Refresh 23、hooks deps 6、any 5。后面三类不在本批修复范围，尤其不改 crowd memo 全对象依赖。不抬 79 上限、不加 suppression、不调整 checker/baseline。

## 追加类型边界修复

协调线 TSC 发现 B 首批 locale 接入把即梦预设改成 key-only，但 BrowserStartShortcut 仍强制 label。此批按明确授权修复 model/view 两个 TSX：raw label 与 labelKey 使用互斥联合，原文型（包括自定义文字和字面品牌名）不进 t()；可本地化预设仅持有 key，由渲染处 t(key)。移除小红书预设未消费的 raw fallback，不改链接/hint、书签存储、标签页动作或布局。禁止把 label/labelKey 都改可选而放行无显示身份的数据。

先写回归复现 TS2741 和双重身份；用真实类型/默认数组/渲染表达式做聚焦 TypeScript 检查，并用实际中英 locale 切换验证默认项、自定义原文及看起来像 key 的原文不变。完整 app/testtypes TSC 仍由协调线整合后复跑，不运行真实浏览器/Provider。

## 验证结果

- lint 清理聚焦回归先红 0/7；类型边界回归先红 1/3，包含实际默认数据的 TS2741。修复后两组共 10/10，无跳过。
- 同命令 fresh TSX-only ESLint：521 文件、0 errors、48→34 warnings，no-unused-vars 14→0。Fast Refresh 23、hooks deps 6、any 5 均原样保留。主线 157 总数与 79 上限须整合后复核，不拿本分支计数代替。
- 既有 useNodeMediaMeasurement / nodeSizing.visualSize / whiteboard localEditorFeedback：3 文件、38/38 tests。
- 6 个纯清理文件前后 AST 对照：所有 JSX、公开 type/interface、每个 hook 表达式及顺序、除已证明纯且无消费者的 isImageLike 调用外其余调用签名一致。未删 hook、订阅或控件。
- 浏览器 Model/View 对照：JSX 属性/标签序列、回调、其他公开类型及 Model 函数不变；只改快捷项互斥类型、冗余 fallback 数据字段及显示处的 key 存在判断。真实 locale 下 zh-CN/en/zh-CN 切换不修改默认/自定义数据。
- `ROOT_CAUSE_BASE_REF=38eae0b1cc3e2edd214c3dac5d9f2f0ae49f378f node scripts/check-root-cause-contracts.mjs` 通过，无警告；`git diff --check` 通过。
- 未运行全仓 lint/build、四套完整 TSC、App、真实 Provider 或媒体；主线 app/testtypes 整合验收、总 warning 上限与 A 新增文件登记仍交协调线下一轮。

复核日志留在本 worktree `.tmp/tsx-redundancy/`：before.json、after-final.json、red-tests.log、browser-red.log、combined-green.log、ast-equality.log、browser-ast-equality.log、root-cause-final.log。
