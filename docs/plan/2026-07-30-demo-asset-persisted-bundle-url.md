# 引导示例项目的成图 URL 被「构建产物地址」污染 —— 根因与修法

日期：2026-07-30

## 现象

用 dist 产物起 Electron（`NOMI_RENDERER_URL=file://…/dist/index.html`），渲染进程报：

```
Refused to load the image 'http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/kid.jpg'
because it violates the following Content Security Policy directive:
"img-src 'self' nomi-local: https: data: blob:".
```

示例项目「修好一个小机器人」的 10 张预置成图全部裂图。

## 先证伪一个假设：不是 Vite 没重写

`demoProject.ts` 用的就是 Vite 标准写法 `new URL('./assets/robot/kid.jpg', import.meta.url).href`，
`pnpm run build` 后产物是对的：

```
dist/assets/kid-Bv5PJ3l5.jpg …
dist/assets/demoProject-*.js:  new URL(""+new URL("kid-Bv5PJ3l5.jpg",import.meta.url), self.location)
```

也就是说**资源管线本身没问题**。报错里那个 `http://127.0.0.1:5273/src/...` 是 **dev server 的模块地址**，
dist 渲染进程根本算不出这个值 —— 它只能是从别处**读**来的。

## 真根因：把「构建产物 URL」写进了用户数据

`journeyTourStore.ts` 回放引导时：

```ts
canvas.addNodeResult(nodeId, { url: DEMO_NODE_IMAGES[clientId], ... })
```

`DEMO_NODE_IMAGES` 是**构建产物 URL**，而 `addNodeResult` 的结果会**落盘进项目文件**。实测：

```
~/Documents/Nomi Projects/示例：修好一个小机器人-…/.nomi/project.json   ← 含 http://127.0.0.1:5273/src/...
```

于是 dev 下跑过一次引导 → 项目文件里钉死了 dev server 地址 → 之后任何非 dev 环境打开都裂图 + CSP 报错。

**这不只是 dev/prod 串味，是一整类失效**：构建产物 URL 天生是易变的 ——

| 场景 | 持久化下来的值 | 下次还成立吗 |
|---|---|---|
| dev 跑引导 | `http://127.0.0.1:5273/src/...` | ❌ 换成打包版就死 |
| 打包版跑引导 | `file:///Applications/Nomi.app/…/dist/assets/kid-Bv5PJ3l5.jpg` | ❌ 下次发版哈希就变；换台机器路径就变；`file:` 还未必过 CSP `'self'` |

所以修在「给这张图特判」层没有意义，必须修在「**什么样的 URL 才配写进用户数据**」这一层。

## 修法：示例成图落成真项目资产（和真生成产物同一条路）

引导落画布前，先由**主进程**把随包的示例图写进该项目的资产目录，拿到稳定的
`nomi-local://asset/<projectId>/…` 再注入节点结果。

- `nomi-local:` 已在 CSP `img-src` 白名单里；
- 它指向项目目录内的真实文件 —— 重新构建、升级、换机、导出都不失效；
- 示例项目因此变成一个**真正自包含的项目**（素材库里看得到、导出成片拿得到），
  比原来「指着安装目录里的图」更诚实。

### 具体改动

1. 示例图从 `src/workbench/onboarding/assets/robot/` 移到 `resources/onboarding-demo/`
   —— 主进程需要按**稳定文件名**读它。不放 `src/`（Vite 会加内容哈希，只有渲染进程算得出地址），
   也不放 `public/`（Vite 会原样拷进 dist，同一批图进包两份，白吃 920K）。
   `resources/**` 加进 `package.json > build.files`，`app.getAppPath()/resources/onboarding-demo/*.jpg`
   在 dev（仓库根）与打包版（app.asar 根）是同一条路径。
2. 新增 `electron/onboarding/demoAssetSeed.ts`：按 clientId→文件名清单读盘 → `writeAsset` → 回
   `{ clientId: nomi-local url }`。**幂等**：已 seed 过（`kind='onboarding-demo'`）的复用，重看引导不堆副本。
3. IPC `nomi:assets:seed-onboarding-demo` + preload + bridge 类型。
4. `demoProject.ts` 删掉 `DEMO_NODE_IMAGES`（P1 加新必删旧）；`journeyTourStore.ts` 改调 seed。

### 结构保证

- `bundleAssetUrlBoundary.test.ts`：扫 `src/`，任何 `new URL('…', import.meta.url)` 构建资源 URL
  的出现点必须在**白名单**里，白名单每条都注明「只渲染、不持久化」。新增一处就得先想清楚它会不会落盘。
- `demoAssetSeed.test.ts`：主进程的 clientId 清单必须与 `demoProject.ts` 里分镜方案的 clientId 集合**完全一致**
  （跨进程的那份映射不会悄悄漂）。

### 存量数据

示例项目走 `seedKey` 复用同一个项目，重看引导会用新的 `nomi-local` URL **覆盖**旧的节点结果 —— 自愈，
不需要写迁移，也不动用户的真项目（`never-wipe-user-data-on-update`）。

## 验收门

- `pnpm run gates` 全过；
- dist 产物起 Electron 跑引导：console 无 CSP 报错，画布 10 张成图可见（截图人眼判断，R13）；
- 落盘的 `project.json` 里只剩 `nomi-local://asset/…`，无 `127.0.0.1:5273` / `dist/assets`。
