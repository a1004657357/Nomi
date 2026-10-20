import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import type { ModelOption } from '../../../config/models'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from './availableModels'
const catalog = vi.hoisted(() => ({ options: [] as ModelOption[] }))
vi.mock('../../../config/modelCatalogCache', () => ({ preloadModelOptions: async (kind: string) => catalog.options.filter(o => o.kind === kind) }))

describe('all archetype storyboard defaults', () => {
  it('preserves each profile/vendor and combined catalog defaults', async () => {
    const snapshot: Record<string, unknown> = {}
    const all: ModelOption[] = []
    for (const profile of MODEL_ARCHETYPES) {
      const vendors = new Set(['kie', 'apimart', ...profile.modes.flatMap(m => Object.keys(m.vendorParams ?? {}))])
      for (const vendor of vendors) {
        const option: ModelOption = { value: profile.identifierPatterns[0] ?? profile.id, label: profile.label, kind: profile.kind, vendor, meta: { archetypeId: profile.id } }
        catalog.options = [option]
        all.push(option)
        snapshot[`${profile.id}/${vendor}`] = { image: await resolveStoryboardImageDefault(), video: await resolveStoryboardVideoDefault() }
      }
    }
    catalog.options = all
    snapshot.all = { image: await resolveStoryboardImageDefault(), video: await resolveStoryboardVideoDefault() }
    // Keep the official historical before/after evidence immutable; this integration
    // deliberately adds custom providers and variant-specific default parameters.
    const path = 'docs/plan/storyboard-anchor-policy-evidence/defaults-v0232-custom.json'
    if (process.env.ANCHOR_CAPTURE_DEFAULTS === '1') writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n')
    expect(snapshot).toEqual(JSON.parse(readFileSync(path, 'utf8')))
  })
})
