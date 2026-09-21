# Pavo Web 双宿主适配器实施计划

## 目标

用一套 Pavo 页面适配代码同时支持两种运行方式：

1. 独立 Chrome 扩展：用户可在普通 Chrome 中加载、登录 Pavo、手动或通过本地任务服务执行任务。
2. Nomi 内置运行器：Nomi Electron 加载同一扩展目录，以独立持久化会话登录 Pavo，并把画布任务和生成结果双向同步。

底层原则是“一套站点适配层、两个宿主”，不维护两份会漂移的页面自动化代码。

## 已核实事实

- Pavo 官方站点为 `https://app.pavo-ai.cn/`。
- 公共页面使用标准 DOM 控件，能识别文件输入、模型/模式下拉框、提示词编辑区和提交按钮，适合 Manifest V3 扩展接入。
- 未登录公共页面当前可见 `Agnes Video 2.5 Flash`、`全能模式`、首帧/尾帧与 `@资产` 等入口。
- Pavo 未公开稳定的网页自动化 API 契约，因此页面交互必须采用语义选择器、参数回读和提交幂等锁，不能依赖压缩 class 名。

## 范围

### 本次实现

- 新建独立项目 `Pavo-Web-Automation-Adapter`，保留本地 REST/SSE 任务桥、幂等提交、结果上传和任务恢复能力。
- 新建 Pavo DOM 适配层：页面识别、参数选择、文件上传、提示词填写、单次提交、结果差异检测和结果回传。
- Nomi 新增 `pavo-web` vendor、Pavo 视频模型档案、Electron 扩展运行器和独立登录会话。
- 抽出网页桥任务生命周期注册表，让即梦与 Pavo 的异步任务都能走真实查询和本地资产写回，不再依赖普通 API mapping。
- 加入零扣费 mock/契约测试；真实 Pavo 任务只做一次最小验收，并且必须在用户已登录后执行。

### 不在本次范围

- 不逆向或调用 Pavo 私有后端接口。
- 不绕过登录、付费、验证码、风控或平台频率限制。
- 不把 Pavo 页面内部模型列表硬编码成未经登录核实的完整目录。
- 不改动用户当前 Nomi 工作区和即梦扩展中的未提交文件。
- 不把 Pavo 替换成即梦的新名字；两者保留独立 provider、端口、cookie partition 和任务数据目录。

## 架构

```text
Nomi Canvas / MCP
        |
        v
Browser bridge registry
  submit / query / result localization
        |
        +--------------------+
        |                    |
  jimeng-web adapter   pavo-web adapter
        |                    |
  127.0.0.1:3457      127.0.0.1:3458
                             |
                 Pavo-Web-Automation-Adapter
                    /                   \
          Chrome standalone      Nomi Electron runner
```

扩展的任务服务与页面适配分层：任务服务只负责队列、claim/confirm、SSE、文件存储；`pavo-media.js` 和 `content.js` 只负责 Pavo DOM；`panel.js` 负责任务消费和恢复。

## 主要文件

### 独立扩展

- `manifest.json`：Pavo 权限、脚本与独立品牌。
- `pavo-media.js`：纯函数站点契约，包含 URL、媒体类型、模型标识、结果 URL 去重与预设验收。
- `content.js`：Pavo DOM 适配与抽屉宿主。
- `panel.js`：复用任务队列和幂等提交，改为 Pavo 工作台与 Pavo 状态文案。
- `mock-server.js`：使用 Pavo 独立实例 ID、令牌和数据目录。
- `tests/`：纯函数、服务器幂等、单次提交和结果回收测试。

### Nomi

- `electron/catalog/pavoWeb.ts`：vendor/model seeds。
- `electron/pavoWeb/`：鉴权、桥接、runner、IPC。
- `electron/webBridge/registry.ts`：网页桥异步任务的统一提交后查询入口。
- `electron/runtime.ts`、`electron/tasks/taskResultQuery.ts`：通过 registry 路由，不复制 provider 分支。
- `electron/preload.ts`、`electron/desktopIntegrationIpc.ts`、`src/desktop/bridge.ts`：运行器控制面。
- catalog/archetype/capability 与对应测试：让画布、Agent、MCP 能选择并正确投影 Pavo 模型。

## 失败与恢复语义

- 在点击官网生成前必须向本地服务取得唯一 submit claim。
- 点击后即使页面消息中断，也只进入 `awaiting_result`，不得自动二次点击。
- 生成时间长只轮询结果，不重新提交。
- 结果识别以“提交前输出快照 + 新增媒体 URL”作为主证据；任务码文本只作辅助证据。
- 只有结果下载并写入 Nomi 项目资产成功后才标记 `succeeded`。
- 页面参数回读失败时停止提交，明确指出未应用的参数。

## 六角色评审结论

- CTO：一套 adapter 双宿主；站点逻辑与宿主生命周期分离。
- 后端：统一网页桥 registry，修正异步查询/资产写回的通用缺口。
- 前端：优先语义角色、可见文本和原生 input；不依赖构建 class 名。
- 设计：Nomi 不新增重复配置面，模型参数继续由现有节点控件承载。
- PM：首版只声明已在页面核实的能力；登录后动态发现不等于无条件支持。
- 真实用户：Chrome 可单独用；Nomi 生成时自动启动；长任务不会重复扣费；结果回到原节点。

## 验收门

1. 扩展：`npm test` 全绿；mock 服务能启动；重复 task/idempotency key 只产生一次 submit claim。
2. Nomi：网页桥单测、catalog 测试、类型检查和 build 全绿。
3. 独立宿主：普通 Chrome 可加载扩展并在 Pavo 页建立 content/panel 通讯。
4. Nomi 宿主：Electron 使用 `persist:nomi-pavo-runner`，与即梦 cookie/端口完全隔离。
5. 零扣费旅程：Nomi 提交 `realSubmit=false`，扩展完整执行参数/上传/提示词流程但不点击生成。
6. 真实旅程：登录后只允许一次最小生成；验证官网仅一次提交、结果仅一次回传、Nomi 项目资产可打开。

## 回滚

- 删除 `pavo-web` seeds 与 `electron/pavoWeb` 路由即可让 Nomi 回到原有 provider 集合。
- 独立扩展目录不覆盖即梦扩展，可直接停用或删除。
- 网页桥 registry 会保留即梦原行为测试；若 Pavo 回滚，registry 仍可作为即梦查询缺口的根因修复。
