import { describe, expect, it } from 'vitest'
import { getDefaultCategoryForNodeKind } from '../../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../../model/generationNodeKinds'
import { getGenerationNodePlugin, getQuickAddGenerationNodePlugins } from '../renderRegistry'

describe('VIBING Director node registry', () => {
  it('is a standalone scene-category workspace available from manual add', () => {
    const plugin = getGenerationNodePlugin('vibingDirector')

    expect(plugin.label).toBe('VIBING Director')
    expect(plugin.defaultTitle).toBe('VIBING Director')
    expect(getGenerationNodeExecutionKind('vibingDirector')).toBeUndefined()
    expect(getDefaultCategoryForNodeKind('vibingDirector')).toBe('scene')
    expect(getQuickAddGenerationNodePlugins().some((item) => item.kind === 'vibingDirector')).toBe(true)
  })
})
