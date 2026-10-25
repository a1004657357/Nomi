import { z } from 'zod'
import { generationNodeStatusSchema } from '../../../../electron/shared/canvas/generationNodeStatus'
import { CATEGORY_IDS, GENERATION_COLLECTION_ITEM_STATUSES, GENERATION_QUALITY_STATUSES } from './generationCanvasTypes'
import { GENERATION_NODE_KINDS } from './generationNodeKinds'
import { creativeResourceSchema } from '../../../config/capabilityRecipes'

export const generationNodeKindSchema = z.enum(GENERATION_NODE_KINDS)

export { generationNodeStatusSchema }
export const generationNodeTaskKindSchema = z.enum(['text', 'image', 'video', 'audio', 'model3d', 'workflow', 'asset', 'unknown'])
export const generationNodeRunStatusSchema = generationNodeStatusSchema.exclude(['idle']).or(z.literal('cancelled'))
export const categoryIdSchema = z.enum(CATEGORY_IDS)

export const generationNodeProgressSchema = z.object({
  runId: z.string().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  phase: z.string().optional(),
  message: z.string().optional(),
  percent: z.number().optional(),
  updatedAt: z.number(),
})

export const generationProvenanceSchema = z.object({
  provider: z.string().optional(),
  modelKey: z.string().optional(),
  modelVersion: z.string().optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  params: z.record(z.unknown()).optional(),
  vendorRequestId: z.string().optional(),
  cost: z.object({
    amount: z.number().finite().nonnegative(),
    currency: z.string(),
    unit: z.enum(['estimate', 'actual']),
  }).optional(),
  timestamp: z.number(),
  agentRunId: z.string().optional(),
}).strict()

export const model3dValidationSummarySchema = z.object({
  version: z.literal(1),
  glbVersion: z.number(),
  byteLength: z.number().nonnegative(),
  meshCount: z.number().int().nonnegative(),
  primitiveCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  textureCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  embeddedImageCount: z.number().int().nonnegative(),
  externalImageCount: z.number().int().nonnegative(),
  externalImageUris: z.array(z.string()),
  externalBufferCount: z.number().int().nonnegative(),
  externalBufferUris: z.array(z.string()),
  animationCount: z.number().int().nonnegative(),
  skinCount: z.number().int().nonnegative(),
  bounds: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
    size: z.tuple([z.number(), z.number(), z.number()]),
    diagonal: z.number().nonnegative(),
  }),
  warnings: z.array(z.string()),
}).strict()

export const generationNodeResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video', 'text', 'audio', 'model3d']),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  providerUrl: z.string().optional(),
  text: z.string().optional(),
  model: z.string().optional(),
  durationSeconds: z.number().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  model3dValidation: model3dValidationSummarySchema.optional(),
  raw: z.unknown().optional(),
  createdAt: z.number(),
  provenance: generationProvenanceSchema.optional(),
})

export const generationResultCollectionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  azimuth: z.number().optional(),
  elevation: z.number().optional(),
  shotSize: z.string().optional(),
  energy: z.number().min(0).max(4).optional(),
  affinity: z.number().min(0).max(4).optional(),
  status: z.enum(GENERATION_COLLECTION_ITEM_STATUSES),
  result: generationNodeResultSchema.optional(),
  candidates: z.array(generationNodeResultSchema).optional(),
  selectedResultId: z.string().min(1).optional(),
  error: z.string().optional(),
})

export const generationResultCollectionSchema = z.object({
  id: z.string().min(1),
  recipeId: z.string().min(1),
  createdAt: z.number(),
  source: z.object({
    nodeId: z.string().min(1),
    resultId: z.string().min(1),
    label: z.string().min(1),
    url: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    providerUrl: z.string().optional(),
  }).optional(),
  items: z.array(generationResultCollectionItemSchema),
  quality: z.object({
    version: z.literal(1),
    kind: z.enum(['grid9', 'multiview', 'panorama', 'portrait', 'mood', 'style', 'video', 'model3d']),
    evaluator: z.string().min(1),
    status: z.enum(GENERATION_QUALITY_STATUSES),
    evaluatedAt: z.number(),
    checks: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      status: z.enum(GENERATION_QUALITY_STATUSES),
      summary: z.string().min(1),
      details: z.array(z.string()).optional(),
      itemIds: z.array(z.string()).optional(),
      metrics: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    })),
    metrics: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    humanReview: z.object({
      verdict: z.enum(['accepted', 'rejected']),
      reviewedAt: z.number(),
      note: z.string().max(500).optional(),
    }).optional(),
  }).optional(),
})

