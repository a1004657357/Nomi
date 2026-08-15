import { z } from "zod";

import {
  batchUpdateStoryboardShotsParamsSchema,
  plannedEdgeSchema,
  plannedNodeSchema,
} from "./canvasTools";

const filmBiblePatchSchema = z.record(z.unknown()).describe(
  "Partial Film Bible fields. Never include API keys, cookies, credentials, or provider-private settings.",
);

export const cinematicDirectorToolNames = [
  "read_project_summary",
  "read_film_bible",
  "read_storyboard",
  "read_shot_spec",
  "read_asset_registry",
  "read_provider_capabilities",
  "read_task_status",
  "propose_film_bible_patch",
  "propose_shot_patch",
  "propose_generation_plan",
  "propose_timeline_assembly",
  "apply_film_bible_patch",
  "apply_storyboard_patch",
  "create_asset_records",
  "select_asset_revision",
  "archive_asset_revision",
  "place_assets_on_timeline",
  "submit_generation_intent",
  "cancel_provider_task",
] as const;

export type CinematicDirectorToolName = (typeof cinematicDirectorToolNames)[number];

export const cinematicDirectorToolSchemas = {
  read_project_summary: z.object({}),
  read_film_bible: z.object({}),
  read_storyboard: z.object({}),
  read_shot_spec: z.object({
    shotId: z.union([z.string().min(1), z.number().int().positive()]),
  }),
  read_asset_registry: z.object({
    kind: z.string().min(1).optional(),
  }),
  read_provider_capabilities: z.object({}),
  read_task_status: z.object({
    nodeIds: z.array(z.string().min(1)).max(48).optional(),
  }),
  propose_film_bible_patch: z.object({
    summary: z.string().min(1),
    patch: filmBiblePatchSchema,
  }),
  propose_shot_patch: z.object({
    shotIndex: z.number().int().positive(),
    summary: z.string().min(1),
    patch: z.record(z.unknown()),
  }),
  propose_generation_plan: z.object({
    summary: z.string().min(1),
    intents: z.array(z.object({
      nodeId: z.string().min(1),
      modelKey: z.string().min(1).optional(),
      modeId: z.string().min(1).optional(),
      rationale: z.string().min(1).optional(),
    })).min(1).max(48),
    estimatedSubmissions: z.number().int().nonnegative().optional(),
    estimatedCostCny: z.number().nonnegative().optional(),
  }),
  propose_timeline_assembly: z.object({
    summary: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).max(48).optional(),
  }),
  apply_film_bible_patch: z.object({ patch: filmBiblePatchSchema }),
  apply_storyboard_patch: batchUpdateStoryboardShotsParamsSchema,
  create_asset_records: z.object({
    summary: z.string().min(1),
    nodes: z.array(plannedNodeSchema).min(1).max(24),
    edges: z.array(plannedEdgeSchema).max(48).optional(),
  }),
  select_asset_revision: z.object({
    nodeId: z.string().min(1),
    revisionId: z.string().min(1),
  }),
  archive_asset_revision: z.object({
    nodeId: z.string().min(1),
    revisionId: z.string().min(1),
  }),
  place_assets_on_timeline: z.object({
    nodeIds: z.array(z.string().min(1)).max(48).optional(),
  }),
  submit_generation_intent: z.object({
    nodeIds: z.array(z.string().min(1)).min(1).max(24),
  }),
  cancel_provider_task: z.object({
    vendor: z.string().min(1),
    runId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
  }).refine((value) => Boolean(value.runId || value.taskId), {
    message: "runId or taskId is required",
  }),
} as const;
