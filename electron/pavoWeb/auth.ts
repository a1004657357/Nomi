import crypto from "node:crypto";

let token = "";

export function pavoWebAuthToken(): string {
  if (!token) token = crypto.randomBytes(32).toString("hex");
  return token;
}

export function pavoWebAuthHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  next.set("X-Nomi-Token", pavoWebAuthToken());
  return next;
}
