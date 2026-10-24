import i18n from './index'
import { actorSourceName, canvasSourceDefaults, generationModeRationale, MODEL3D_VIEW_SOURCE_NAMES, PROP_SOURCE_NAMES, recipeCameraOutputLabel, scene3dCaptureSource } from '../../electron/shared/canvas/sourceDefaults'
import { directorActionSource, directorProtocolSource } from '../../electron/shared/blenderDirectorProtocolText'
import type { TranslationKey } from './translationKey'

const displayKeys = new Map<string, TranslationKey>([
  ['特写', 'canvasComponents.closeUp'],
  ['近景', 'canvasComponents.mediumCloseUp'],
  ['中景', 'canvasComponents.mediumShot'],
  ['全景', 'canvasComponents.wideShot'],
  ['图片', 'canvasComponents.image'],
  ['视频封面', 'canvasComponents.videoPoster'],
  ['ChatGPT 图像', 'canvasComponents.chatgptImages'],
  ['即梦 Web', 'canvasComponents.jimengWeb'],
  [directorProtocolSource.running(), 'canvasComponents.blenderIsExecutingTheDirectorPlan'],
  [canvasSourceDefaults.storyboardGroupTitle(''), 'customWorkflow.unnamedStoryboardGroup'],
])

// Only documented canonical formats enter this display adapter; saved values are untouched.
const canonicalSources = [
  { key: 'scene3d.capture.stagingReference', source: scene3dCaptureSource.stagingReference() },
  { key: 'scene3d.capture.cameraMoveReference', source: scene3dCaptureSource.cameraMoveReference() },
  { key: 'scene3d.capture.viewportTitle', source: scene3dCaptureSource.viewportTitle() },
  { key: 'scene3d.capture.cameraTitle', source: scene3dCaptureSource.cameraTitle('{{name}}') },
  { key: 'scene3d.fullscreen.recordedTakeTitle', source: scene3dCaptureSource.recordedTakeTitle() },
  { key: 'scene3d.fullscreen.cameraMoveFramesTitle', source: scene3dCaptureSource.cameraMoveFramesTitle('{{camera}}') },
  { key: 'scene3d.fullscreen.cameraMoveFrameTitle', source: scene3dCaptureSource.cameraMoveFrameTitle('{{camera}}', '{{frame}}') },
  { key: 'scene3d.environment.defaultName', source: scene3dCaptureSource.panoramaName() },
  { key: 'customWorkflow.directorPreflightRejected', source: directorProtocolSource.preflightRejected('{{v0}}') },
  { key: 'customWorkflow.directorNoJson', source: directorProtocolSource.noJson() },
  { key: 'customWorkflow.directorInvalidRoot', source: directorProtocolSource.invalidRoot() },
  { key: 'customWorkflow.directorExplanationOnly', source: directorProtocolSource.explanationOnly() },
  { key: 'customWorkflow.directorMissingNodeId', source: directorProtocolSource.missingNodeId() },
  { key: 'customWorkflow.directorWrongPlanNode', source: directorProtocolSource.wrongPlanNode('{{v0}}', '{{v1}}') },
  { key: 'customWorkflow.directorInvalidJsonPlan', source: directorProtocolSource.invalidJsonPlan() },
  { key: 'customWorkflow.directorWrongReadNode', source: directorProtocolSource.wrongReadNode('{{v0}}', '{{v1}}') },
  { key: 'customWorkflow.directorReadNodeRequired', source: directorProtocolSource.readNodeRequired() },
  { key: 'customWorkflow.directorUnsupportedOperation', source: directorProtocolSource.unsupportedOperation('{{v0}}') },
  { key: 'customWorkflow.directorReadBeforeEdit', source: directorProtocolSource.readBeforeEdit() },
  { key: 'customWorkflow.directorInvalidPlan', source: directorProtocolSource.invalidPlan() },
  { key: 'customWorkflow.directorMoveRequiresField', source: directorProtocolSource.moveRequiresField() },
  { key: 'customWorkflow.directorCameraRequiresField', source: directorProtocolSource.cameraRequiresField() },
  { key: 'customWorkflow.directorCameraTargetRequired', source: directorProtocolSource.cameraTargetRequired() },
  { key: 'customWorkflow.directorDistanceRequired', source: directorProtocolSource.distanceRequired() },
  { key: 'customWorkflow.directorDistinctObjectsRequired', source: directorProtocolSource.distinctObjectsRequired() },
  { key: 'customWorkflow.directorBeatTitle', source: directorProtocolSource.beatTitle('{{v0}}') },
  { key: 'customWorkflow.directorDeclined', source: directorProtocolSource.declined() },
  { key: 'customWorkflow.directorSetStage', source: directorActionSource.setStage('{{v0}}') },
  { key: 'customWorkflow.directorBlockingLayout', source: directorActionSource.blockingLayout('{{v0}}') },
  { key: 'customWorkflow.directorPlaceAsset', source: directorActionSource.placeAsset('{{v0}}') },
  { key: 'customWorkflow.directorAddMarker', source: directorActionSource.addMarker('{{v0}}') },
  { key: 'customWorkflow.directorMoveObject', source: directorActionSource.moveObject('{{v0}}') },
  { key: 'customWorkflow.directorRemoveObject', source: directorActionSource.removeObject('{{v0}}') },
  { key: 'customWorkflow.directorSetRelation', source: directorActionSource.setRelation('{{v0}}') },
  { key: 'customWorkflow.directorRemoveRelation', source: directorActionSource.removeRelation('{{v0}}') },
  { key: 'customWorkflow.directorSetCamera', source: directorActionSource.setCamera('{{v0}}') },
  { key: 'customWorkflow.directorSetCameraPath', source: directorActionSource.setCameraPath('{{v0}}') },
  { key: 'customWorkflow.directorSetBeat', source: directorActionSource.setBeat('{{v0}}') },
  { key: 'customWorkflow.cameraOutputLabel', source: recipeCameraOutputLabel('{{v0}}') },
  { key: 'customWorkflow.scene3dSourceTitle', source: canvasSourceDefaults.scene3dTitle() },
  { key: 'customWorkflow.importedScriptSourceTitle', source: canvasSourceDefaults.importedScriptTitle() },
  { key: 'customWorkflow.shotSourceTitle', source: canvasSourceDefaults.shotTitle('{{v0}}') },
  { key: 'customWorkflow.shotImageSourceTitle', source: canvasSourceDefaults.shotImageTitle('{{v0}}') },
  { key: 'customWorkflow.shotVideoSourceTitle', source: canvasSourceDefaults.shotVideoTitle('{{v0}}') },
  { key: 'customWorkflow.shotActionFrameSourceTitle', source: canvasSourceDefaults.keyframeTitle('{{v0}}', '{{v1}}', '动作') },
  { key: 'customWorkflow.shotEndFrameSourceTitle', source: canvasSourceDefaults.keyframeTitle('{{v0}}', '{{v1}}', '结尾') },
  { key: 'customWorkflow.storyboardGroupSourceTitle', source: canvasSourceDefaults.storyboardGroupTitle('{{v0}}') },
  { key: 'customWorkflow.handoffScene3dSourceTitle', source: canvasSourceDefaults.scene3dHandoffTitle('{{v0}}') },
  { key: 'customWorkflow.actorSourceName', source: actorSourceName('{{v0}}') },
  { key: 'customWorkflow.blenderDirectorPreviewSourceTitle', source: canvasSourceDefaults.blenderPreviewTitle(true) },
  { key: 'customWorkflow.blenderScenePreviewSourceTitle', source: canvasSourceDefaults.blenderPreviewTitle(false) },
  { key: 'customWorkflow.blenderDirectorSceneSourceTitle', source: canvasSourceDefaults.blenderModelTitle(true) },
  { key: 'customWorkflow.blenderSceneModelSourceTitle', source: canvasSourceDefaults.blenderModelTitle(false) },
  { key: 'customWorkflow.candidateChangedSourceLabel', source: canvasSourceDefaults.candidateChanged() },
  { key: 'customWorkflow.localQualitySourceLabel', source: canvasSourceDefaults.localQuality() },
  { key: 'customWorkflow.unknownAgentToolSource', source: canvasSourceDefaults.unknownAgentTool('{{v0}}') },
  { key: 'customWorkflow.textToImageRationale', source: generationModeRationale('text-to-image') },
  { key: 'customWorkflow.imageToImageRationale', source: generationModeRationale('image-to-image') },
  { key: 'customWorkflow.textToVideoRationale', source: generationModeRationale('text-to-video') },
  { key: 'customWorkflow.firstFrameRationale', source: generationModeRationale('first-frame') },
  { key: 'customWorkflow.omniReferenceRationale', source: generationModeRationale('omni-reference') },
  { key: 'customWorkflow.inferredModeRationale', source: generationModeRationale('{{v0}}') },
  { key: 'customWorkflow.car', source: PROP_SOURCE_NAMES.car },
  { key: 'customWorkflow.building', source: PROP_SOURCE_NAMES.building },
  { key: 'customWorkflow.tree', source: PROP_SOURCE_NAMES.tree },
  { key: 'customWorkflow.streetlamp', source: PROP_SOURCE_NAMES.streetlamp },
  { key: 'customWorkflow.wall', source: PROP_SOURCE_NAMES.wall },
  { key: 'customWorkflow.bus', source: PROP_SOURCE_NAMES.bus },
  { key: 'customWorkflow.bicycle', source: PROP_SOURCE_NAMES.bicycle },
  { key: 'customWorkflow.electricScooter', source: PROP_SOURCE_NAMES.scooter },
  { key: 'customWorkflow.diningTable', source: PROP_SOURCE_NAMES.diningTable },
  { key: 'customWorkflow.sofa', source: PROP_SOURCE_NAMES.sofa },
  { key: 'customWorkflow.fridge', source: PROP_SOURCE_NAMES.fridge },
  { key: 'customWorkflow.washingMachine', source: PROP_SOURCE_NAMES.washingMachine },
  { key: 'customWorkflow.recyclingBins', source: PROP_SOURCE_NAMES.trashBins },
  { key: 'customWorkflow.atm', source: PROP_SOURCE_NAMES.atm },
  { key: 'customWorkflow.backpack', source: PROP_SOURCE_NAMES.backpack },
  { key: 'customWorkflow.front', source: MODEL3D_VIEW_SOURCE_NAMES['front'] },
  { key: 'customWorkflow.frontRight', source: MODEL3D_VIEW_SOURCE_NAMES['front-right'] },
  { key: 'customWorkflow.rightSide', source: MODEL3D_VIEW_SOURCE_NAMES['right'] },
  { key: 'customWorkflow.rearRight', source: MODEL3D_VIEW_SOURCE_NAMES['rear-right'] },
  { key: 'customWorkflow.rear', source: MODEL3D_VIEW_SOURCE_NAMES['rear'] },
  { key: 'customWorkflow.rearLeft', source: MODEL3D_VIEW_SOURCE_NAMES['rear-left'] },
  { key: 'customWorkflow.leftSide', source: MODEL3D_VIEW_SOURCE_NAMES['left'] },
  { key: 'customWorkflow.frontLeft', source: MODEL3D_VIEW_SOURCE_NAMES['front-left'] },
  { key: 'customWorkflow.top', source: MODEL3D_VIEW_SOURCE_NAMES['top'] },
] as const satisfies readonly { key: TranslationKey; source: string }[]
const sourcePatterns = canonicalSources.map(({ key, source }) => {
  const fields: string[] = []
  const pattern = source.split(/(\{\{[A-Za-z]\w*\}\})/).map(part => {
    if (/^\{\{[A-Za-z]\w*\}\}$/.test(part)) {
      fields.push(part.slice(2, -2))
      return '([\\s\\S]*?)'
    }
    return part.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&')
  }).join('')
  return { key, fields, pattern: new RegExp('^' + pattern + '$') }
})

