import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { applyFeelExemptions, compareFeelBaseline } from './_feel-observer.mjs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const root = '../../src/workbench/generationCanvas/nodes/director/'
const fixture = JSON.parse(read('./fixtures/app74-director-fonts.json'))
const baseline = JSON.parse(read('./feel-baseline.json'))
const exemptions = JSON.parse(read('./feel-exemptions.json'))
const owners = [
  { name: 'preview readout', file: 'panels/viewport/PipViewport.tsx', tag: 'span', anchor: 'director.camera.pipFov' },
  { name: 'grid unit', file: 'panels/fields/SliderNumberField.tsx', tag: 'span', anchor: 'unit' },
  { name: 'insert-keyframe key', file: 'timeline/TimelineHeader.tsx', tag: 'kbd', anchor: 'DIRECTOR_HOTKEYS.insertKeyframe' },
  { name: 'empty-timeline guidance', file: 'timeline/DirectorTimeline.tsx', tag: 'span', anchor: 'director.timeline.emptyHint' },
]

function nodes(source, predicate) {
  const found = []
  const visit = (node) => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const parse = (text) => ts.createSourceFile('owner.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const attribute = (opening, name) => opening.attributes.properties.find((node) => ts.isJsxAttribute(node) && node.name.text === name)

function actualFontTokens() {
  const ast = parse(read('../../tailwind.config.ts'))
  const [declaration, ...extra] = nodes(ast, (node) => ts.isPropertyAssignment(node)
    && node.name.getText(ast) === 'fontSize' && ts.isObjectLiteralExpression(node.initializer))
  if (!declaration || extra.length) throw new Error('fontSize must have exactly one actual Tailwind owner')
  return Object.fromEntries(declaration.initializer.properties.filter((node) => ts.isPropertyAssignment(node)
    && ts.isStringLiteral(node.initializer) && /^\d+px$/.test(node.initializer.text))
    .map((node) => [`text-${node.name.text}`, Number.parseInt(node.initializer.text, 10)]))
}

function resolveOwner(owner, text = read(root + owner.file)) {
  const ast = parse(text)
  const matches = nodes(ast, (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === owner.tag
    && node.children.some((child) => ts.isJsxExpression(child) && child.expression
      && (owner.anchor === 'unit' ? child.expression.getText(ast) === 'unit' : child.expression.getText(ast).includes(owner.anchor))))
  if (matches.length !== 1) throw new Error(`${owner.name}: expected exactly one real JSX owner, found ${matches.length}`)
  const tokens = actualFontTokens()
  for (let node = matches[0]; node; node = node.parent) {
    if (!ts.isJsxElement(node)) continue
    const declaration = attribute(node.openingElement, 'className')?.initializer
    if (!declaration || !ts.isStringLiteral(declaration)) continue
    const fonts = declaration.text.split(/\s+/).filter((token) => Object.hasOwn(tokens, token))
    if (fonts.length > 1) throw new Error(`${owner.name}: conflicting font tokens`)
    if (fonts.length) return { px: tokens[fonts[0]], token: fonts[0], declaration, ast, element: matches[0] }
  }
  throw new Error(`${owner.name}: no statically owned font token`)
}

function replaceOwnedToken(owner, token) {
  const text = read(root + owner.file)
  const current = resolveOwner(owner, text)
  const declaration = current.declaration
  return text.slice(0, declaration.getStart(current.ast))
    + declaration.getText(current.ast).replace(current.token, token) + text.slice(declaration.end)
}

describe('App74 four Director font owners use the existing readable caption token', () => {
  for (const owner of owners) {
    it(`${owner.name} resolves to the exact 12px token`, () => {
      expect(resolveOwner(owner).px).toBe(12)
    })
  }

  it('reads the existing tokens without changing the global micro scale', () => {
    expect(actualFontTokens()).toMatchObject({ 'text-micro': 11, 'text-caption': 12 })
  })

  it('replays the last real drift through the unchanged shipped FEEL owners', () => {
    expect(fixture.source.recordIndex).toBe(23)
    expect(fixture.findings).toHaveLength(11)
    const replay = applyFeelExemptions(fixture, exemptions)
    expect(replay.exempted).toHaveLength(7)
    expect(replay.result.findings.map(({ target, text, fontSizes }) => ({ target, text, fontSizes }))).toEqual([
      { target: ['span'], text: ['\u2014'], fontSizes: [11] },
      { target: ['span'], text: ['m'], fontSizes: [11] },
      { target: ['kbd'], text: ['I'], fontSizes: [11] },
      { target: ['span'], text: ['\u5728 3D \u753b\u5e03\u4e2d\u4e3a\u89d2\u8272 / \u673a\u4f4d\u624b\u7ed8\u8f68\u8ff9 (4)\uff0c\u6216\u5728\u5de6\u680f\u70b9\u51fb\u300c+ \u6dfb\u52a0\u8f68\u9053\u300d'], fontSizes: [11] },
    ])
    expect(compareFeelBaseline(replay.result, baseline)).toEqual(fixture.expectedDrift)
    expect(fixture.expectedDrift).toEqual([{ rule: 'font-size', actual: 4, allowed: 0, kind: 'new' }])
  })

  it('rejects missing owners and cannot be satisfied by unrelated caption text', () => {
    for (const owner of owners) {
      const text = read(root + owner.file)
      const original = resolveOwner(owner, text)
      expect(() => resolveOwner(owner, text.replaceAll(owner.anchor, 'removed-owner'))).toThrow('exactly one real JSX owner')
      expect(() => resolveOwner(owner, text + '\nconst duplicateOwner = (' + original.element.getText(original.ast) + ');\n')).toThrow('found 2')
      expect(resolveOwner(owner, text + '\n// unrelated text-caption\n').px).toBe(original.px)
    }
  })

  it('isolated in-memory token controls detect 12px and reject the real 11px regression', () => {
    for (const owner of owners) {
      expect(resolveOwner(owner, replaceOwnedToken(owner, 'text-caption')).px).toBe(12)
      expect(resolveOwner(owner, replaceOwnedToken(owner, 'text-micro')).px).toBe(11)
    }
  })

  it('the real guard still blocks an extra unreviewed element with the same text', () => {
    const replay = applyFeelExemptions(fixture, exemptions).result
    const extra = { ...replay, findings: [...replay.findings, replay.findings[0]] }
    expect(compareFeelBaseline(extra, baseline)).toEqual([{ rule: 'font-size', actual: 5, allowed: 0, kind: 'new' }])
  })

  it('the observed m is supplied by the actual grid-height caller, not a new fixture field', () => {
    const ast = parse(read(root + 'panels/inspector/SceneLayerInspector.tsx'))
    const fields = nodes(ast, (node) => ts.isJsxSelfClosingElement(node)
      && node.tagName.getText(ast) === 'SliderNumberField'
      && attribute(node, 'label')?.getText(ast).includes('director.inspector.gridHeight'))
    expect(fields).toHaveLength(1)
    expect(attribute(fields[0], 'unit')?.initializer?.text).toBe('m')
  })
})
