import crypto from "node:crypto";

const processToken = process.env.NOMI_JIMENG_WEB_TOKEN?.trim() || crypto.randomBytes(32).toString("hex");

export function jimengWebAuthToken(): string {
  return processToken;
}

export function jimengWebAuthHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("X-Nomi-Token", processToken);
  return result;
}
