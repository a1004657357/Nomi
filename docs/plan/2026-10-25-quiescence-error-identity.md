# Visual Quiescence Error Identity

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

实现线：B；类别：其他。只改 tests/ux/_assert.mjs 的共享异常边界、已有单测及本计划/v3合同。

## 设计卡

| 格 | 结论 | 证据 |
| --- | --- | --- |
| ★1 用户怎么用 | 协调者运行截图验收时，FEEL字体基线失败必须按真实错误拒绝，不能在647ms后被误报为5000ms几何未稳。截图仍失败，不吞错或放宽标准。 | 用户App74报告；真实FEEL包装链单测 |
| ★2 谁说了算 | Playwright导出的TimeoutError类型拥有等待超时身份；FEEL checkpoint拥有字体drift。waitForVisualQuiescence只给前者补诊断，不接管后者。 | _assert.mjs / _feel-observer.mjs |
| ★3 一致与复用 | 复用已导入@playwright/test的errors.TimeoutError；本地已验证与playwright运行时是同一构造器。不新增依赖，不按name或message猜超时。 | 原生Node导出同一性检查 |
| ★4 全状态 | success照旧清fingerprint；typed timeout补原几何/动画诊断并保留cause；FEEL/AbortError/其他拒绝原样抛出，不读额外诊断或继续截图。 | 已有_assert.test.mjs新增聚焦回归 |
| ★9 验收与回滚 | 定向maxWorkers1先红后绿，再跑已有_assert及feel-policy测试；D独立复核，真实App由协调线验收。回滚revert本独立提交。 | 不跑App/browser/heavy |

## 不动项

- 不改5000ms/3帧、几何/动画标准、FEEL基线/规则/豁免、生产源码或PNG。
- 不改_feel-observer，只通过真实installFeelObserver链验证错误；DOM扫描输入为协议夹具，截图为不写文件的stub，临时目录只存JSON并清理。
- 不修改协调树/日常项目，不push/merge，不调用Provider。

## 红绿与交接

- 修改前新聚焦用例10失败/1通过，另8个旧用例因定向过滤未运行；真实FEEL包装链误改为几何超时、其他异常丢身份、typed timeout丢cause均复现。
- 修改后既有_assert与feel-policy两个文件完整定向26/26通过，maxWorkers=1，无跳过；未启动App或浏览器，不等待真实5秒。
- door-map：20个原直接消费者文件门保留，新增原测试文件门后21；所有包装调用仍进入同一shared catch，无逐调用者补丁。
- 单份v3 validateRootCauseChange：0阻断、1条既有test-path结构预防启发式警告（tests/ux运行时harness被视作test-only）；无checker/基线/豁免修改。git diff --check通过。
- 真实App74及D复审待协调线；本修复不将字体违规变绿，只恢复真实失败归因。
