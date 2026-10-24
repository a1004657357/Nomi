import { desktopT } from "../desktopStrings";
import { z } from 'zod'
import { BLENDER_DIRECTOR_STAGE_PRESETS } from '../shared/blenderDirectorContract'

const finiteNumber = z.number().finite()
const vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber])
const stagePresetSchema = z.enum(BLENDER_DIRECTOR_STAGE_PRESETS)
const blockingTemplateSchema = z.enum(['coffee_two_person_conversation'])
const aspectRatioSchema = z.enum(['16:9', '9:16', '4:3', '3:4', '1:1', '2.39:1'])
const cameraFramingSchema = z.enum(['all', 'target', 'fixed'])
const relationKindSchema = z.enum(['facing', 'distance', 'support', 'offset', 'line_of_sight'])
const identifierSchema = z.string().min(1).max(160).regex(/^(?!https?:\/\/)(?!file:)[a-zA-Z0-9_\-.:\u4e00-\u9fff ]+$/i)

const canonicalActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_stage'), preset: stagePresetSchema }),
  z.object({
    op: z.literal('set_blocking_layout'),
    template: blockingTemplateSchema,
    actorAName: z.string().min(1).max(160).optional(),
    actorBName: z.string().min(1).max(160).optional(),
  }),
  z.object({
    op: z.literal('place_asset'),
    id: identifierSchema,
    assetId: identifierSchema,
    name: z.string().min(1).max(160),
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
  }),
  z.object({
    op: z.literal('add_marker'),
    id: identifierSchema,
    name: z.string().min(1).max(160),
    role: z.string().max(120).optional(),
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }),
  z.object({
    op: z.literal('move_object'),
    objectRef: identifierSchema,
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
    name: z.string().min(1).max(160).optional(),
  }),
  z.object({ op: z.literal('remove_object'), objectRef: identifierSchema }),
  z.object({
    op: z.literal('set_relation'),
    id: identifierSchema,
    kind: relationKindSchema,
    subjectRef: identifierSchema,
    targetRef: identifierSchema,
    distance: finiteNumber.min(0.05).max(1000).optional(),
    mutual: z.boolean().optional(),
  }),
  z.object({ op: z.literal('remove_relation'), relationRef: identifierSchema }),
  z.object({
    op: z.literal('set_camera'),
    cameraRef: identifierSchema.optional(),
    name: z.string().min(1).max(160).optional(),
    position: vector3Schema.optional(),
    lookAt: vector3Schema.optional(),
    fov: finiteNumber.min(1).max(160).optional(),
    aspectRatio: aspectRatioSchema.optional(),
    framing: cameraFramingSchema.optional(),
    targetRef: identifierSchema.optional(),
  }),
  z.object({
    op: z.literal('set_camera_path'),
    cameraRef: identifierSchema.optional(),
    points: z.array(vector3Schema).min(2).max(32),
    durationSec: finiteNumber.min(0.1).max(300),
  }),
  z.object({
    op: z.literal('set_beat'),
    id: identifierSchema,
    title: z.string().min(1).max(160),
    action: z.string().max(2000).optional(),
    cameraNote: z.string().max(1000).optional(),
    dialogue: z.string().max(1000).optional(),
    notes: z.string().max(1000).optional(),
    durationSec: finiteNumber.min(0.1).max(120).optional(),
  }),
])

const canonicalPlanSchema = z.object({
  mode: z.enum(['replace', 'amend']),
  brief: z.string().max(4000).optional(),
  actions: z.array(canonicalActionSchema).min(1).max(24),
}).superRefine((plan, context) => {
  plan.actions.forEach((action, index) => {
    if (action.op === 'move_object' && action.position === undefined && action.rotation === undefined && action.scale === undefined && action.name === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: desktopT("custom.ai.vibingDirectorTools.text1"), path: ['actions', index] })
    }
    if (action.op === 'set_camera' && action.cameraRef === undefined && action.name === undefined && action.position === undefined && action.lookAt === undefined && action.fov === undefined && action.aspectRatio === undefined && action.framing === undefined && action.targetRef === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: desktopT("custom.ai.vibingDirectorTools.text2"), path: ['actions', index] })
    }
    if (action.op === 'set_camera' && action.framing === 'target' && action.targetRef === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: desktopT("custom.ai.vibingDirectorTools.text3"), path: ['actions', index, 'targetRef'] })
    }
    if (action.op === 'set_relation' && action.kind === 'distance' && action.distance === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: desktopT("custom.ai.vibingDirectorTools.text4"), path: ['actions', index, 'distance'] })
    }
    if (action.op === 'set_relation' && action.subjectRef === action.targetRef) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: desktopT("custom.ai.vibingDirectorTools.text5"), path: ['actions', index, 'targetRef'] })
    }
  })
})

