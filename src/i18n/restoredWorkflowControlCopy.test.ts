import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'
import i18n, { DEFAULT_LOCALE } from './index'
import { copyOffenders, loadActionVocabulary, loadLocaleStrings, scanControlCopy } from '../../scripts/control-contract-copy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = ts.sys.readDirectory(path.join(root, 'src'), ['.tsx'], ['**/*.test.tsx'], ['**/*'])
const owned = (key: string): boolean => /^(?:scene3d|generationCommon|onboardingProviders)\./.test(key)
const affectedKeys = [
  "scene3d.coach.start",
  "generationCommon.parameters.selectTextModel",
  "onboardingProviders.dreamina.update",
  "scene3d.cameraMovePanel.exportFrames",
  "scene3d.environment.importPanorama",
  "scene3d.export.goCanvas",
  "scene3d.fullscreen.openEditor",
  "scene3d.moveHub.enterTrajectory",
  "scene3d.taskFlow.backToWorkViewShort",
  "scene3d.taskFlow.previewFinal",
  "scene3d.trajectory.list.addToGroup",
  "scene3d.trajectory.menu.addControlPoint",
  "scene3d.exportCard.replayInPlace",
  "scene3d.trajectory.enterEdit",
  "scene3d.trajectory.exitEdit",
  "scene3d.export.acknowledge"
]

afterEach(async () => { await i18n.changeLanguage(DEFAULT_LOCALE) })

it('all real controls in the assigned namespaces obey the existing compact-copy owner', () => {
  const strings = loadLocaleStrings(root)
  const hits = scanControlCopy(root, files).filter(hit => owned(hit.key))
  for (const key of affectedKeys) expect(hits.some(hit => hit.key === key && hit.kind === 'label')).toBe(true)
  const vocabulary = loadActionVocabulary(root)
  expect(copyOffenders({ root, files, strings, vocabulary }).filter(hit => owned(hit.key))).toEqual([])
})

it.each(['zh-CN', 'en-US'])('retains resolved keys, text-model identity and canonical acknowledgement: %s', async locale => {
  await i18n.changeLanguage(locale)
  for (const key of affectedKeys) {
    expect(i18n.exists(key)).toBe(true)
    expect(i18n.t(key)).not.toBe(key)
  }
  expect(i18n.t('generationCommon.parameters.selectTextModel')).toMatch(locale === 'zh-CN' ? /文本模型/ : /[Tt]ext [Mm]odel/)
  expect(i18n.t('scene3d.export.acknowledge')).toBe(i18n.t('common.confirm'))
})
