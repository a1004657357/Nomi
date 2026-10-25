export const OPEN_CAPABILITY_RECIPE_EVENT = 'nomi-open-capability-recipes'

export type OpenCapabilityRecipeEventDetail = {
  nodeId?: string
  recipeId?: string
  skillNodeId?: string
  resourceIds?: string[]
}

export function openCapabilityRecipeInspector(
  nodeId: string,
  options: Omit<OpenCapabilityRecipeEventDetail, 'nodeId'> = {},
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<OpenCapabilityRecipeEventDetail>(OPEN_CAPABILITY_RECIPE_EVENT, {
      detail: { nodeId, ...options },
    }),
  )
}
