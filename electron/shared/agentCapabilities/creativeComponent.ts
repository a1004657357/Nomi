import { z } from 'zod'
import type { CapabilityContract } from './capabilityContract'
import type { ProjectBinding } from '../projectBinding'
import { creativeComponentArgumentSchemas as args, type CreativeComponentToolName } from './creativeComponentSchemas'

export { creativeComponentArgumentSchemas } from './creativeComponentSchemas'
export type { CreativeComponentToolName } from './creativeComponentSchemas'

export const CREATIVE_COMPONENT_EXECUTION_POLICY = Object.freeze({
  allowGeneration: false, requirePaidConfirmation: true, autoResubmit: false,
} as const)

export const creativeComponentReadInputSchema = z.discriminatedUnion('operation', [
  args.list_capability_recipes.extend({ operation: z.literal('list_capability_recipes') }),
  args.read_vibing_director.extend({ operation: z.literal('read_vibing_director') }),
])
export const creativeComponentWriteInputSchema = z.discriminatedUnion('operation', [
  args.apply_capability_recipe.extend({ operation: z.literal('apply_capability_recipe') }),
  args.save_creative_resource.extend({ operation: z.literal('save_creative_resource') }),
  args.handoff_model3d.extend({ operation: z.literal('handoff_model3d') }),
  args.apply_vibing_director_plan.extend({ operation: z.literal('apply_vibing_director_plan') }),
])
export const creativeComponentInputSchema = z.union([creativeComponentReadInputSchema, creativeComponentWriteInputSchema])
export type CreativeComponentInput = z.infer<typeof creativeComponentInputSchema>

export const creativeComponentResultSchema = z.object({
  status: z.enum(['read', 'applied', 'planned', 'awaiting_paid_confirmation', 'cancelled']),
  summary: z.string().min(1).max(2000),
  data: z.unknown().optional(),
  generationStarted: z.literal(false),
  autoResubmit: z.literal(false),
}).strict()
export type CreativeComponentResult = z.infer<typeof creativeComponentResultSchema>

export type CreativeComponentBridgeRequest = Readonly<{
  binding: ProjectBinding
  call: Readonly<{
    toolCallId: string
    toolName: CreativeComponentToolName
    args: Record<string, unknown>
    policy: typeof CREATIVE_COMPONENT_EXECUTION_POLICY
  }>
}>

export const CREATIVE_COMPONENT_READ_CAPABILITY = {
  id: 'creative.component.read', version: 1,
  aliases: { pi: 'list_capability_recipes' }, additionalAliases: { pi: ['read_vibing_director'] },
  inputSchema: creativeComponentReadInputSchema, outputSchema: creativeComponentResultSchema,
  effect: 'read', effectClass: 'reversible_local',
  execution: { port: 'canvas', availability: 'renderer_required' },
  exposure: 'internal_only', requiredScope: 'canvas:read', targetKind: 'project',
} as const satisfies CapabilityContract<z.infer<typeof creativeComponentReadInputSchema>, CreativeComponentResult>

export const CREATIVE_COMPONENT_WRITE_CAPABILITY = {
  id: 'creative.component.write', version: 1,
  aliases: { pi: 'apply_capability_recipe' },
  additionalAliases: { pi: ['save_creative_resource', 'handoff_model3d', 'apply_vibing_director_plan'] },
  inputSchema: creativeComponentWriteInputSchema, outputSchema: creativeComponentResultSchema,
  effect: 'reversible_write', effectClass: 'reversible_local', undoable: false,
  requiresPlanReview: true,
  operationPlanReview: {
    apply_capability_recipe: { allowReuse: false }, save_creative_resource: { allowReuse: false },
    handoff_model3d: { allowReuse: false }, apply_vibing_director_plan: { allowReuse: false },
  },
  execution: { port: 'canvas', availability: 'renderer_required' },
  exposure: 'internal_only', requiredScope: 'canvas:write', targetKind: 'project',
} as const satisfies CapabilityContract<z.input<typeof creativeComponentWriteInputSchema>, CreativeComponentResult>
