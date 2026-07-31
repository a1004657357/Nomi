import fs from "node:fs";
import path from "node:path";
import { buildDetailedStoryboardShotVideoPrompt, type PlanShot } from "../src/workbench/generationCanvas/agent/storyboardPlan";

const projectFile = path.resolve(process.argv[2] || "");
if (!projectFile || !fs.existsSync(projectFile)) {
  throw new Error("usage: pnpm exec tsx scripts/migrate-storyboard-full-reference.ts /absolute/project.json");
}

const document = JSON.parse(fs.readFileSync(projectFile, "utf8")) as Record<string, any>;
const payload = document.payload as Record<string, any>;
const plan = payload?.storyboardPlan as { title?: string; shots?: PlanShot[] } | undefined;
const canvas = payload?.generationCanvas as { nodes?: any[]; edges?: any[] } | undefined;
if (!plan?.shots || !canvas?.nodes || !canvas?.edges) {
  throw new Error("project does not contain storyboardPlan and generationCanvas");
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(path.dirname(projectFile), "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `project.before-full-reference.${timestamp}.json`);
fs.copyFileSync(projectFile, backupFile);

const modelKey = "jimeng-web-seedance-2.0";
const archetypeId = "jimeng-web-seedance-2";
const modeId = "multimodal";
const variantId = "fast";
const nodes = canvas.nodes;
let edges = canvas.edges;
let migratedVideos = 0;
let migratedEdges = 0;
let copiedReferenceEdges = 0;

for (const originalShot of plan.shots) {
  const shot: PlanShot = {
    ...originalShot,
    modelKey,
    variantId,
    modeId,
    params: {
      ...(originalShot.params || {}),
      ratio: "9:16",
      video_resolution: "720P",
    },
  };
  const prompt = buildDetailedStoryboardShotVideoPrompt(shot);
  Object.assign(originalShot, shot, {
    videoPrompt: prompt,
    ...((shot.shotKind ?? "video") !== "image" ? { prompt } : {}),
  });

  const video = nodes.find((node) => (
    node.kind === "video"
    && Number(node.shotIndex) === shot.index
    && /^镜头\s*\d+\s*·\s*视频/.test(String(node.title || ""))
  ));
  if (!video) continue;
  const duration = Number.isFinite(shot.durationSec) && shot.durationSec > 0 ? shot.durationSec : 5;
  video.prompt = prompt;
  video.meta = {
    ...(video.meta || {}),
    modelKey,
    modelAlias: modelKey,
    videoModel: modelKey,
    archetype: { id: archetypeId, modeId, variantId },
    ratio: "9:16",
    video_resolution: "720P",
    duration,
    durationSeconds: duration,
    videoDuration: duration,
    storyboardAppliedParamKeys: ["ratio", "video_resolution"],
    storyboardVideoReferenceStrategy: "full_reference",
  };

  const storyboardEdge = edges.find((edge) => (
    edge.target === video.id
    && edge.mode === "first_frame"
    && nodes.some((node) => node.id === edge.source && node.kind === "image")
  ));
  if (!storyboardEdge) {
    migratedVideos += 1;
    continue;
  }
  storyboardEdge.mode = "composition_ref";
  storyboardEdge.id = `edge-${storyboardEdge.source}-${storyboardEdge.target}-composition_ref`;
  migratedEdges += 1;

  const imageNodeId = storyboardEdge.source;
  const sourceEdges = edges.filter((edge) => (
    edge.target === imageNodeId
    && ["character_ref", "style_ref", "composition_ref", "reference"].includes(edge.mode)
  ));
  for (const sourceEdge of sourceEdges) {
    const duplicate = edges.some((edge) => (
      edge.source === sourceEdge.source
      && edge.target === video.id
      && edge.mode === sourceEdge.mode
    ));
    if (duplicate) continue;
    edges.push({
      id: `edge-${sourceEdge.source}-${video.id}-${sourceEdge.mode}`,
      source: sourceEdge.source,
      target: video.id,
      mode: sourceEdge.mode,
      order: edges.filter((edge) => edge.target === video.id).length,
    });
    copiedReferenceEdges += 1;
  }
  migratedVideos += 1;
}

const seenEdges = new Set<string>();
edges = edges.filter((edge) => {
  const key = `${edge.source}:${edge.target}:${edge.mode}`;
  if (seenEdges.has(key)) return false;
  seenEdges.add(key);
  return true;
});
canvas.edges = edges;

for (const node of nodes) {
  if (node.meta?.storyboardGroup === true || node.meta?.storyboardPlanSnapshot) {
    node.meta = { ...(node.meta || {}), storyboardPlanSnapshot: plan };
  }
}

const now = Date.now();
document.revision = Number(document.revision || 0) + 1;
document.updatedAt = now;
document.savedAt = now;
fs.writeFileSync(projectFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  projectFile,
  backupFile,
  migratedVideos,
  migratedEdges,
  copiedReferenceEdges,
  nodeCount: nodes.length,
  edgeCount: edges.length,
  modelKey,
  variantId,
  modeId,
  ratio: "9:16",
  resolution: "720P",
}, null, 2));
