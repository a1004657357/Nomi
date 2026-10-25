export const LOCAL_ASSET_THUMBNAIL_PARAM = "nomi-thumbnail";

export type LocalAssetThumbnailSize = {
  width: number;
  height: number;
};

const MIN_THUMBNAIL_EDGE = 32;
const MAX_THUMBNAIL_EDGE = 512;
const MAX_CACHED_THUMBNAILS = 64;
const thumbnailCache = new Map<string, Promise<Buffer | null>>();

export function parseLocalAssetThumbnailSize(url: URL): LocalAssetThumbnailSize | null {
  const value = url.searchParams.get(LOCAL_ASSET_THUMBNAIL_PARAM);
  const match = /^(\d{2,3})x(\d{2,3})$/.exec(value || "");
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < MIN_THUMBNAIL_EDGE
    || height < MIN_THUMBNAIL_EDGE
    || width > MAX_THUMBNAIL_EDGE
    || height > MAX_THUMBNAIL_EDGE
  ) {
    return null;
  }
  return { width, height };
}

export function cachedLocalAssetThumbnail(
  key: string,
  create: () => Promise<Buffer | null>,
): Promise<Buffer | null> {
  const existing = thumbnailCache.get(key);
  if (existing) return existing;
  if (thumbnailCache.size >= MAX_CACHED_THUMBNAILS) {
    const oldest = thumbnailCache.keys().next().value as string | undefined;
    if (oldest) thumbnailCache.delete(oldest);
  }
  const pending = create().catch((error) => {
    thumbnailCache.delete(key);
    throw error;
  });
  thumbnailCache.set(key, pending);
  return pending;
}

export function resetLocalAssetThumbnailCacheForTests(): void {
  thumbnailCache.clear();
}
