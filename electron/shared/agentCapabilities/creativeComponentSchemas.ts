import { z } from 'zod'
import { applyVibingDirectorPlanParamsSchema, readVibingDirectorParamsSchema } from '../../ai/vibingDirectorTools'

const capabilityRecipeOutputSchema = z.object({
  id: z.string().min(1).describe('Result ID'),
  label: z.string().min(1).describe('View label'),
  azimuth: z.number().min(-180).max(180).optional().describe("Azimuth, degrees"),
  elevation: z.number().min(-30).max(30).optional().describe("Elevation, degrees"),
  shotSize: z.string().min(1).optional().describe("Shot framing"),
});

export const capabilityRecipeRunParamsSchema = z.object({
  sourceNodeId: z
    .string()
    .min(1)
    .describe("Source node ID"),
  recipeId: z.string().min(1).describe("Recipe ID"),
  vendorKey: z.string().min(1).optional().describe("Model supplier"),
  modelKey: z
    .string()
    .min(1)
    .optional()
    .describe("Model ID"),
  variantId: z
    .string()
    .min(1)
    .optional()
    .describe("Variant ID"),
  modeId: z
    .string()
    .min(1)
    .optional()
    .describe("Mode ID"),
  params: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Recipe controls"),
  requestedOutputs: z
    .number()
    .int()
    .min(1)
    .max(9)
    .optional()
    .describe("Output count"),
  resourceIds: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe("Resource IDs"),
  outputs: z
    .array(capabilityRecipeOutputSchema)
    .max(6)
    .optional()
    .describe("View outputs"),
});

export const saveCreativeResourceParamsSchema = z.object({
  sourceNodeId: z.string().min(1).describe("Result node ID"),
  kind: z.enum(["style", "effect", "identity", "palette"]).describe('Reuse kind'),
  label: z.string().min(1).max(80).describe('Display label'),
  description: z.string().max(500).optional().describe('Reuse notes'),
  promptTokens: z.array(z.string().min(1)).max(24).default([]).describe('Prompt tokens'),
  license: z.object({
    source: z.string().optional().describe('Rights source'),
    license: z.string().optional().describe('License terms'),
    commercialUse: z.enum(["allowed", "restricted", "unknown"]).describe('Usage rights'),
    attribution: z.string().optional().describe('Attribution'),
  }).describe('Rights facts'),
});

export const model3dHandoffParamsSchema = z.object({
  sourceNodeId: z.string().min(1).describe("GLB node ID"),
  target: z.enum(["scene3d", "vibingDirector"]).describe('Destination'),
  targetNodeId: z
    .string()
    .min(1)
    .optional()
    .describe("Target node ID"),
  license: z
    .string()
    .max(200)
    .optional()
    .describe("GLB license note"),
});
export const creativeComponentArgumentSchemas = {
  list_capability_recipes: z.object({}).strict(),
  read_vibing_director: readVibingDirectorParamsSchema.strict(),
  apply_capability_recipe: capabilityRecipeRunParamsSchema.strict(),
  save_creative_resource: saveCreativeResourceParamsSchema.strict(),
  handoff_model3d: model3dHandoffParamsSchema.strict(),
  apply_vibing_director_plan: applyVibingDirectorPlanParamsSchema.strict(),
} as const

export type CreativeComponentToolName = keyof typeof creativeComponentArgumentSchemas
