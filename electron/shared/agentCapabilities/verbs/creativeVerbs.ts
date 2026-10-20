import { creativeComponentArgumentSchemas } from '../creativeComponentSchemas'
import { CREATIVE_COMPONENT_READ_CAPABILITY, CREATIVE_COMPONENT_WRITE_CAPABILITY } from '../creativeComponent'
import type { VerbDeclaration } from '../verbDeclaration'

export function creativeVerbs(): VerbDeclaration[] {
  const read = CREATIVE_COMPONENT_READ_CAPABILITY.id
  const write = CREATIVE_COMPONENT_WRITE_CAPABILITY.id
  const declarations: Array<Pick<VerbDeclaration, 'name' | 'contractId' | 'describe' | 'examples'>> = [
    { name: 'list_capability_recipes', contractId: read,
      describe: { does: 'Read creative recipes, compatible models and reusable resources on this canvas.', useWhen: 'Find a supported recipe or reusable resource before planning a transformation.', notWhen: 'Use apply_capability_recipe to plan a selected recipe, or read_vibing_director to inspect a director scene.', params: 'No arguments. Returned recipe and resource ids are the inputs for subsequent plans.' }, examples: [{ when: 'Read available creative recipes:', arguments: {} }] },
    { name: 'read_vibing_director', contractId: read,
      describe: { does: 'Read the selected Blender Director scene, asset library and spatial relationships.', useWhen: 'Inspect a director node before proposing changes to its scene.', notWhen: 'Use look_at_canvas to find the director node, or apply_vibing_director_plan to change it.', params: 'directorNodeId comes from look_at_canvas.' }, examples: [{ when: 'Inspect a director:', arguments: { directorNodeId: 'director-1' } }] },
    { name: 'apply_capability_recipe', contractId: write,
      describe: { does: 'Prepare a derived creative recipe plan without starting generation or replacing the source.', useWhen: 'The user wants a transformation using a compatible recipe and existing source.', notWhen: 'Use list_capability_recipes to discover recipes first, or save_creative_resource to save an existing result. Paid execution needs a separate explicit user confirmation.', params: 'sourceNodeId comes from look_at_canvas; recipeId, controls and compatible model ids come from list_capability_recipes.' }, examples: [{ when: 'Prepare a multiview plan:', arguments: { sourceNodeId: 'image-1', recipeId: 'image.multiview.grid9' } }] },
    { name: 'save_creative_resource', contractId: write,
      describe: { does: 'Save an existing result as a reusable style, effect, identity or palette resource.', useWhen: 'The user wants to reuse an existing generated result with its license and prompt tokens.', notWhen: 'Use apply_capability_recipe to plan new outputs, or list_capability_recipes to inspect saved resources.', params: 'sourceNodeId comes from look_at_canvas. Supply the user-approved label, resource kind and license facts; do not invent rights.' }, examples: [{ when: 'Save a reusable style:', arguments: { sourceNodeId: 'image-1', kind: 'style', label: 'Ink style', license: { commercialUse: 'unknown' } } }] },
    { name: 'handoff_model3d', contractId: write,
      describe: { does: 'Place an existing generated GLB in Scene3D or a Blender Director asset library without generating.', useWhen: 'The user wants to stage an existing model while preserving its source and provenance.', notWhen: 'Use stage_shot for a staging reference, or read_vibing_director to inspect an existing director scene.', params: 'sourceNodeId and optional targetNodeId come from look_at_canvas. The source must already have a GLB result.' }, examples: [{ when: 'Hand off an existing GLB:', arguments: { sourceNodeId: 'model-1', target: 'vibingDirector' } }] },
    { name: 'apply_vibing_director_plan', contractId: write,
      describe: { does: 'Apply reviewed semantic scene, actor, relation and camera edits to a Blender Director node.', useWhen: 'The user wants local director scene edits based on a freshly read scene.', notWhen: 'Use read_vibing_director before editing, or handoff_model3d to import an existing GLB. This never renders or submits model generation.', params: 'directorNodeId, object and asset references come from read_vibing_director. Supply a summary and validated semantic actions.' }, examples: [{ when: 'Change the stage:', arguments: { directorNodeId: 'director-1', summary: 'Set up the studio', plan: { mode: 'amend', actions: [{ op: 'set_stage', preset: 'studio' }] } } }] },
  ]
  return declarations.map(declaration => ({
    ...declaration,
    schema: creativeComponentArgumentSchemas[declaration.name as keyof typeof creativeComponentArgumentSchemas],
    effect: declaration.contractId === read ? 'read' : 'reversible_local',
    nextAction: declaration.contractId === read ? 'none' : 'user_sees_review_card',
    profiles: ['internal'], profileReason: 'headlessHost', internalGroup: 'media',
    aliasBoundInput: { operation: declaration.name },
    promptGuidelines: ['Creative component writes never start generation. Do not automatically resend a write after failure, timeout, cancellation or a pending paid confirmation; inspect the current state and wait for explicit user intent.'],
  }))
}
