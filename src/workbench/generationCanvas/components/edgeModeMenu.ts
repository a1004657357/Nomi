import type {
  GenerationCanvasEdgeMode,
  GenerationCanvasNode,
} from '../model/generationCanvasTypes'
import { validateReferenceEdge } from '../agent/referenceEdgeCapability'

export const EDITABLE_EDGE_MODES: readonly GenerationCanvasEdgeMode[] = [
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
]

export function availableEdgeModes(
  source: GenerationCanvasNode,
  target: GenerationCanvasNode,
): GenerationCanvasEdgeMode[] {
  return EDITABLE_EDGE_MODES.filter((mode) => validateReferenceEdge(source, target, mode).ok)
}
