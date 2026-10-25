# WebBridge 离线组件旅程

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

分支 `codex/web-bridge-journey-20261025`，代码基点仍为指定 `460b68d77e822f28b3f6a9069768ef535673fd25`；父提交是独立 renderer 修复 `e01e4770d`，本项不修改该测试，也无运行时依赖。旧分支保留，不 reset、不复制协调树工作区。

## 设计卡

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 为 inventory 漏登记的 WebBridgeConnectionCard 加可执行、限定为连接组件的离线 J17。 |
| ★2 Owner | 真 WebBridgeConnectionCard / FoldableModelCard / React / i18n / provider；桥仍走既有 getDesktopBridge preload seam，fixture 只有内存 start/stop/login/admin。 |
| ★3 复用 | 复用既有 Chromium/Vite 组件 fixture 模式；只 build 本 fixture HTML，再 preview 随机回环端口。不启动 Nomi/Electron，不加生产入口或能力集合。 |
| ★4 状态 | offline/server-only/client-online 不混淆，登录按钮不冒充已登录；busy、错误、缺扩展、缺 API/status 保持真实禁用/空 UI。 |
| ★9 验收 | 四条 bridge×中英 + 两个空 UI + 网络守护共七例；manifest/inventory 十一例；maxWorkers=1。无 ignore/skip/超时/基线修改，不 push，作者不承担最终独立 review。 |

## 结果与范围

固定基点原 inventory 缺 WebBridge owner：一失败；新增 J17 为 `level:component, profiles:[], covers:{}`。独立脚本在 model-access 主 runner 所属目录外，与既有 J16 的脚本归属方式一致，但不宣称 Electron/生成 roundtrip。原 16 旅程、STABLE_ROUNDTRIP_JOURNEYS 和 IGNORED_DRAWER_COMPONENTS 都与基点逐对象相等；原 runner 与生产能力 universe 不变。

真实 Chromium 七例全部通过，manifest/inventory 十一例通过，无主动 skip。每个中英旅程严格六次内存操作、正确 bridge key 与原始 admin URL；无意外 HTTP/WS 拦截与 pageerror。只放行本 fixture origin GET，外部地址、POST、全部 WebSocket 一律取消，无例外表；另用 `.invalid` GET 与本地 POST 证明拦截器真实触发两次、bridge 零调用。

```text
node node_modules/vitest/vitest.mjs run tests/ux/model-access-journeys/manifest.test.mjs tests/ux/model-access-journeys/inventory.test.mjs --maxWorkers=1 --reporter=json --outputFile=.tmp/renderer-batch-ui-460b68d77/webbridge-split.json
NOMI_MODEL_ACCESS_OUTPUT_ROOT=.tmp/renderer-batch-ui-460b68d77/web-bridge node node_modules/vitest/vitest.mjs run tests/ux/model-access-journeys/web-bridge-connection.test.mjs --maxWorkers=1 --reporter=json --outputFile=.tmp/renderer-batch-ui-460b68d77/webbridge-ui-split.json
```

环境 Node 24.19.0 / Vitest 4.1.8 / Vite 7.3.5 / Playwright 1.60.0。默认 lint 忽略 tests/ux，不算通过；额外 `--no-ignore` 并声明 Node/页内回调全局后，六文件 0 error / 1 warning：fixture 无 exports 的 Fast Refresh 警告，静态 preview 不用该能力，保留不 suppress。fixture 同源 TS/TSX 定向诊断为 0，非全仓 tsc。本 v3 只校验当前合同。

持久证据：`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/renderer-batch-web-bridge-460b68d77/`；包含 old/new JSON、四个 UI 状态/调用/渲染文本、两个空 UI、网络守护、范围/hash、类型/lint、v3 和各独立交付 receipt。全部旧失败/诊断保留，最终只认 split JSON。

## Harness 取证与限制

初次回环监听被环境拒绝，未执行用例，不当通过。Vite 7.3.5 dev 将 port:0 回退默认端口，hmr:false 仍有客户端 WS 尝试；源码核对后改为单 fixture build + preview 的系统分配端口，不为 HMR 开白名单。空卡可能无几何尺寸，就绪只认已挂载；阳性按钮/状态仍逐项要求 visible/enabled。

构建曾删掉 fixture 的暂停分支：旧产物只有一次 pauseNext 初始化，诊断显示字段已设 true、startRunner 已调却没有 release 等待。改为直接 window 暴露隔离状态，保留原 busy 断言后复验通过；没有改优化器、生产代码或超时。相关旧产物片段与失败现场有独立证据。

此旅程不证明 OnboardingDrawer 导航、真实 Host 安装/登录/启动或付费生成。无真实 Provider/App/项目写入/PNG/冻结/预算/全套；不处理协调 HEAD 1cae813d2 的工具登记或新版 UI。生产源码、guard、callback、支持声明和旧忽略清单不变；无依赖升级/fetch/全局记忆/push。不是 main GO。
