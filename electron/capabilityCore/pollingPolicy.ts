import { builtinVendorKeyOfKey } from '../shared/builtinVendorIdentity';

export function resolveCapabilityPollTimeoutMs(kind: string, envValue: string | undefined = process.env.NOMI_POLL_TIMEOUT_MS): number {
  const override = Number(envValue);
  if (Number.isFinite(override) && override > 0) return override;
  return kind === 'text_to_video' || kind === 'image_to_video' ? 900_000 : 240_000;
}

export function resolveCapabilityPollIntervalMs(kind: string, vendor: string): number {
  if ((kind === 'text_to_video' || kind === 'image_to_video') && builtinVendorKeyOfKey(vendor) === 'agnes') return 15_000;
  return kind === 'text_to_video' || kind === 'image_to_video' ? 3_000 : 1_500;
}
