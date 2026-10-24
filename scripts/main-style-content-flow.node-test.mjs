import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { contentFlowCases, contentFlowFiles, findContentFlowRow } from './lib/mainStyleContentFlowCases.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('all 17 reviewed source occurrences use content flow rather than edge distribution', () => {
  assert.equal(contentFlowCases.length, 17)
  assert.equal(contentFlowFiles.length, 12)
  for (const file of contentFlowFiles) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(text, /\b(?:ml-auto|justify-between)\b/, file)
    assert.doesNotMatch(text, /from\s+['"][^'"]*(?:ai\/v4|AgentPanelV4Row)/, 'presentation rows must not depend on the agent feature')
  }
})

test('each actual row wraps with the owner gap and never stretches a label to hide metadata alignment', () => {
  for (const entry of contentFlowCases) {
    const { node, source, text } = findContentFlowRow(root, entry)
    const classes = node.openingElement.attributes.properties.find((attribute) => attribute.name?.getText(source) === 'className')?.getText(source) ?? ''
    assert.match(classes, /flex-wrap/, entry.id)
    assert.match(classes, /gap-1\.5/, entry.id)
    assert.doesNotMatch(text, /\b(?:ms-auto|flex-1|grow)\b|(?:marginLeft|marginInlineStart|justifyContent)\s*[:=]/, entry.id)
  }
})

test('close and selection controls keep their existing explicit hit sizes', () => {
  const portrait = findContentFlowRow(root, contentFlowCases.find((entry) => entry.id === 'portrait')).text
  assert.equal([...portrait.matchAll(/grid size-8 shrink-0/g)].length, 4)
  const video = findContentFlowRow(root, contentFlowCases.find((entry) => entry.id === 'keyframe-header')).text
  assert.match(video, /grid size-9 shrink-0/)
  const checkbox = findContentFlowRow(root, contentFlowCases.find((entry) => entry.id === 'keyframe-check')).text
  assert.match(checkbox, /size-5 shrink-0/)
  const auto = findContentFlowRow(root, contentFlowCases.find((entry) => entry.id === 'auto-review')).text
  assert.match(auto, /min-h-7/)
  assert.match(auto, /size-4 shrink-0/)
})

test('long keyframe and camera field labels are bounded and may break unspaced text', () => {
  const video = findContentFlowRow(root, contentFlowCases.find((entry) => entry.id === 'keyframe-selection')).text
  assert.match(video, /max-w-full[^"\n]*\[overflow-wrap:anywhere\][^"\n]*">抽帧数量/)
  const camera = fs.readFileSync(path.join(root, 'src/workbench/generationCanvas/nodes/model3d/Model3DCameraNodeBody.tsx'), 'utf8')
  assert.match(camera, /<label className="grid min-w-0 max-w-full[^"\n]*\[overflow-wrap:anywhere\]/)
})