export const generationNodeRunRecordSchema = z.object({
  id: z.string().min(1),
  status: generationNodeRunStatusSchema,
  attempt: z.object({ vendorKey: z.string().min(1), modelKey: z.string().min(1) }).optional(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  progress: generationNodeProgressSchema.optional(),
  resultId: z.string().optional(),
  textDocumentDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/).optional(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
})

export const generationCanvasNodeSchema = z.object({
  id: z.string().min(1),
  kind: generationNodeKindSchema,
  typeId: z.string().min(1).optional(),
  pluginState: z.object({
    pluginId: z.string().min(1),
    pluginVersion: z.string().min(1),
    typeId: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    state: z.record(z.unknown()),
  }).optional(),
  title: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
  prompt: z.string().optional(),
  references: z.array(z.string()).optional(),
  result: generationNodeResultSchema.optional(),
  history: z.array(generationNodeResultSchema).optional(),
  creativeResource: creativeResourceSchema.optional(),
  resultCollections: z.array(generationResultCollectionSchema).optional(),
  progress: generationNodeProgressSchema.optional(),
  runs: z.array(generationNodeRunRecordSchema).optional(),
  status: generationNodeStatusSchema.optional(),
  error: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  categoryId: categoryIdSchema.optional(),
  groupId: z.string().optional(),
  derivedFrom: z.string().optional(),
  // E.2C-15 新增字段
  regeneratedFrom: z.string().optional(),
  shotIndex: z.number().int().nonnegative().optional(),
  renderKind: z
    .enum(['shot-frame', 'character-card', 'scene-card', 'prop-card', 'audio-strip'])
    .optional(),
  // Phase C5: Tiptap document body for inline-editable text nodes. passthrough so
  // unknown marks/attrs survive; optional so legacy nodes without it still parse.
  contentJson: z.object({ type: z.literal('doc') }).passthrough().optional(),
})

const generationCanvasEdgeModeSchema = z.enum([
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
])

export const nodeGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  categoryId: categoryIdSchema,
  nodeIds: z.array(z.string()),
  color: z.string().optional(),
  frameBounds: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }).optional(),
  // 框头部的一句灰字说明（2026-09-06 框工具第一档）；旧快照无 → undefined。
  description: z.string().optional(),
  collapsed: z.boolean().optional(),
  // 组入参声明（真边仍是普通 node→node 边）；旧快照无 → undefined。
  inputLinks: z.array(z.object({
    sourceNodeId: z.string().min(1),
    mode: generationCanvasEdgeModeSchema.optional(),
  })).optional(),
  // 组出参声明：编组作为来源时，每个成员都向 target 物化普通真边；旧快照无 → undefined。
  outputLinks: z.array(z.object({
    targetNodeId: z.string().min(1),
  })).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const generationCanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  mode: generationCanvasEdgeModeSchema.optional(),
  targetParamKey: z.string().min(1).optional(),
  // 落入同一 target 的放入顺序（数组参考 character1..N 的真相源；旧快照无 → undefined，排序退化为原序）。
  order: z.number().optional(),
  // 溯源：由哪个组的输入/输出声明物化而来（只用于撤边时不误伤手工边）。
  viaGroupId: z.string().optional(),
})

export const generationCanvasSnapshotSchema = z.object({
  nodes: z.array(generationCanvasNodeSchema),
  edges: z.array(generationCanvasEdgeSchema),
  selectedNodeIds: z.array(z.string()),
  groups: z.array(nodeGroupSchema).default([]),
})
