import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { findDanglingClasses } from './check-dangling-tailwind.mjs'
import { loadRegisteredIcons, scanIconDictionary, scanIconSemantics } from './check-icon-semantics.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const canvas = 'src/workbench/generationCanvas/'
const repairedFiles = [
  'src/ui/onboarding/WebBridgeConnectionCard.tsx',
  ...[
    'components/BatchGenerateSettingsButton.tsx',
    'components/CapabilityAutoVisionReviewControl.tsx',
    'components/CapabilityRecipeInspector.tsx',
    'nodes/CapabilityHumanReviewControl.tsx',
    'nodes/CapabilityQualityReportPopover.tsx',
    'nodes/CapabilityResultCollection.tsx',
    'nodes/MoodVisionReviewControl.tsx',
    'nodes/MultiviewVisionReviewControl.tsx',
    'nodes/NodePromptPickerPopover.tsx',
    'nodes/PortraitComparisonDialog.tsx',
    'nodes/Scene3DEditor.tsx',
    'nodes/render/CanvasSkillNodeBody.tsx',
    'nodes/render/CreativeResourceNodeBody.tsx',
    'nodes/render/ImageComparisonNodeBody.tsx',
    'nodes/render/StoryboardTableNode.tsx',
    'nodes/scene3d/scene3dCharacterActionBar.tsx',
  ].map((file) => canvas + file),
]

test('reported 3D actions have one canonical icon at every existing entry', () => {
  const actions = scanIconSemantics(root, [canvas + 'nodes'])
  for (const [action, expected] of [
    ['scene3d.character.exitCameraControl', 'IconX'],
    ['scene3d.character.exitControl', 'IconX'],
    ['scene3d.fullscreen.openEditor', 'IconMaximize'],
  ]) {
    const icons = actions.get(action)
    assert.ok(icons, `${action} must remain discoverable`)
    assert.deepEqual([...icons.keys()], [expected], action)
    assert.ok(icons.get(expected).sites.size >= 2, `${action} must retain both entries`)
  }
})

test('all repaired surfaces reference Tailwind keys defined by the live configuration', () => {
  const sources = repairedFiles.map((file) => ({ file, text: read(file) }))
  assert.deepEqual(findDanglingClasses(read('tailwind.config.ts'), sources), [])
})

test('every obsolete transition use is replaced by separate duration and easing tokens', () => {
  for (const [file, expectedCount] of [
    ['components/BatchGenerateSettingsButton.tsx', 1],
    ['nodes/NodePromptPickerPopover.tsx', 1],
    ['nodes/Scene3DEditor.tsx', 2],
  ]) {
    const text = read(canvas + file)
    assert.ok(!text.includes('var(--nomi-transition-fast)'), file)
    assert.equal([...text.matchAll(/duration-nomi-fast ease-nomi-fast/g)].length, expectedCount, file)
  }
  const config = read('tailwind.config.ts')
  assert.ok(!config.includes("'--nomi-transition-fast':"), 'do not revive the retired compound token')
  assert.match(config, /'--nomi-duration-fast': '140ms'/)
  assert.match(config, /'--nomi-ease-fast': 'cubic-bezier/)
})

test('canonical actions retain their control and fullscreen callbacks', () => {
  const actions = read(canvas + 'nodes/scene3d/scene3dCharacterActionBar.tsx')
  assert.match(actions, /title=\{t\('scene3d\.character\.exitCameraControl'\)\} active onClick=\{drive\.exitCameraPossess\}/)
  assert.match(actions, /title=\{t\('scene3d\.character\.exitControl'\)\} active onClick=\{drive\.exitPossess\}/)
  assert.equal([...actions.matchAll(/onClick=\{onExit\}/g)].length, 2)
  const editor = read(canvas + 'nodes/Scene3DEditor.tsx')
  assert.equal([...editor.matchAll(/setFullscreen\(true\)/g)].length, 3)
})

test('all used library icons belong to the baseline or the reviewed semantic owner', () => {
  const baseline = JSON.parse(read('scripts/icon-semantics-baseline.json'))
  const known = new Set([...baseline.dictionary, ...loadRegisteredIcons(root)])
  const unregistered = [...scanIconDictionary(root).keys()].filter((icon) => !known.has(icon)).sort()
  assert.deepEqual(unregistered, [])
})

test('plane geometry uses an existing planar glyph, not an aircraft glyph', () => {
  const toolbar = read(canvas + 'nodes/scene3d/scene3dToolbar.tsx')
  assert.match(toolbar, /kind: 'plane' as const,[^\n]*icon: IconSquare/)
  assert.doesNotMatch(toolbar, /\bIconPlane\b/)
  assert.ok(!loadRegisteredIcons(root).has('IconPlane'), 'do not register the retired aircraft in explanatory copy')
})

test('fullscreen toolbar keeps its flexible title and removes only redundant auto margin', () => {
  const toolbar = read(canvas + 'nodes/scene3d/Scene3DFullscreenToolbar.tsx')
  assert.match(toolbar, /className="flex min-w-0 flex-1 items-center gap-2"/)
  assert.doesNotMatch(toolbar, /\bml-auto\b/)
  assert.match(toolbar, /className="flex min-w-0 max-w-\[72vw\] items-center gap-2 overflow-x-auto"/)
  assert.match(toolbar, /onClick=\{onClose\}/)
})
