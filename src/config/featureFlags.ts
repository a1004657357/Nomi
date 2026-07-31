const CAPABILITY_RECIPES_STORAGE_KEY = 'nomi.experimental.capabilityRecipes'

type CapabilityRecipesFlagInputs = {
  buildValue?: unknown
  localValue?: string | null
  sourceRun?: boolean
  dev?: boolean
}

export function resolveCapabilityRecipesEnabled({
  buildValue,
  localValue,
  sourceRun = false,
  dev = false,
}: CapabilityRecipesFlagInputs): boolean {
  const normalizedBuildValue = String(buildValue ?? '').trim()
  if (normalizedBuildValue === '1') return true
  if (normalizedBuildValue === '0') return false
  if (localValue === '1') return true
  if (localValue === '0') return false
  return sourceRun || dev
}

/**
 * Gate 8 capability slice stays review-controlled. Packaged builds default
 * off; explicit build/local overrides still win. Source checkout launches and
 * development builds default on so the test build exposes the code it contains.
 */
export function isCapabilityRecipesEnabled(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}
  let localValue: string | null = null
  if (typeof window !== 'undefined') {
    try {
      localValue = window.localStorage.getItem(CAPABILITY_RECIPES_STORAGE_KEY)
    } catch {
      localValue = null
    }
  }
  return resolveCapabilityRecipesEnabled({
    buildValue: env.VITE_NOMI_CAPABILITY_RECIPES,
    localValue,
    sourceRun: typeof window !== 'undefined' && window.nomiDesktop?.runtime?.sourceRun === true,
    dev: env.DEV === true,
  })
}

export function setCapabilityRecipesEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CAPABILITY_RECIPES_STORAGE_KEY, enabled ? '1' : '0')
}

export const capabilityRecipesFeatureFlagKey = CAPABILITY_RECIPES_STORAGE_KEY
