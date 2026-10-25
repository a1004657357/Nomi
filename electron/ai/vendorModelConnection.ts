import { extractVendorExtraHeaders, normalizeProviderKind } from '../catalog/catalogStore';
import type { Model, Vendor } from '../catalog/types';
import { endpoint } from '../vendorEndpoint';

function resolveSdkBaseUrl(vendor: Vendor): string {
  const base = (vendor.baseUrlHint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return url.toString();
    }
  } catch {
    // Keep the configured value so the existing request/configuration error remains authoritative.
  }
  return base;
}

export function resolveLanguageModelBaseURL(vendor: Vendor): string {
  if (normalizeProviderKind(vendor.providerKind) === 'anthropic') {
    return (vendor.baseUrlHint || '').trim() || 'https://api.anthropic.com/v1';
  }
  const raw = vendor.meta && typeof vendor.meta === 'object' && !Array.isArray(vendor.meta)
    ? (vendor.meta as Record<string, unknown>).openAiCompatibleBasePath : undefined;
  if (typeof raw !== 'string') return resolveSdkBaseUrl(vendor);
  const base = (vendor.baseUrlHint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  const basePath = raw.trim();
  return basePath ? endpoint(vendor, basePath.startsWith('/') ? basePath : `/${basePath}`) : base;
}

/** Catalog connection rules shared by pi Agent and the non-Agent AI4 tasks. */
export function vendorModelConnection(vendor: Vendor, model: Model, apiKey: string) {
  const kind = normalizeProviderKind(vendor.providerKind);
  const headers = extractVendorExtraHeaders(vendor);
  return {
    kind,
    baseURL: resolveLanguageModelBaseURL(vendor),
    apiKey,
    authType: vendor.authType,
    modelId: (model.modelAlias || model.modelKey).trim(),
    ...(headers ? { headers } : {}),
  };
}
