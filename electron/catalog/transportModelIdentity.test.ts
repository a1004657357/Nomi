import { describe, expect, it } from 'vitest';
import { buildCatalogTaskRequest } from '../../src/workbench/generationCanvas/runner/catalogTaskActions';
import type { GenerationCanvasNode } from '../../src/workbench/generationCanvas/model/generationCanvasTypes';
import { buildProfileHttpRequest } from './profileHttpRequest';
import { runMultipartProfileOperation } from './multipartOperation';
import { NEWAPI_IMAGE_CREATE_OP, OPENAI_MULTIPART_IMAGE_EDIT_OP } from './newapiTransport';
import type { HttpOperation, Model, Vendor } from './types';
import type { TaskRequest } from '../runtime';
import { resolveArchetypeForModel } from '../shared/modelArchetypes';
import { parseCustomCapabilityContract } from '../shared/customCapabilityContract';

const vendor: Vendor = {
  key: 'custom-relay', name: 'Relay', enabled: true, authType: 'bearer',
  baseUrlHint: 'http://127.0.0.1:8317/v1', createdAt: '', updatedAt: '',
};

function canvasRequest(modelKey: string, modeId: 't2i' | 'i2i') {
  const node: GenerationCanvasNode = {
    id: 'isolated-image', kind: 'image', title: '', position: { x: 0, y: 0 },
    prompt: 'A red ceramic cup',
    meta: {
      modelKey, modelVendor: vendor.key,
      archetype: { id: resolveArchetypeForModel({ modelKey })!.id, modeId }, aspectRatio: '1:1', resolution: '1K',
    },
  };
  const request = buildCatalogTaskRequest(node, {
    references: modeId === 'i2i' ? { referenceImages: ['nomi-local://asset/test/ref.png'] } : {},
  }).request as TaskRequest;
  const model: Model = {
    modelKey, modelAlias: modelKey, vendorKey: vendor.key, labelZh: modelKey,
    kind: 'image', enabled: true, createdAt: '', updatedAt: '',
  };
  return { vendor, model, request, apiKey: 'test-only' };
}

