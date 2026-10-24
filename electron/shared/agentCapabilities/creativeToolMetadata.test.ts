import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fieldDescriptions } from '../../../scripts/check-tool-face'
import { MODEL_FACING_TOOL_SPECS, mcpProfileTools } from './modelFacingToolRegistry'
import { capabilityContractById } from './registry'
import { toPublishedJsonSchema } from './modelVisibleJsonSchema'
import { MCP_TOOL_RESOLVER } from '../../capabilityCore/mcpToolCatalog'
import { MCP_CAPABILITY_RESOLVER } from '../../capabilityCore/mcpCapabilityProjection'
import { VERB_DECLARATIONS } from './verbDeclarations'

const original = {
  "internal": {
    "draft_shots": "43a70bcf16e76211d2398ba408b587ec43c05eda9a48ac03305f1b890a3d2c12",
    "list_capability_recipes": "99334726611ccf58a148b0814696bfa6fe08c1b2d027e946beccf5a74331c9aa",
    "read_vibing_director": "4d6ad5b15b881523415ac528be8156d81ca94a8777a00536928933ee67f5e2fa",
    "apply_capability_recipe": "61b6e72f98e2e1b777152c7e94ca7c582fa54d29e6be922f88ad63899977a45e",
    "save_creative_resource": "8353f04ddb6189586d916f26e4f73cf49794b5ce6092f9b7ce53d7df7c11e142",
    "handoff_model3d": "3d5598467ceb9e248a46345f9205e243c88ddb3ecdb8fac66811aba41cbc6b29",
    "apply_vibing_director_plan": "703d354748599e709a29cd8acf956e0f1da7e6d94e3fe44b66c824fa26cb5c58"
  },
  "mcp": {
    "nomi_render_director": {
      "schemaHash": "51cf1092b5907f4a50a5e6edf8fbd454b9ddd5020d259a24e35490a636cbb799",
      "method": "director.render",
      "annotations": null,
      "presentResult": false
    },
    "nomi_generate_batch": {
      "schemaHash": "2db5ba582bd1342e372873e1c4deb469f745898a29408143b400cd2e5a718d4a",
      "method": "generation.batch",
      "annotations": {
        "destructiveHint": true
      },
      "presentResult": false
    }
  }
}
function validationShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(validationShape)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(object).filter(key => key !== 'description' && key !== '$schema').sort().map(key => [
    key, key === 'required' && Array.isArray(object[key]) ? [...object[key]].sort() : validationShape(object[key]),
  ]))
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(validationShape(value))).digest('hex')

describe('creative metadata compatibility boundaries', () => {
  it('describes every creative and transition field without changing validation', () => {
    const specs = MODEL_FACING_TOOL_SPECS.filter(spec => spec.name in original.internal)
    expect(fieldDescriptions(specs.map(spec => ({ name: spec.name, schema: toPublishedJsonSchema(spec.schema) })))).toEqual([])
    for (const spec of specs) expect(digest(toPublishedJsonSchema(spec.schema))).toBe(original.internal[spec.name as keyof typeof original.internal])
  })

  it.each(Object.entries(original.mcp))('derives existing %s without changing schema, route, hints or result handling', (name, before) => {
    const projected = mcpProfileTools().find(tool => tool.name === name)
    expect(projected).toBeDefined()
    const tool = MCP_TOOL_RESOLVER.resolve(name)!
    expect(digest(tool.inputSchema)).toBe(before.schemaHash)
    expect(tool.method).toBe(before.method)
    expect(tool.annotations ?? null).toEqual(before.annotations)
    expect(Boolean(tool.presentResult)).toBe(before.presentResult)
    expect(tool.inputSchema).toEqual(projected!.inputSchema)
    expect(tool.description).toBe(projected!.description)
    expect(capabilityContractById(projected!.contractId)?.requiredScope).toBe(name === 'nomi_render_director' ? 'canvas:write' : 'generation:plan')
    expect(MCP_CAPABILITY_RESOLVER.resolve(name)).toBeUndefined()
    expect(MODEL_FACING_TOOL_SPECS.find(spec => spec.name === name)?.profiles).toEqual(['mcp'])
    const args = { leaseHandle: 'lease', projectId: 'project', sourceNodeId: 'scene', stagePreset: 'studio', nodeIds: ['a', 'a', 'b'] }
    expect(tool.build(args)).toEqual(name === 'nomi_render_director'
      ? { leaseHandle: 'lease', projectId: 'project', sourceNodeId: 'scene', stagePreset: 'studio' }
      : { leaseHandle: 'lease', projectId: 'project', nodeIds: ['a', 'a', 'b'] })
    expect(tool.description).toMatch(/lease/)
    expect(tool.description).toMatch(/never auto-resend/i)
    if (name === 'nomi_generate_batch') {
      expect(tool.description).toContain('human spending confirmation')
      expect(tool.description).toContain('not an idempotency key')
    }
  })

  it('retains full provenance, units and review discipline in the existing stable prompt channel', () => {
    for (const name of Object.keys(original.internal).filter(name => name !== 'draft_shots')) {
      const verb = VERB_DECLARATIONS.find(declaration => declaration.name === name)!
      const guidelines = verb.promptGuidelines!.join('\n')
      for (const fact of ['look_at_canvas', 'list_capability_recipes', 'fresh read_vibing_director', 'never invent rights', 'Y-up XYZ scene units', 'Blender X,-Z,Y', 'XYZ Euler degrees', '24 fps', 'Do not automatically resend a write after failure, timeout, cancellation or a pending paid confirmation']) {
        expect(guidelines).toContain(fact)
      }
      expect(verb.nextAction).toBe(verb.effect === 'read' ? 'none' : 'user_sees_review_card')
    }
  })

  it('covers all six existing creative tools in executable offline usecases', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../../tests/system/agent-tool-face-usecases.json', import.meta.url), 'utf8'))
    for (const name of Object.keys(original.internal).filter(name => name !== 'draft_shots')) {
      expect(manifest.canonicalVerbs).toContain(name)
      expect(manifest.cases.some((entry: { offline?: { operation?: string } }) => entry.offline?.operation === name)).toBe(true)
    }
  })
})
