// 门岗 T10（设计正本 §8.2）：题库里 `firstTool` 覆盖全部内部面动词，题库里出现的动词必须存在。
//
// 「20 个动词」不靠正则扫源码数——从注册表投影 `modelFacingToolSpecs("internal")` 取真实发布的名单，
// 与题库 `canonicalVerbs` 逐个对账。多一个、少一个、名字不同都红；没有任何跳过分支。
import fs from "node:fs";
import { validateAgentToolFaceUsecases } from "./agent-tool-face-usecases-lib.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { modelFacingToolSpecs } from "../electron/shared/agentCapabilities/modelFacingToolRegistry";
import { getSkillDiscoveryRoots, isSkillSelectableInWorkbench } from "../electron/skills/skillStore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests/system/agent-tool-face-usecases.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  schemaVersion: number;
  canonicalVerbs: string[];
  metrics: string[];
  banks?: string[];
  cases: Array<{ id: string; firstTool: string; tools?: string[]; proof?: string[]; skillKey?: string }>;
};

const published = modelFacingToolSpecs("internal").map((spec) => spec.name);
const errors: string[] = validateAgentToolFaceUsecases(manifest, published);

// 21 = 设计正本的 20 个动词 + 2026-09-21 的通用反问 `ask_user`。这个数手写而不是从
// 投影数出来，理由与 `check-model-face-frozen.mjs` 里那个一样：动它就等于一次签名。
if (published.length !== 21) errors.push(`internal profile publishes ${published.length} verbs, the design says 21: ${published.join(", ")}`);

// ── 技能面：题库里点名的每一条技能都必须真的装着，而且真的能在 composer 里选中 ──────────
//
// 为什么这条要机器管：2026-09-15 的 22 句题库里有 12 句是「用户在 composer 里点了某条技能」。
// 技能目录改个名、frontmatter 少一行 `selectable-in-workbench`，这 12 句当场失去意义——
// 而它们照样是一份读起来很像话的 JSON，没有任何东西会红（R28：能让门岗拦的别留给人）。
// tsx 按 CJS 跑这份脚本（仓库没有 "type": "module"），顶层不能 await——技能那一段收进一个 async 立即函数。
void (async () => {
  // 目录由 pi 的加载器给（岛上、async），这里直接吃岛——不经 `readSkillRecords()` 的 CJS 桥：桥要编译产物，门岗跑在源码上。
  const { discoverSkillRecords } = await import("../electron/agentLane/laneSkillCatalog.mjs");
  const installed = (await discoverSkillRecords(getSkillDiscoveryRoots())).records.filter(isSkillSelectableInWorkbench);
  const selectable = new Set(installed.map((record) => record.name));
  const selectableDirs = new Set(installed.map((record) => record.directoryName));
  const checkSkillKey = (where: string, skillKey: string) => {
    if (!selectable.has(skillKey) && !selectableDirs.has(skillKey)) {
      errors.push(`${where}: skillKey is not an installed workbench-selectable Skill: ${skillKey}`);
    }
  };
  for (const entry of manifest.cases) if (entry.skillKey) checkSkillKey(entry.id, entry.skillKey);

  // 真实模型腿的题库也登在这里（`NOMI_R30_BANK`），不另开一个门岗：一份题库两个读者，
  // 判据只能有一个家。题库文件没了、或它点名的技能没了，都在这里红。
  for (const bank of manifest.banks ?? []) {
    const bankPath = path.join(root, bank);
    if (!fs.existsSync(bankPath)) { errors.push(`declared bank is missing: ${bank}`); continue; }
    let cases: Array<{ id?: unknown; skillKey?: unknown }> = [];
    try {
      cases = (JSON.parse(fs.readFileSync(bankPath, "utf8")) as { cases?: unknown }).cases as typeof cases ?? [];
    } catch (error) { errors.push(`declared bank is not valid JSON: ${bank} (${(error as Error).message})`); continue; }
    if (cases.length < 20) errors.push(`${bank}: a real-model bank needs at least 20 user sentences, got ${cases.length}`);
    for (const entry of cases) {
      if (typeof entry.skillKey === "string" && entry.skillKey) checkSkillKey(`${bank}#${String(entry.id)}`, entry.skillKey);
    }
  }

  if (errors.length > 0) {
    console.error(["Agent tool-face usecase manifest: FAIL", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exit(1);
  }
  console.log(`Agent tool-face usecase manifest: PASS · verbs=${published.length} · cases=${manifest.cases.length} · metrics=${manifest.metrics.length}`);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
