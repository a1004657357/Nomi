import { describe, expect, it } from 'vitest'
import { canonicalArchetypeIdentifier } from './identifierAliases'

describe('canonicalArchetypeIdentifier', () => {
  it.each(['gpt-4o-image', 'gpt_image_2', 'codex-img2', 'codex-imagegen-img2'])(
    'canonicalizes the exact legacy identity %s without discarding its namespace', alias => {
      expect(canonicalArchetypeIdentifier(alias)).toBe('gpt-image-2')
      expect(canonicalArchetypeIdentifier(`relay/${alias.toUpperCase()}`)).toBe('relay/gpt-image-2')
    },
  )

  it.each(['constructor', '__proto__', 'prototype', 'codex-img25', 'gpt-image-2.5', 'codex-img2-fast', 'MiniMax-H3', ''])(
    'preserves unknown or distinct identity %s', identity => {
      expect(canonicalArchetypeIdentifier(identity)).toBe(identity)
    },
  )
})
