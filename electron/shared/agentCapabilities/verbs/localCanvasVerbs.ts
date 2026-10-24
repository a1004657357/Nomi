import {
  DIRECTOR_RENDER_CAPABILITY, GENERATION_BATCH_REQUEST_CAPABILITY,
  directorRenderInputSchema, generationBatchRequestInputSchema,
} from '../localCanvasOperations'
import type { VerbDeclaration } from '../verbDeclaration'

export function localCanvasVerbs(): VerbDeclaration[] {
  return [
    {
      name: 'nomi_render_director', contractId: DIRECTOR_RENDER_CAPABILITY.id,
      profiles: ['mcp'], profileReason: 'headlessHost', effect: 'reversible_local', nextAction: 'none',
      schema: directorRenderInputSchema,
      describe: {
        does: 'Render existing scene3d via local Blender to linked PNG/GLB nodes.',
        useWhen: 'The user wants a local director preview in Nomi desktop.',
        notWhen: 'Use nomi_generate_batch for existing model-generation nodes, or apply_vibing_director_plan for semantic scene edits.',
        params: 'sourceNodeId comes from nomi_read target=canvas; leaseHandle is the canvas:write project-session lease.',
      },
      examples: [{ when: 'Preview an existing scene:', arguments: { sourceNodeId: 'scene-1', stagePreset: 'studio' } }],
      promptGuidelines: ['Nomi desktop; canvas:write lease. No provider generation; returns IDs, not media. Not idempotent: never auto-resend after failure/timeout/cancellation; inspect state.'],
    },
    {
      name: 'nomi_generate_batch', contractId: GENERATION_BATCH_REQUEST_CAPABILITY.id,
      profiles: ['mcp'], profileReason: 'paidBoundary', effect: 'spend', nextAction: 'user_sees_spend_card',
      schema: generationBatchRequestInputSchema,
      describe: {
        does: 'Request native batch confirmation for 1-24 existing nodes.',
        useWhen: 'The user wants to generate existing canvas nodes.',
        notWhen: 'Use nomi_render_director for local scene3d previews, or draft_shots to prepare new shots.',
        params: 'nodeIds come from nomi_read target=canvas; leaseHandle is the generation:plan project-session lease.',
      },
      examples: [{ when: 'Request a batch confirmation:', arguments: { nodeIds: ['node-1', 'node-2'] } }],
      promptGuidelines: ['Nomi desktop; generation:plan lease. Pending human spending confirmation, not media; caller flags never approve spending. Deduplicates IDs in order, not an idempotency key. Never auto-resend after failure/timeout/cancellation or pending confirmation; inspect state and await explicit user intent.'],
    },
  ]
}
