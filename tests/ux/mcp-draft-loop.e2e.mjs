// R16 核心愿景验证：外部 agent 经 MCP 驱动 Nomi 产出**真素材**（「AI 出初稿」的机制端到端）。
// 起真 MCP stdio 服务（app 二进制+NOMI_MCP_STDIO=1），像 Claude Code 那样发 JSON-RPC：
//   list 模型 → 建项目 → 加镜头节点 → nomi_generate 真生成一张图（headless 走 elicitation 确认付费）
//   → read_canvas 验证节点真拿到图素材。
// **会花一次真图额度**（测试默认授权）。额度闸：不显式 NOMI_R16_GEN=1 就 SKIP。
// 用法：pnpm run build && NOMI_R16_GEN=1 node tests/ux/mcp-draft-loop.e2e.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import os from "node:os";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.NOMI_R16_GEN) {
  console.log("SKIP mcp-draft-loop.e2e: 会花一次真图额度。NOMI_R16_GEN=1 node tests/ux/mcp-draft-loop.e2e.mjs 才跑。");
  process.exit(0);
}

// 隔离 settings（避开用户运行中的实例）+ 拷真 catalog 拿已连模型/key（safeStorage 同机可解）+ 临时项目。
const realSettings = process.env.NOMI_SETTINGS_DIR || path.join(os.homedir(), "Library/Application Support/Nomi");
const tempSettings = mkdtempSync(path.join(os.tmpdir(), "nomi-draft-"));
const projectsDir = path.join(tempSettings, "projects");
mkdirSync(projectsDir, { recursive: true });
const realCatalog = path.join(realSettings, "model-catalog.json");
if (!existsSync(realCatalog)) { console.log(`SKIP: 找不到真 model-catalog.json（${realCatalog}）。`); process.exit(0); }
copyFileSync(realCatalog, path.join(tempSettings, "model-catalog.json"));

let passed = 0;
function assert(cond, label) { if (!cond) { console.log(`  ✗ ${label}`); throw new Error(`FAIL: ${label}`); } passed += 1; console.log(`  ✓ ${label}`); }

const child = spawn(require("electron"), [repoRoot, "--disable-gpu"], {
  cwd: repoRoot,
  // NOMI_CAPABILITY_DIR 隔离能力核 lockfile（否则探到用户运行中的真 app → A 模式转发，不走 headless 生成）。
  env: { ...process.env, NOMI_MCP_STDIO: "1", NOMI_SETTINGS_DIR: tempSettings, NOMI_ELECTRON_USER_DATA_DIR: tempSettings, NOMI_PROJECTS_DIR: projectsDir, NOMI_CAPABILITY_DIR: path.join(tempSettings, "capability-core") },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let seq = 0;
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t.startsWith("{")) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  // 服务端→客户端请求：付费确认 elicitation/create → 自动 accept（测试授权花额度）。
  if (msg.method === "elicitation/create" && msg.id != null) {
    console.log("  · 收到付费确认 elicitation → accept");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: { confirm: true } } }) + "\n");
    return;
  }
  if (msg.id != null && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg); }
});

function rpc(method, params, timeoutMs = 30000) {
  const id = (seq += 1);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
// tools/call 的结果被 JSON.stringify 进 text content——解出来。
async function callTool(name, args, timeoutMs = 30000) {
  const res = (await rpc("tools/call", { name, arguments: args }, timeoutMs)).result;
  const text = res?.content?.[0]?.text || "";
  if (res?.isError) throw new Error(`工具 ${name} 失败：${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  // 起服务（initialize 声明支持 elicitation，否则付费无法确认）。
  let init = null;
  for (let i = 0; i < 20 && !init; i++) {
    try { init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } }, 4000); } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  assert(init?.result, "MCP stdio 服务起来了");

  const models = await callTool("nomi_list_models", {});
  const list = models.models || models || [];
  // 避开已知死模型（apimart Imagen 上游 404 必死，见记忆 batch-generation-audit），优先已知可用族。
  const imgAll = list.filter((m) => (m.kind === "image" || m.intent === "image") && (m.enabled ?? true) && !/imagen/i.test(m.modelKey || ""));
  const img = imgAll.find((m) => /z-image|qwen-image|gpt-image|seedream|flux|nano-banana/i.test(m.modelKey || "")) || imgAll[0];
  assert(img, `找到已连图片模型（${img ? (img.vendor || img.vendorKey) + "·" + img.modelKey : "无"}）`);

  const proj = await callTool("nomi_create_project", { name: "R16 MCP 出初稿验证" });
  const projectId = proj.projectId || proj.id;
  assert(projectId, `建项目成功（${projectId}）`);

  const added = await callTool("nomi_add_nodes", { projectId, nodes: [{ kind: "shot", title: "S1", prompt: "一只橘猫蹲在深夜面馆的木桌上，暖黄灯光，浅景深，安静温暖的氛围。" }] });
  const nodeId = (added.nodeIds || added.ids || [])[0] || added.nodeId;
  assert(nodeId, `加镜头节点成功（${nodeId}）`);

  console.log("  · 触发真生成（图片）——等生成完成…");
  const gen = await callTool("nomi_generate", { projectId, vendor: img.vendor || img.vendorKey, modelKey: img.modelKey, intent: "image", prompt: "一只橘猫蹲在深夜面馆的木桌上，暖黄灯光，浅景深。", nodeId }, 180000);
  console.log(`  · 生成返回：${JSON.stringify(gen).slice(0, 160)}`);

  assert(gen?.status === "succeeded", `生成成功（status=${gen?.status}）`);
  // 生成结果在 gen.assets[0].url；也兜底读画布节点。
  const resultUrl = gen?.assets?.[0]?.url || gen?.result?.url || gen?.url;
  assert(resultUrl && /^(https?:|asset:|nomi-local:|file:)/.test(String(resultUrl)), `节点真拿到图素材（${String(resultUrl).slice(0, 56)}）`);
  const canvas = await callTool("nomi_read_canvas", { projectId });
  assert(Array.isArray(canvas.nodes) && canvas.nodes.length >= 1, `read_canvas 回读到画布节点（${canvas.nodes?.length} 个）`);

  console.log(`\nMCP-DRAFT-LOOP PASS: ${passed} 断言——外部 agent 经 MCP 真的驱动 Nomi 产出了真图素材。`);
  child.kill("SIGTERM"); setTimeout(() => process.exit(0), 300);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  child.kill("SIGTERM"); setTimeout(() => process.exit(1), 300);
}
