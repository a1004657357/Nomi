import { z } from 'zod'
import { applyVibingDirectorPlanParamsSchema, readVibingDirectorParamsSchema } from '../../ai/vibingDirectorTools'

const capabilityRecipeOutputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  azimuth: z.number().min(-180).max(180).optional().describe("Horizontal camera angle in degrees."),
  elevation: z.number().min(-30).max(30).optional().describe("Vertical camera angle in degrees."),
  shotSize: z.string().min(1).optional().describe("Framing, for example close-up / medium / wide."),
});

export const capabilityRecipeRunParamsSchema = z.object({
  sourceNodeId: z
    .string()
    .min(1)
    .describe("Existing source node id, or a clientId created in this turn. The source is never overwritten."),
  recipeId: z.string().min(1).describe("Recipe id returned by list_capability_recipes."),
  vendorKey: z.string().min(1).optional().describe("Supplier for modelKey."),
  modelKey: z
    .string()
    .min(1)
    .optional()
    .describe("Optional connected model override. Omit to let Nomi choose a compatible model."),
  variantId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional model variant paired with modelKey, such as v5_0_lite or vip."),
  modeId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional mode paired with modelKey. Omit to let Nomi choose a compatible mode."),
  params: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Recipe controls keyed exactly as listed by list_capability_recipes. For portrait.mood, use generationMode=single|sample5|matrix5x5; sample5 and matrix5x5 expand to 5 or 25 independent requests automatically."),
  requestedOutputs: z
    .number()
    .int()
    .min(1)
    .max(9)
    .optional()
    .describe("Requested result count. Recipe and model limits still apply."),
  resourceIds: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe("Saved style, effect, identity, or palette resource ids to apply."),
  outputs: z
    .array(capabilityRecipeOutputSchema)
    .max(6)
    .optional()
    .describe("Custom camera outputs for image.multiview.custom. One descriptor per requested view."),
});

export const saveCreativeResourceParamsSchema = z.object({
  sourceNodeId: z.string().min(1).describe("Existing canvas node whose current generated result becomes the resource source."),
  kind: z.enum(["style", "effect", "identity", "palette"]),
  label: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  promptTokens: z.array(z.string().min(1)).max(24).default([]),
  license: z.object({
    source: z.string().optional(),
    license: z.string().optional(),
    commercialUse: z.enum(["allowed", "restricted", "unknown"]),
    attribution: z.string().optional(),
  }),
});

export const model3dHandoffParamsSchema = z.object({
  sourceNodeId: z.string().min(1).describe("Existing model3d node with a generated GLB result."),
  target: z.enum(["scene3d", "vibingDirector"]),
  targetNodeId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional existing target node. Omit to create a new Scene3D or Blender Director node."),
  license: z
    .string()
    .max(200)
    .optional()
    .describe("License/provenance note used when copying the GLB into a Blender Director asset library."),
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
