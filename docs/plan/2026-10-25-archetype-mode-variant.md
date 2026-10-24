# 模式与变体一致性

基点 `209f3f2d0765b1e8abb79a4567f7528b82e76965`；复用干净 sibling，分支 `codex/archetype-mode-variant-fix-20261025`。保留旧 cc6cc557 分支，不 reset，不混入协调线未提交文件。

| 格 | 决定 |
| --- | --- |
| ★1 用户流程 | 切模式保留仍兼容的型号；旧型号不支持目标模式时，UI 明确写回档案中合法默认，参数和发送型号随同一选择变化；原照片、参考顺序和用户 meta 不丢。 |
| ★2 Owner | shared resolveArchetypeVariant 仍唯一决定显式 ID/别名、专属模型串、默认/首个的优先级。renderer 只把既有 variantsForMode 的合法候选投影给它，不重写决策。 |
| ★3 复用 | 只改 archetypeMeta.ts 与其回归；复用 currentArchetypeMode、clampMetaToModeParams、canonicalArchetypeVariantId、specializeArchetypeForVariant。shared、admission、默认型号、档案、价格不改。 |
| ★4 全状态 | canonical/legacy 档案 ID 同源识别；Flash 旧 mode 映射后真实写回；兼容显式选择保留；失效/不兼容变体走合法候选下的同一 resolver；归一化幂等。无合法候选不凭空构造型号。 |
| 5 花钱边界 | 本轮无 Provider/付费请求。宿主仍以显式 variant 优先，不因模式猜成高价档；前端模式回落必须写入明确 variant 后再发。以真实 host compile/admission 和 shared 函数执行验证，不调用传输。 |
| 6 中断状态 | 这些函数同步纯转换，不启动任务/重试/订阅，不改既有取消机制。 |
| 7 并发与写入 | 只返回新 meta/patch，不原地改变输入；冻结参考数组和用户对象测试。旧模型串迁移仍由原 useNodeModelAutoSelect 的“活目录行不迁移”准入保护。 |
| 8 数据迁移 | 不迁移持久项目文件；ensure/normalize 规范已有身份/mode/variant，保留 global 参考槽及用户字段。normalize 仍是原调用方合并的 patch，仅额外携带已有 clamp 算出的越界 select 修正；没有 default 的旧值以 undefined 清除，JSON 不再保存该无效值。 |
| ★9 验收 | 原失败 5/175（主用例 1、compatibility 4），保留断言；补真实函数红绿回归，最多 1 worker，仅 archetypeMeta 两文件与 shared variantResolution。定向 lint/v3/diff；不占全局重测锁。最终 App/付费链与全仓由协调线验收。 |

## 查证

- `variantResolution.ts`：显式 variant/历史别名优先，再专属 model ID，再档案默认/首个；叶子模块刻意没有 mode。过滤候选时保留原 catalog base-key 身份，不能因为切片而重新猜基础型号。
- `NodeParameterControls` 的 mode/variant 回调、`nodeModelArchetype` 参数展示、`buildArchetypeInputParams` 与 `runProjectDelivery` 的确认签名均汇入 archetypeMeta；原 mode 保留函数在切目标 mode 之前就选了变体，是直接根因。
- `useNodeModelAutoSelect:233` 只在目录中不存在旧行时调用 normalize；该调用方 gate 不改。ensure 必须在 no-variants 的提前返回之前规范 Flash legacy mode。
- 宿主 `modelAdmissionSchema.archetypeCompileOptions` 与 `executionContract.admitPlanCandidate`：声明级 allowedVariantIds 校验，不自行按 mode 替换显式型号；`profileHttpRequest` 同样问 shared resolver。已有宿主未提供 mode-specific variant 拒绝，本轮不把它改成隐式升级策略，也不声称新增了这一拒绝能力。
- 只读生产结构和现有 shared 类型/函数，没有新增依赖或供应商规则；不用模型档案/价格改动掩盖失败。

日志：本 worktree `.tmp/archetype-mode-variant/`。当前首轮只跑 3 个获准定向文件，5 失败/170 通过，无网络 Provider 调用。

## 实现与回归

- `matchesArchetype` 统一 canonical/legacy 档案身份；`resolveModeVariant` 仅投影既有模式过滤，保留原 base-key 身份，所有选择顺序仍由原 shared resolver 完成。
- 切模式先确定目标 mode，再解析其合法 variant；切变体也用当前 canonical mode。无合法候选保持原状态，不发明型号；ensure 对这一 no-op 返回 null，避免反复写同一 meta。
- ensure 在 no-variants 提前返回之前先落 Flash 的旧 mode 映射；有效但不兼容的 canonical variant 不再被当成“已归一”。
- normalize 保留有效显式选择对旧模型串的优先级，并复用已有 clamp，仅用 mode.params 的实际变化生成 scalar patch，绝不携带整份用户数据。
- 红测：`red-existing.log` 5/175 失败；新增身份/宿主/引用测试 `red-added.log` 8/15 失败；继续补归一化 scalar/no-op 回归 `red-normalize-controls.log` 3/18 失败。
- 绿测：`green-02.log` 3 文件 186/186，通过原五例及新增 11 例；最终验证另外记录 `green-final.log`。原有所有断言保留。
- 真实函数覆盖：Jimeng v3_0/t2i、v4_7/edit、v5_0_lite/edit 均保持兼容的显式型号；旧 edit/v3_0 经 ensure 或 normalize 变为档案默认 v5_0_pro，renderer model、shared 选择、宿主参数枚举及 ExecutionContract 的 variant/transportModelId 一致。测试的内存 module manifest 仅供纯准入/编译，不是 Provider 联调。
- 冻结输入覆盖参考数组顺序、首尾帧、音频、userSettings、原 prompt、JSON 和零值/false；不原地修改。原 catalog 活目录行 guard 不变。
- `check:root-cause-contracts` 自带 55 个 Node 用例通过，按真实任务 base 209f3f2d 验证本批 diff；最终脚本验证记 `contracts-final.log`。定向 ESLint 与 diff 检查记 `.tmp`；不跑 full/unit/contracts 全套、生产类型全检、App 或付费 Provider。
