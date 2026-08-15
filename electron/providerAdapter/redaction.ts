const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|key|token)[-_][A-Za-z0-9._~+/-]{8,}\b/gi, "[REDACTED]"],
  [/("?(?:authorization|x-api-key|api[_-]?key)"?\s*[:=]\s*")([^"\n]+)(")/gi, "$1[REDACTED]$3"],
];

export function redactAdapterSecrets(value: string, maxLength = 2_000): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
    .slice(0, maxLength);
}

export function sanitizedAdapterJson(value: unknown): string {
  return redactAdapterSecrets(JSON.stringify(value, null, 2), 64_000);
}