/** Localize only known display copies; callers keep the original stored value. */
export function translateCanvasComponentText(source: string): string {
  const key = displayKeys.get(source)
  if (key) return i18n.t(key)
  for (const entry of sourcePatterns) {
    const match = entry.pattern.exec(source)
    if (!match) continue
    if (entry.key === 'customWorkflow.cameraOutputLabel' && !/^[1-9]\d*$/.test(match[1])) continue
    if (entry.key === 'customWorkflow.actorSourceName' && !/^(?:[A-Z]|A[1-9]\d*)$/.test(match[1])) continue
    if (['customWorkflow.shotSourceTitle', 'customWorkflow.shotImageSourceTitle', 'customWorkflow.shotVideoSourceTitle', 'customWorkflow.shotActionFrameSourceTitle', 'customWorkflow.shotEndFrameSourceTitle'].includes(entry.key) && !/^\d+$/.test(match[1])) continue
    const values = Object.fromEntries(entry.fields.map((field, index) => [field, match[index + 1]]))
    if (entry.key === 'scene3d.fullscreen.cameraMoveFrameTitle'
      && values.frame !== scene3dCaptureSource.firstFrame() && values.frame !== scene3dCaptureSource.lastFrame()) continue
    const frame = values.frame === scene3dCaptureSource.firstFrame() ? i18n.t('scene3d.fullscreen.firstFrame')
      : values.frame === scene3dCaptureSource.lastFrame() ? i18n.t('scene3d.fullscreen.lastFrame') : values.frame ?? ''
    return i18n.t(entry.key, {
      ...values, v0: values.v0 ?? '', v1: values.v1 ?? '',
      camera: values.camera ?? '', name: values.name ?? '', frame,
    })
  }
  return source
}
