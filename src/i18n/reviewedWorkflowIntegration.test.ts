import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import i18n, { setAppLocale } from './index'
import { CapabilityCameraOutputsEditor } from '../workbench/generationCanvas/components/CapabilityCameraOutputsEditor'
import { createRecipeCameraOutputs, type RecipeCameraOutput } from '../../electron/shared/canvas/sourceDefaults'
import { BUILTIN_CAPABILITY_RECIPES } from '../config/capabilityRecipes'
import { buildAgentModelEntries } from '../workbench/generationCanvas/agent/availableModels'
import { selectCapabilityRecipeTarget } from '../workbench/generationCanvas/agent/capabilityRecipeAgent'
import { capabilityRecipeRunParamsSchema } from '../../electron/shared/agentCapabilities/creativeComponentSchemas'

afterEach(() => setAppLocale('zh-CN'))

describe.each(['zh-CN', 'en'] as const)('reviewed input boundaries: %s', locale => {
  it('edits the actual raw camera value without translating or mutating its source', () => {
    setAppLocale(locale)
    const outputs = Object.freeze(createRecipeCameraOutputs(1, []).map(output => Object.freeze(output)))
    const before = JSON.stringify(outputs)
    const changes: Array<{ index: number; patch: Partial<RecipeCameraOutput> }> = []
    let nameInput: React.InputHTMLAttributes<HTMLInputElement> | undefined
    function Probe() {
      const tree = CapabilityCameraOutputsEditor({ outputs, count: 1, onChange: (index, patch) => changes.push({ index, patch }) })
      const visit = (node: React.ReactNode): void => {
        if (Array.isArray(node)) return node.forEach(visit)
        if (!React.isValidElement<{ children?: React.ReactNode; type?: string }>(node)) return
        if (node.type === 'input' && node.props.type !== 'number') nameInput = node.props
        visit(node.props.children)
      }
      visit(tree)
      return tree
    }
    const html = renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(Probe)))
    expect(nameInput?.value).toBe('机位 1')
    expect(html).toContain(i18n.t('canvasComponents.cameraName', { v0: 1 }))
    expect(changes).toEqual([])
    if (!nameInput?.onChange) throw new Error('Actual camera input handler is missing')
    nameInput.onChange({ target: { value: `${nameInput.value}A` } } as React.ChangeEvent<HTMLInputElement>)
    expect(changes).toEqual([{ index: 0, patch: { label: '机位 1A' } }])
    nameInput.onChange({ target: { value: 'View 1A' } } as React.ChangeEvent<HTMLInputElement>)
    expect(changes[1]).toEqual({ index: 0, patch: { label: 'View 1A' } })
    expect(JSON.stringify(outputs)).toBe(before)
  })

  it('passes the explicitly selected provider through the actual Inspector request expression', () => {
    setAppLocale(locale)
    const file = 'src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx'
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let expression: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'applyCanvasToolCall'
        && node.arguments[0]?.getText(source) === "'apply_capability_recipe'") expression = node.arguments[1]
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!expression) throw new Error('Actual recipe submission expression is missing')
    const selectedTarget = { vendorKey: 'kie', modelKey: 'gpt-image-2', modeId: 'i2i' }
    const build = new Function('source', 'selectedRecipe', 'selectedTarget', 'params', 'count', 'applicableResourceIds', 'isCustomCamera', 'cameraOutputs', 'visionReview', 'selectedVisionReviewModel', `return (${expression.getText(source)})`)
    const args = build({ id: 'user-image' }, { id: 'portrait.refine' }, selectedTarget, { identityLock: true }, 1, ['user-resource'], false, [], { enabled: false }, undefined)
    expect(args).toMatchObject({ sourceNodeId: 'user-image', vendorKey: 'kie', modelKey: 'gpt-image-2', modeId: 'i2i', resourceIds: ['user-resource'] })
    const params = capabilityRecipeRunParamsSchema.parse(args)
    const recipe = BUILTIN_CAPABILITY_RECIPES.find(item => item.id === 'portrait.refine')!
    const entries = buildAgentModelEntries(['openai', 'kie'].map(vendor => ({
      value: 'gpt-image-2', modelKey: 'gpt-image-2', modelAlias: 'GPT Image 2', label: 'GPT Image 2', vendor, meta: { archetypeId: 'gpt-image-2' },
    })))
    expect(selectCapabilityRecipeTarget(recipe, entries, params).vendorKey).toBe('kie')
    expect(() => selectCapabilityRecipeTarget(recipe, entries, { modelKey: 'gpt-image-2', modeId: 'i2i' })).toThrow()
    expect(selectedTarget).toEqual({ vendorKey: 'kie', modelKey: 'gpt-image-2', modeId: 'i2i' })
  })
})
