import { desktopT } from "../desktopStrings";
import type { ProfileKind } from "./types";
import { isVendorOfBuiltin, type VendorIdentityEntry } from '../shared/builtinVendorIdentity';

export type AgnesPublicImageProbeReport = {
  url: string;
  status: number;
  contentType: string;
  elapsedMs: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return Boolean(
      hostname
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && hostname !== "::1"
      && !hostname.startsWith("fc")
      && !hostname.startsWith("fd")
      && !hostname.startsWith("fe80:")
      && !isPrivateIpv4(hostname),
    );
  } catch {
    return false;
  }
}

export function isAgnesImageToVideoRequest(vendorKey: string, taskKind: ProfileKind, vendors: readonly VendorIdentityEntry[] = []): boolean {
  return isVendorOfBuiltin(vendors, vendorKey, 'agnes') && taskKind === "image_to_video";
}

export async function assertAgnesPublicImageReachable(
  imageUrl: string,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<AgnesPublicImageProbeReport> {
  if (!isPublicHttpUrl(imageUrl)) {
    throw new Error(desktopT("custom.catalog.agnesPublicAssetProbe.text1", { value0: `${imageUrl}` }));
  }

  const timeoutMs = Math.max(250, Math.floor(options.timeoutMs ?? 12_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(imageUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? `${Math.round(timeoutMs / 1000)} 秒内无响应`
      : error instanceof Error ? error.message : String(error);
    throw new Error(desktopT("custom.catalog.agnesPublicAssetProbe.text2", { value0: `${detail}` }), { cause: error });
  } finally {
    clearTimeout(timer);
  }

  const contentType = String(response.headers.get("content-type") || "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  void response.body?.cancel().catch(() => {});
  if (!response.ok) {
    throw new Error(desktopT("custom.catalog.agnesPublicAssetProbe.text3", { value0: `${response.status}` }));
  }
  if (
    contentType
    && !contentType.startsWith("image/")
    && contentType !== "application/octet-stream"
  ) {
    throw new Error(desktopT("custom.catalog.agnesPublicAssetProbe.text4", { value0: `${contentType}` }));
  }

  return {
    url: imageUrl,
    status: response.status,
    contentType,
    elapsedMs: Date.now() - startedAt,
  };
}