describe('canvas archetype projection at the native image transport boundary', () => {
  it.each(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])(
    '%s keeps the selected catalog identity on JSON generation', modelKey => {
      const input = canvasRequest(modelKey, 't2i');
      const projected = input.request.extras?.archetypeInput as Record<string, unknown>;
      expect(projected.model).not.toBe(modelKey);
      const built = buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP });
      expect(built.body).toMatchObject({ model: modelKey });
      expect(projected.model).not.toBe(modelKey); // normalization must not mutate persisted intent
    },
  );

  it.each(['gpt-image-2', 'gpt-image-2.5-flare'])(
    '%s keeps identity and reference bytes in the actual multipart dispatch', async modelKey => {
      const input = canvasRequest(modelKey, 'i2i');
      let sent: FormData | undefined;
      await runMultipartProfileOperation({
        ...input, operation: OPENAI_MULTIPART_IMAGE_EDIT_OP,
        localAssetReader: () => ({ bytes: Buffer.from('reference-bytes'), contentType: 'image/png', fileName: 'ref.png' }),
      }, async (_url, _headers, _query, form) => {
        sent = form;
        return { data: [{ url: 'https://result.test/output.png' }] };
      });
      expect(sent?.get('model')).toBe(modelKey);
      expect(sent?.getAll('image[]')).toHaveLength(1);
      expect(await (sent?.get('image[]') as File).text()).toBe('reference-bytes');
    },
  );

  it('catalog aliases remain authoritative even with a custom capability contract and stale mode projection', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.model.modelKey = 'user-display-id';
    input.model.meta = {
      customCapabilityContract: {
        version: 1, kind: 'image', defaultModeId: 'generate', transportTaskKind: 'text_to_image',
        modes: [{ id: 'generate', intent: 'text', vendorTerm: 'Generate', hint: '', promptRequired: true, slots: [], params: [] }],
      },
    };
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2' });
  });

  it('a second image family does not switch the selected model to its edit-mode ID', async () => {
    const input = canvasRequest('seedream/4.5-text-to-image', 'i2i');
    let model: FormDataEntryValue | null = null;
    await runMultipartProfileOperation({
      ...input, operation: OPENAI_MULTIPART_IMAGE_EDIT_OP,
      localAssetReader: () => ({ bytes: Buffer.from('reference'), contentType: 'image/png', fileName: 'ref.png' }),
    }, async (_url, _headers, _query, form) => {
      model = form.get('model');
      return {};
    });
    expect(model).toBe('seedream/4.5-text-to-image');
  });

  it('other protocols and user-authored literal model fields remain untouched', () => {
    const input = canvasRequest('gpt-image-2', 'i2i');
    const operation: HttpOperation = {
      method: 'POST', path: '/api/v1/jobs/createTask', body: { model: '{{request.params.model}}' },
    };
    expect(buildProfileHttpRequest({ ...input, operation }).body)
      .toMatchObject({ model: 'gpt-image-2-image-to-image' });
    expect(buildProfileHttpRequest({ ...input, operation: {
      ...NEWAPI_IMAGE_CREATE_OP, body: { model: 'explicit-provider-model' },
    } }).body).toEqual({ model: 'explicit-provider-model' });
  });

  it('does not rewrite an explicit model/variant value which is not a curated mode alias', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.request.extras!.archetypeInput = { model: 'explicit-fast-variant' };
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'explicit-fast-variant' });
  });

  it.each([
    { method: 'GET' as const, path: '/v1/images/generations' },
    { method: 'POST' as const, path: '/v1/chat/completions' },
    { method: 'POST' as const, path: '/v1/images/generations/status' },
  ])('preserves projected identities outside native image creation: $method $path', operation => {
    const input = canvasRequest('gpt-image-2', 't2i');
    expect(buildProfileHttpRequest({
      ...input, operation: { ...operation, body: { model: '{{request.params.model}}' } },
    }).body).toEqual({ model: 'gpt-image-2-text-to-image' });
  });

  it('does not rewrite a model chosen by another template expression', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    expect(buildProfileHttpRequest({
      ...input, operation: { ...NEWAPI_IMAGE_CREATE_OP, body: { model: '{{request.extras.archetypeInput.model}}' } },
    }).body).toEqual({ model: 'gpt-image-2-text-to-image' });
  });

  it('ignores stale node archetype identity when recognizing a projected alias', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.request.extras!.archetype = { id: 'qwen-image', modeId: 't2i', variantId: 'pro' };
    input.model.meta = { archetypeId: 'qwen-image' };
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2' });
  });

  it('leaves unknown catalog identities alone rather than guessing from a stored alias', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.model.modelKey = 'private-image-model';
    input.model.modelAlias = 'private-wire-id';
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2-text-to-image' });
  });

  it('preserves an intentionally declared fixed model even when it matches a curated mode alias', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.model.meta = {
      customCapabilityContract: {
        version: 1, kind: 'image', defaultModeId: 'generate', transportTaskKind: 'text_to_image',
        modes: [{
          id: 'generate', intent: 'text', vendorTerm: 'Generate', hint: '', promptRequired: true,
          slots: [], params: [], fixedParams: { model: 'gpt-image-2-text-to-image' },
        }],
      },
    };
    expect(parseCustomCapabilityContract(input.model.meta)).not.toBeNull();
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2-text-to-image' });
  });

  it('an invalid custom contract cannot authorize a stale fixed model', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    input.model.meta = {
      customCapabilityContract: {
        version: 999, kind: 'image', defaultModeId: 'generate', transportTaskKind: 'text_to_image',
        modes: [{ id: 'generate', fixedParams: { model: 'gpt-image-2-text-to-image' } }],
      },
    };
    expect(parseCustomCapabilityContract(input.model.meta)).toBeNull();
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2' });
  });

  it.each(['t2i', 'edit'] as const)('retains a real declared Pro variant through canvas %s projection', async modeId => {
    const modelKey = 'qwen-image-2.0';
    const input = canvasRequest('gpt-image-2', 't2i');
    input.model = { ...input.model, modelKey, modelAlias: modelKey };
    const node: GenerationCanvasNode = {
      id: 'variant-image', kind: 'image', title: '', position: { x: 0, y: 0 }, prompt: 'A ceramic cup',
      meta: { modelKey, modelVendor: vendor.key, archetype: { id: 'qwen-image', modeId, variantId: 'pro' } },
    };
    input.request = buildCatalogTaskRequest(node, {
      references: modeId === 'edit' ? { referenceImages: ['nomi-local://asset/test/ref.png'] } : {},
    }).request as TaskRequest;
    expect(input.request.extras?.archetypeInput).toMatchObject({ model: 'qwen-image-2.0-pro' });
    if (modeId === 't2i') {
      expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
        .toMatchObject({ model: 'qwen-image-2.0-pro' });
    } else {
      await runMultipartProfileOperation({
        ...input, operation: OPENAI_MULTIPART_IMAGE_EDIT_OP,
        localAssetReader: () => ({ bytes: Buffer.from('pro-reference'), contentType: 'image/png', fileName: 'ref.png' }),
      }, async (_url, _headers, _query, form) => {
        expect(form.get('model')).toBe('qwen-image-2.0-pro');
        expect(await (form.get('image[]') as File).text()).toBe('pro-reference');
        return {};
      });
    }
  });

  it('keeps literal multipart model fields and reference bytes untouched', async () => {
    const input = canvasRequest('gpt-image-2', 'i2i');
    const operation: HttpOperation = {
      ...OPENAI_MULTIPART_IMAGE_EDIT_OP,
      multipart: {
        ...OPENAI_MULTIPART_IMAGE_EDIT_OP.multipart!,
        fields: { ...OPENAI_MULTIPART_IMAGE_EDIT_OP.multipart!.fields, model: 'literal-native-model' },
      },
    };
    await runMultipartProfileOperation({
      ...input, operation,
      localAssetReader: () => ({ bytes: Buffer.from('literal-reference'), contentType: 'image/png', fileName: 'ref.png' }),
    }, async (_url, _headers, _query, form) => {
      expect(form.get('model')).toBe('literal-native-model');
      expect(await (form.get('image[]') as File).text()).toBe('literal-reference');
      return {};
    });
  });

  it('native model normalization does not invent a quality tier', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .not.toHaveProperty('quality');
    input.request.extras!.quality = 'high';
    expect(buildProfileHttpRequest({ ...input, operation: NEWAPI_IMAGE_CREATE_OP }).body)
      .toMatchObject({ model: 'gpt-image-2', quality: 'high' });
  });

  it('normalizes native model identity when the transport normalizes a lowercase POST method', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    const built = buildProfileHttpRequest({ ...input, operation: { ...NEWAPI_IMAGE_CREATE_OP, method: 'post' } });
    expect(built.method).toBe('POST');
    expect(built.body).toMatchObject({ model: 'gpt-image-2' });
  });

  it('recognizes a native endpoint when its supported operation path includes a query string', () => {
    const input = canvasRequest('gpt-image-2', 't2i');
    const built = buildProfileHttpRequest({
      ...input, operation: { ...NEWAPI_IMAGE_CREATE_OP, path: '/v1/images/generations?trace=fixture' },
    });
    expect(new URL(built.url).pathname).toBe('/v1/images/generations');
    expect(built.body).toMatchObject({ model: 'gpt-image-2' });
  });
});
