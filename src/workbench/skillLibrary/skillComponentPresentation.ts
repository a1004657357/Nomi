import i18n from "../../i18n"
import {
  BUILTIN_CAPABILITY_RECIPES,
  type CapabilityRecipe,
} from '../../config/capabilityRecipes'
import type {
  SkillListItemDto,
  SkillProviderKind,
} from '../api/skillApi'

export type SkillLibrarySource = 'mine' | 'builtin'

export type CanvasSkillComponentKind =
  | 'image'
  | 'video'
  | 'scene'
  | 'multiview'
  | 'model3d'
  | 'workflow'

export type CanvasSkillComponentPresentation = {
  kind: CanvasSkillComponentKind
  label: string
}

export type BuiltinCanvasComponentItem = {
  id: string
  recipeId: string | null
  skill: SkillListItemDto
}

type CanvasSkillPresentationInput = Pick<SkillListItemDto, 'name' | 'canvas' | 'neededProviders'>

const COMPONENT_LABELS: Record<CanvasSkillComponentKind, string> = {
  image: '图像组件',
  video: '视频组件',
  scene: '场景组件',
  multiview: '多视角组件',
  model3d: '3D 组件',
  workflow: '工作流组件',
}

export function defaultSkillLibrarySource(input: { componentFirst: boolean }): SkillLibrarySource {
  return input.componentFirst ? 'builtin' : 'mine'
}

export function skillLibrarySourceOptions(input: {
  componentFirst: boolean
}): Array<{ value: SkillLibrarySource; label: string }> {
  return input.componentFirst
    ? [
        { value: 'builtin', label: i18n.t("customWorkflow.builtInComponent") },
        { value: 'mine', label: i18n.t("customWorkflow.mySkills") },
      ]
    : [
        { value: 'mine', label: i18n.t("customWorkflow.mySkills") },
        { value: 'builtin', label: i18n.t("customWorkflow.builtIntoNomi") },
      ]
}

export function canvasSkillComponentPresentation(
  skill: CanvasSkillPresentationInput,
): CanvasSkillComponentPresentation {
  const recipeIds = skill.canvas?.recipeIds ?? []
  let kind: CanvasSkillComponentKind = 'workflow'

  if (skill.name === 'creative.video-deconstruction') {
    kind = 'video'
  } else if (recipeIds.some((id) => id.startsWith('scene.panorama.'))) {
    kind = 'scene'
  } else if (recipeIds.some((id) => id.startsWith('video.'))) {
    kind = 'video'
  } else if (recipeIds.some((id) => id.includes('reconstruct3d'))) {
    kind = 'model3d'
  } else if (recipeIds.some((id) => id.startsWith('image.multiview.'))) {
    kind = 'multiview'
  } else if (skill.neededProviders.includes('model3d')) {
    kind = 'model3d'
  } else if (
    recipeIds.length > 0 ||
    (skill.neededProviders.length === 1 && skill.neededProviders.includes('image'))
  ) {
    kind = 'image'
  }

  return { kind, label: COMPONENT_LABELS[kind] }
}

function providerKindsForRecipe(recipe: CapabilityRecipe): SkillProviderKind[] {
  const kinds = recipe.requirements.taskKinds
  if (kinds.some((kind) => kind === 'text_to_3d' || kind === 'image_to_3d')) return ['model3d']
  if (kinds.some((kind) => kind === 'text_to_video' || kind === 'image_to_video')) return ['video']
  return ['image']
}

export function buildBuiltinCanvasComponentItems(
  skills: readonly SkillListItemDto[],
): BuiltinCanvasComponentItem[] {
  const recipesById = new Map(BUILTIN_CAPABILITY_RECIPES.map((recipe) => [recipe.id, recipe]))
  const items: BuiltinCanvasComponentItem[] = []
  for (const skill of skills) {
    if (skill.origin !== 'builtin' || !skill.canvas) continue
    if (!skill.canvas.recipeIds.length) {
      items.push({
        id: `${skill.directoryName}::workflow`,
        recipeId: null,
        skill,
      })
      continue
    }
    for (const recipeId of skill.canvas.recipeIds) {
      const recipe = recipesById.get(recipeId)
      if (!recipe) continue
      items.push({
        id: `${skill.directoryName}::${recipe.id}`,
        recipeId: recipe.id,
        skill: {
          ...skill,
          label: recipe.label,
          description: recipe.description ?? skill.description,
          stages: [],
          stageLabels: [],
          isPlaybook: false,
          neededProviders: providerKindsForRecipe(recipe),
          canvas: {
            recipeIds: [recipe.id],
            defaultRecipeId: recipe.id,
          },
        },
      })
    }
  }
  return items
}
