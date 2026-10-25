import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model, Vendor } from '../catalog/types';
import { runCodexImageTask } from './codexImageTask';

const state = vi.hoisted(() => ({
  context: { projectId: 'p', root: '/captured/p', assertCurrent: vi.fn() },
  capture: vi.fn(), spend: vi.fn(), generate: vi.fn(), write: vi.fn(), cleanup: vi.fn(),
}));
vi.mock('../assets/assetWriteContext', () => ({ captureAssetWriteContext: state.capture }));
vi.mock('../assets/projectAssetStore', () => ({ writeAsset: state.write }));
vi.mock('../ai/codexImagegenRunner', () => ({ runCodexImageGeneration: state.generate }));
vi.mock('./taskSpend', () => ({ consumeTaskSpend: state.spend }));
vi.mock('../vendor/fingerprintCache', () => ({ readCachedTaskResult: () => null, recipeFingerprint: () => 'fp', rememberTaskResult: vi.fn() }));
vi.mock('../vendor/provenance', () => ({ buildNormalizedRecipe: () => ({}), buildTaskProvenance: () => ({ timestamp: 1 }) }));
vi.mock('../events/vendorCallTrace', () => ({ traceVendorRequested: vi.fn(), traceVendorCompleted: vi.fn() }));
vi.mock('../review/reviewTrace', () => ({ scheduleTechnicalReview: vi.fn() }));
vi.mock('node:fs', () => ({ default: { readFileSync: () => Buffer.from('fixture'), rmSync: state.cleanup } }));

const binding = { projectId: 'p', immutableProjectUuid: 'uuid', projectGeneration: 1 };
const input = {
  vendor: { key: 'codex-img2' } as Vendor,
  model: { modelKey: 'gpt-image-2' } as Model,
  request: { kind: 'text_to_image' as const, prompt: 'test', extras: { projectBinding: binding } },
  wantedKind: 'image' as const, projectId: 'p', nodeId: 'n', grantId: 'grant', taskId: 'task',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.capture.mockResolvedValue(state.context);
  state.spend.mockResolvedValue(undefined);
  state.generate.mockResolvedValue({ outputPath: '/tmp/generated.png', tempDir: '/tmp/codex-fixture', threadId: 'thread', timings: {}, lastMessage: '' });
  state.write.mockReturnValue({ id: 'a', data: { url: 'nomi-local://asset/p/generated.png', absolutePath: '/captured/p/generated.png' } });
});

describe('Codex task publication boundary', () => {
  it('captures the exact project before spending and writes image bytes with that context', async () => {
    const result = await runCodexImageTask(input);
    expect(state.capture).toHaveBeenCalledWith('p', binding);
    expect(state.capture.mock.invocationCallOrder[0]).toBeLessThan(state.spend.mock.invocationCallOrder[0]);
    expect(state.write).toHaveBeenCalledWith('p', expect.any(Buffer), expect.any(String), 'image/png', expect.objectContaining({ ownerNodeId: 'n' }), 'image', state.context);
    expect(result.status).toBe('succeeded');
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.cleanup).toHaveBeenCalledWith('/tmp/codex-fixture', { recursive: true, force: true });
  });

  it('does not spend or submit when the captured project identity is stale', async () => {
    state.capture.mockRejectedValueOnce(new Error('project_binding_stale'));
    await expect(runCodexImageTask(input)).rejects.toThrow('project_binding_stale');
    expect(state.spend).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });

  it('keeps failed publication visible and cleans scratch output without resubmitting', async () => {
    state.write.mockImplementationOnce(() => { throw new Error('project_binding_stale'); });
    await expect(runCodexImageTask(input)).rejects.toThrow('project_binding_stale');
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.cleanup).toHaveBeenCalledTimes(1);
  });
});