/**
 * Provider-facing schema is intentionally flat. Several OpenAI-compatible
 * gateways reject `oneOf` function schemas, so the native tool only advertises
 * a simple object and the canonical schema below is the trust boundary.
 */
const planActionWireSchema = z.object({
  op: z.enum(['set_stage', 'set_blocking_layout', 'place_asset', 'add_marker', 'move_object', 'remove_object', 'set_relation', 'remove_relation', 'set_camera', 'set_camera_path', 'set_beat']).describe("Edit kind"),
  preset: stagePresetSchema.optional().describe("Stage preset"),
  template: blockingTemplateSchema.optional().describe("Blocking preset"),
  actorAName: z.string().max(160).optional().describe("Actor A name"),
  actorBName: z.string().max(160).optional().describe("Actor B name"),
  id: identifierSchema.optional().describe("Edit ID"),
  assetId: identifierSchema.optional().describe("Asset ID"),
  name: z.string().max(160).optional().describe("Display name"),
  title: z.string().max(160).optional().describe('Beat title'),
  role: z.string().max(120).optional().describe("Marker role"),
  position: vector3Schema.optional().describe("Y-up XYZ units"),
  rotation: vector3Schema.optional().describe("XYZ degrees"),
  scale: vector3Schema.optional().describe("XYZ factors"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().describe("RGB #RRGGBB"),
  objectRef: identifierSchema.optional().describe("Object ID"),
  kind: relationKindSchema.optional().describe("Relation kind"),
  subjectRef: identifierSchema.optional().describe("Subject ID"),
  targetRef: identifierSchema.optional().describe("Target ID"),
  distance: finiteNumber.min(0.05).max(1000).optional().describe("XZ scene units"),
  mutual: z.boolean().optional().describe("Face both"),
  relationRef: identifierSchema.optional().describe("Relation ID"),
  cameraRef: identifierSchema.optional().describe("Camera ID"),
  lookAt: vector3Schema.optional().describe("Y-up XYZ aim"),
  fov: finiteNumber.min(1).max(160).optional().describe("Degrees"),
  aspectRatio: aspectRatioSchema.optional().describe("Width:height"),
  framing: cameraFramingSchema.optional().describe("Fit/keep pose"),
  points: z.array(vector3Schema).min(2).max(32).optional().describe("Y-up XYZ path"),
  durationSec: finiteNumber.min(0.1).max(300).optional().describe("Seconds"),
  action: z.string().max(2000).optional().describe("Beat action"),
  cameraNote: z.string().max(1000).optional().describe("Camera intent"),
  dialogue: z.string().max(1000).optional().describe("Dialogue"),
  notes: z.string().max(1000).optional().describe("Beat notes"),
})

export const readVibingDirectorParamsSchema = z.object({
  directorNodeId: z.string().min(1).max(200).describe('Director ID'),
})

export const applyVibingDirectorPlanParamsSchema = z.object({
  directorNodeId: z.string().min(1).max(200).describe('Director ID'),
  summary: z.string().min(1).max(600).describe('Review text'),
  plan: z.object({
    mode: z.enum(['replace', 'amend']).describe('Reset/amend'),
    brief: z.string().max(4000).optional().describe('Plan intent'),
    actions: z.array(planActionWireSchema).min(1).max(24).describe('Edit sequence'),
  }).describe('Scene edit plan'),
})

const canonicalApplyVibingDirectorPlanParamsSchema = z.object({
  directorNodeId: z.string().min(1).max(200),
  summary: z.string().min(1).max(600),
  plan: canonicalPlanSchema,
})

export type VibingDirectorPlanRequest = z.infer<typeof canonicalApplyVibingDirectorPlanParamsSchema>

/** Revalidates native tool args before the renderer can show a confirmation. */
export function parseVibingDirectorPlanRequest(value: unknown): VibingDirectorPlanRequest | null {
  const parsed = canonicalApplyVibingDirectorPlanParamsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const vibingDirectorToolNames = ['read_vibing_director', 'apply_vibing_director_plan'] as const
export type VibingDirectorToolName = (typeof vibingDirectorToolNames)[number]
