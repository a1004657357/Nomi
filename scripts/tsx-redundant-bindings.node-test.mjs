import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { ESLint } from 'eslint'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = 'src/workbench/generationCanvas/nodes/'
const files = [
  'BaseGenerationNode.tsx',
  'GenerationNodePreviewBody.tsx',
  'render/CharacterCardNode.tsx',
  'render/SceneCardNode.tsx',
  'render/PropCardNode.tsx',
  'whiteboard/WhiteboardLeaferCanvas.tsx',
].map(file => dir + file)
const parse = file => ts.createSourceFile(file, fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const collect = (source, predicate) => {
  const result = []
  const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit) }
  visit(source)
  return result
}
const imports = source => collect(source, ts.isImportSpecifier).map(node => node.name.text)
const variables = source => collect(source, ts.isVariableDeclaration).filter(node => ts.isIdentifier(node.name)).map(node => node.name.text)
const namedFunction = (source, name) => collect(source, node => (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === name)[0]
const props = (source, name) => source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === name).type.members
const boundProps = fn => fn.parameters[0].name.elements.map(element => (element.propertyName ?? element.name).getText())

test('Base keeps the media measurement hook at the original hook position without an unused binding', () => {
  const source = parse(files[0])
  const body = namedFunction(source, 'BaseGenerationNodeImpl').body.statements
  const index = body.findIndex(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'useNodeMediaMeasurement')
  assert.ok(index > 0, 'must retain the hook as a direct, unconditional statement')
  assert.equal(body[index].expression.arguments[0].getText(source), 'node')
  assert.equal(body[index - 1].declarationList.declarations[0].name.getText(source), 'handleAddToTimelineAtPlayhead')
  assert.equal(body[index + 1].declarationList.declarations[0].name.getText(source), 'videoPreview')
  for (const name of ['MagneticConnectionHandle', 'ConnectionAnchorSide', 'completeNodeConnection']) assert.ok(!imports(source).includes(name), name)
  assert.ok(imports(source).includes('isImageLikeGenerationNodeKind'), 'retain the genuinely consumed image-kind predicate')
  const imageKindCalls = collect(source, node => ts.isCallExpression(node) && node.expression.getText(source) === 'isImageLikeGenerationNodeKind')
  assert.equal(imageKindCalls.length, 1)
  assert.equal(imageKindCalls[0].arguments[0].getText(source), 'node.kind')
  for (const name of ['mediaMeasurement', 'showFlowConnectionHandle']) assert.ok(!variables(source).includes(name), name)
})

for (const kind of ['Character', 'Scene', 'Prop']) {
  test(`${kind} card removes only the unused thumbnail import/constant and retains measurement/upload/title consumers`, () => {
    const source = parse(dir + `render/${kind}CardNode.tsx`)
    assert.ok(!imports(source).includes('localAssetThumbnailUrl'))
    assert.ok(!variables(source).includes('CARD_IMAGE_PREVIEW_SIZE'))
    const measurement = collect(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'mediaMeasurement')[0]
    assert.equal(measurement.initializer.getText(source), 'useNodeMediaMeasurement(node)')
    const calls = collect(source, ts.isCallExpression).map(node => node.expression.getText(source))
    assert.ok(calls.includes('useNodeImageUpload'))
    const tags = collect(source, ts.isJsxSelfClosingElement).map(node => node.tagName.getText(source))
    for (const name of ['DeferredNodeImage', 'UploadFallback', 'EditableNodeTitle']) assert.ok(tags.includes(name), name)
    const attributes = collect(source, ts.isJsxAttribute)
    assert.ok(attributes.some(node => node.name.getText(source) === 'onLoad' && node.initializer?.getText(source) === '{mediaMeasurement.onImageLoad}'))
  })
}

test('preview props retain their public fields; only the unconsumed parameter bindings disappear', () => {
  const source = parse(files[1])
  const members = props(source, 'GenerationNodePreviewBodyProps')
  assert.equal(members.find(node => node.name.getText(source) === 'shotIndex').type.getText(source), 'number | null')
  assert.equal(members.find(node => node.name.getText(source) === 'displayPrompt').type.getText(source), 'string')
  const bound = boundProps(namedFunction(source, 'GenerationNodePreviewBody'))
  assert.ok(!bound.includes('shotIndex'))
  assert.ok(!bound.includes('displayPrompt'))
  for (const name of ['onPanoramaFullscreen', 'onPanoramaScreenshot', 'onPanoramaFileChange', 'updateMediaDimensions']) assert.ok(bound.includes(name), name)
})

test('whiteboard progress stays in the public Props contract and all operation callbacks remain bound', () => {
  const source = parse(files[5])
  const progress = props(source, 'LeaferCanvasProps').find(node => node.name.getText(source) === 'removingBackgroundProgress')
  assert.ok(progress.questionToken)
  assert.equal(progress.type.getText(source), 'number | null')
  const bound = boundProps(namedFunction(source, 'LeaferCanvas'))
  assert.ok(!bound.includes('removingBackgroundProgress'))
  for (const name of ['removingBackgroundTargetId', 'onStrokeCommit', 'onLayerSelect', 'onObjectSelect', 'onObjectsGroup', 'onObjectDelete', 'onRemoveBackground']) assert.ok(bound.includes(name), name)
})

test('the actual unchanged ESLint configuration has no unused diagnostics or errors in the touched TSX', async () => {
  const results = await new ESLint({ cwd: root }).lintFiles(files)
  assert.deepEqual(results.flatMap(file => file.messages.filter(message => message.severity === 2 || message.ruleId === '@typescript-eslint/no-unused-vars').map(message => `${file.filePath}:${message.line} ${message.message}`)), [])
})
