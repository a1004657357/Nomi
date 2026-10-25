import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keychain = vi.hoisted(() => ({ unlocked: true, decryptCalls: 0 }));
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => {
      keychain.decryptCalls += 1;
      if (!keychain.unlocked) throw new Error('fixture keychain locked');
      return value.toString();
    },
  },
}));

let root = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-stored-credential-'));
  process.env.NOMI_SETTINGS_DIR = root;
  keychain.unlocked = true;
  keychain.decryptCalls = 0;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.NOMI_SETTINGS_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

async function storeWithVendor() {
  const store = await import('./catalogStore');
  store.upsertModelCatalogVendor({ key: 'relay', name: 'Relay', baseUrlHint: 'http://127.0.0.1:1234/v1', authType: 'bearer', enabled: true });
  return store;
}

describe('stored credential configuration is distinct from executable credential authority', () => {
  it('a saved but unpublished key remains configurable without enabling credential or vendor', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-fixture-key', enabled: false });
    const vendor = store.listModelCatalogVendors().find(value => value.key === 'relay');
    expect(vendor).toMatchObject({ hasStoredApiKey: true, hasApiKey: false, enabled: false });
    const state = store.readCatalog();
    expect(state.apiKeysByVendor.relay.enabled).toBe(false);
    const { apiKeyDecryptStatus } = await import('./secrets');
    expect(apiKeyDecryptStatus(state.apiKeysByVendor.relay)).toBe('missing');
    expect(JSON.stringify(vendor)).not.toContain('synthetic-fixture-key');
    expect(JSON.stringify(vendor)).not.toContain(Buffer.from('synthetic-fixture-key').toString('base64'));
  });

  it('a verified key reports both storage presence and existing usable status', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-ready-key', enabled: true });
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: true, hasApiKey: true });
  });

  it('locked encrypted material remains saved but never becomes usable', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-locked-key', enabled: true });
    keychain.unlocked = false;
    const file = path.join(root, 'model-catalog.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.vendors[0].name = 'Trigger uncached read';
    fs.writeFileSync(file, JSON.stringify(state));
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: true, hasApiKey: false });
  });

  it('clear and forged derived fields cannot claim that a key is stored', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendor({ key: 'relay', hasStoredApiKey: true });
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: false, hasApiKey: false });
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-clear-key', enabled: false });
    store.clearModelCatalogVendorApiKey('relay');
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: false, hasApiKey: false });
  });

  it('the save-key response reports stored presence without publishing the key', async () => {
    const store = await storeWithVendor();
    const result = store.upsertModelCatalogVendorApiKey('relay', {
      apiKey: 'synthetic-response-key', enabled: false,
    });
    expect(result).toMatchObject({ vendorKey: 'relay', hasStoredApiKey: true, enabled: false });
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: true, hasApiKey: false, enabled: false });
    expect(JSON.stringify(result)).not.toContain('synthetic-response-key');
    expect(JSON.stringify(result)).not.toContain(Buffer.from('synthetic-response-key').toString('base64'));
  });

  it('the clear-key response and subsequent reads agree that stored presence is false', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-clear-response', enabled: false });
    expect(store.clearModelCatalogVendorApiKey('relay'))
      .toMatchObject({ vendorKey: 'relay', hasStoredApiKey: false, hasApiKey: false, enabled: false });
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: false, hasApiKey: false, enabled: false });
  });

  it('vendor upsert replies derive presence from the real record and never persist the public bit', async () => {
    const store = await storeWithVendor();
    expect(store.upsertModelCatalogVendor({ key: 'relay', hasStoredApiKey: true }))
      .toMatchObject({ hasStoredApiKey: false, hasApiKey: false });
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-upsert-response', enabled: false });
    expect(store.upsertModelCatalogVendor({ key: 'relay', name: 'Renamed relay', hasStoredApiKey: false }))
      .toMatchObject({ hasStoredApiKey: true, hasApiKey: false, enabled: false });
    const state = store.readCatalog();
    expect(state.apiKeysByVendor.relay.enabled).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'model-catalog.json'), 'utf8'));
    expect(persisted.vendors.find((value: { key: string }) => value.key === 'relay'))
      .not.toHaveProperty('hasStoredApiKey');
  });

  it.each(['plain', undefined])('legacy %s material is not a stored safeStorage credential', async enc => {
    const store = await storeWithVendor();
    const file = path.join(root, 'model-catalog.json');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    persisted.apiKeysByVendor.relay = {
      vendorKey: 'relay', apiKey: 'synthetic-legacy-value', enabled: true,
      ...(enc ? { enc } : {}), createdAt: '', updatedAt: '',
    };
    persisted.vendors[0].hasStoredApiKey = true;
    fs.writeFileSync(file, JSON.stringify(persisted));
    const bytesBeforeRead = fs.readFileSync(file, 'utf8');
    const decryptCalls = keychain.decryptCalls;
    const vendor = store.listModelCatalogVendors().find(value => value.key === 'relay');
    expect(vendor).toMatchObject({ hasStoredApiKey: false, hasApiKey: false });
    expect(keychain.decryptCalls).toBe(decryptCalls);
    expect(fs.readFileSync(file, 'utf8')).toBe(bytesBeforeRead);
    expect(JSON.stringify(vendor)).not.toContain('synthetic-legacy-value');
  });

  it('reads override a forged disk flag without decrypting or enabling a saved disabled record', async () => {
    const store = await storeWithVendor();
    store.upsertModelCatalogVendorApiKey('relay', { apiKey: 'synthetic-disk-flag', enabled: false });
    const file = path.join(root, 'model-catalog.json');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    persisted.vendors[0].hasStoredApiKey = false;
    persisted.vendors[0].hasApiKey = true;
    fs.writeFileSync(file, JSON.stringify(persisted));
    const bytesBeforeRead = fs.readFileSync(file, 'utf8');
    const decryptCalls = keychain.decryptCalls;
    for (let index = 0; index < 2; index += 1) {
      expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
        .toMatchObject({ hasStoredApiKey: true, hasApiKey: false, enabled: false });
    }
    expect(keychain.decryptCalls).toBe(decryptCalls);
    expect(fs.readFileSync(file, 'utf8')).toBe(bytesBeforeRead);
    expect(store.readCatalog().apiKeysByVendor.relay.enabled).toBe(false);
  });

  it('an empty safeStorage record cannot borrow presence from unrelated encrypted custom config', async () => {
    const store = await storeWithVendor();
    const file = path.join(root, 'model-catalog.json');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    persisted.apiKeysByVendor.relay = {
      vendorKey: 'relay', apiKey: '', enc: 'safeStorage', enabled: false,
      customConfig: { tenant: { enc: 'safeStorage', value: Buffer.from('synthetic-tenant').toString('base64') } },
      createdAt: '', updatedAt: '',
    };
    persisted.vendors[0].hasStoredApiKey = true;
    fs.writeFileSync(file, JSON.stringify(persisted));
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay'))
      .toMatchObject({ hasStoredApiKey: false, hasApiKey: false });
    expect(store.clearModelCatalogVendorApiKey('relay')).toMatchObject({ hasStoredApiKey: false });
    const remaining = store.readCatalog().apiKeysByVendor.relay;
    expect(remaining.apiKey).toBe('');
    expect(remaining.customConfig).toHaveProperty('tenant');
    expect(store.listModelCatalogVendors().find(value => value.key === 'relay')).toMatchObject({ hasStoredApiKey: false });
  });
});
