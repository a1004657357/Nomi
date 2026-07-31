import type { RecipeOutputDescriptor, RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationResultCollection,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'

export type CapabilityRecipeTask = {
  id: string
  itemIds: string[]
  outputs: RecipeOutputDescriptor[]
  plan: RecipeRunPlan
}

export type CapabilityRecipeTaskExecutor = (task: CapabilityRecipeTask) => Promise<GenerationNodeResult[]>

export type RunCapabilityRecipeOptions = {
  executeTask: CapabilityRecipeTaskExecutor
  concurrency?: number
}

function boundedConcurrency(value: unknown, taskCount: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(1, Math.min(4, taskCount))
  return Math.max(1, Math.min(4, taskCount, Math.floor(value)))
}

function tasksForPlan(plan: RecipeRunPlan): CapabilityRecipeTask[] {
  if (plan.taskCount === 1) {
    return [{ id: `${plan.id}:task-1`, itemIds: plan.outputs.map((item) => item.id), outputs: plan.outputs, plan }]
  }
  return plan.outputs.map((output, index) => ({
    id: `${plan.id}:task-${index + 1}`,
    itemIds: [output.id],
    outputs: [output],
    plan,
  }))
}

function initialItem(output: RecipeOutputDescriptor): GenerationResultCollectionItem {
  return {
    id: output.id,
    label: output.label,
    ...(typeof output.azimuth === 'number' ? { azimuth: output.azimuth } : {}),
    ...(typeof output.elevation === 'number' ? { elevation: output.elevation } : {}),
    ...(output.shotSize ? { shotSize: output.shotSize } : {}),
    ...(typeof output.energy === 'number' ? { energy: output.energy } : {}),
    ...(typeof output.affinity === 'number' ? { affinity: output.affinity } : {}),
    status: 'pending',
  }
}

function taskResultCandidates(
  results: GenerationNodeResult[],
  itemCount: number,
  itemIndex: number,
): GenerationNodeResult[] {
  if (itemCount <= 0 || results.length < itemCount || results.length % itemCount !== 0) return []
  const candidateCount = results.length / itemCount
  const start = itemIndex * candidateCount
  return results.slice(start, start + candidateCount)
}

async function runTasksIntoCollection(
  collection: GenerationResultCollection,
  tasks: CapabilityRecipeTask[],
  options: RunCapabilityRecipeOptions,
): Promise<GenerationResultCollection> {
  const items = collection.items.map((item) => ({ ...item }))
  const itemIndex = new Map(items.map((item, index) => [item.id, index]))
  const concurrency = boundedConcurrency(options.concurrency, tasks.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++]!
      for (const id of task.itemIds) {
        const index = itemIndex.get(id)
        if (typeof index === 'number') items[index] = { ...items[index]!, status: 'running', error: undefined }
      }
      try {
        const results = await options.executeTask(task)
        task.itemIds.forEach((id, resultIndex) => {
          const index = itemIndex.get(id)
          if (typeof index !== 'number') return
          const candidates = taskResultCandidates(results, task.itemIds.length, resultIndex)
          const result = candidates[0]
          items[index] = result
            ? {
                ...items[index]!,
                status: 'success',
                result,
                candidates,
                selectedResultId: result.id,
                error: undefined,
              }
            : { ...items[index]!, status: 'error', error: '生成结果数量不足', result: undefined }
        })
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : String(error)
        for (const id of task.itemIds) {
          const index = itemIndex.get(id)
          if (typeof index === 'number') items[index] = { ...items[index]!, status: 'error', error: message }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()))
  return { ...collection, items }
}

export async function runCapabilityRecipePlan(
  plan: RecipeRunPlan,
  options: RunCapabilityRecipeOptions,
): Promise<GenerationResultCollection> {
  const collection: GenerationResultCollection = {
    id: plan.id,
    recipeId: plan.recipeId,
    createdAt: plan.createdAt,
    items: plan.outputs.map(initialItem),
  }
  return runTasksIntoCollection(collection, tasksForPlan(plan), options)
}

export async function retryFailedRecipeItems(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  options: RunCapabilityRecipeOptions,
): Promise<GenerationResultCollection> {
  const failedIds = new Set(collection.items.filter((item) => item.status === 'error').map((item) => item.id))
  if (failedIds.size === 0) return collection
  const failedOutputs = plan.outputs.filter((output) => failedIds.has(output.id))
  const retryPlan: RecipeRunPlan = {
    ...plan,
    outputs: failedOutputs,
    outputCount: failedOutputs.length,
    taskCount: plan.taskCount === 1 ? 1 : failedOutputs.length,
  }
  return runTasksIntoCollection(collection, tasksForPlan(retryPlan), options)
}

export function appendRecipeCollection(
  node: GenerationCanvasNode,
  collection: GenerationResultCollection,
): GenerationCanvasNode {
  return {
    ...node,
    resultCollections: [...(node.resultCollections ?? []), collection],
  }
}
