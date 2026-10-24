import { z } from 'zod'
import type { CapabilityContract } from './capabilityContract'

// Existing desktop-only methods. Registering their metadata does not add execution routes.
export const directorRenderInputSchema = z.object({
  sourceNodeId: z.string().min(1).describe('Scene3d node ID from nomi_read target=canvas'),
  stagePreset: z.enum(['empty', 'studio', 'coffee_shop', 'city_street', 'interior_room']).optional().describe('Stage preset'),
}).strict()

export const generationBatchRequestInputSchema = z.object({
  nodeIds: z.array(z.string().min(1)).min(1).max(24).describe('Node IDs from nomi_read target=canvas'),
}).strict()

const directorRenderOutputSchema = z.object({
  jobId: z.string(), sourceNodeId: z.string(), previewNodeId: z.string(), modelNodeId: z.string(),
  blenderVersion: z.string().optional(),
})
const generationBatchRequestOutputSchema = z.object({
  awaitingConfirmation: z.literal(true), nodeIds: z.array(z.string()),
})

export const DIRECTOR_RENDER_CAPABILITY = {
  id: 'director.render', version: 1, aliases: { mcp: 'nomi_render_director' },
  inputSchema: directorRenderInputSchema, outputSchema: directorRenderOutputSchema,
  effect: 'reversible_write', effectClass: 'reversible_local', undoable: false,
  execution: { port: 'canvas', availability: 'renderer_required' },
  exposure: 'mcp_safe', requiredScope: 'canvas:write', targetKind: 'project',
} as const satisfies CapabilityContract<z.infer<typeof directorRenderInputSchema>, z.infer<typeof directorRenderOutputSchema>>

// A request still touches the spend boundary: retain the existing destructive hint,
// but only the unchanged desktop confirmation handler can authorize actual generation.
export const GENERATION_BATCH_REQUEST_CAPABILITY = {
  id: 'generation.batch', version: 1, aliases: { mcp: 'nomi_generate_batch' },
  inputSchema: generationBatchRequestInputSchema, outputSchema: generationBatchRequestOutputSchema,
  effect: 'paid', effectClass: 'spend', undoable: false,
  execution: { port: 'canvas', availability: 'renderer_required' },
  exposure: 'mcp_safe', requiredScope: 'generation:plan', targetKind: 'project',
} as const satisfies CapabilityContract<z.infer<typeof generationBatchRequestInputSchema>, z.infer<typeof generationBatchRequestOutputSchema>>
