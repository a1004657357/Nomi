// Exact legacy names already supported by the curated product profile, not fuzzy product families.
const PRODUCT_IDENTIFIER_ALIASES: Readonly<Record<string, string>> = {
  'gpt-4o-image': 'gpt-image-2',
  'gpt_image_2': 'gpt-image-2',
  'codex-img2': 'gpt-image-2',
  'codex-imagegen-img2': 'gpt-image-2',
}

/** Preserve namespaces and unknown identities, including future model versions. */
export function canonicalArchetypeIdentifier(identifier: string): string {
  const slash = identifier.lastIndexOf('/')
  const name = identifier.slice(slash + 1)
  const key = name.toLowerCase()
  const canonical = Object.hasOwn(PRODUCT_IDENTIFIER_ALIASES, key) ? PRODUCT_IDENTIFIER_ALIASES[key] : undefined
  return canonical ? identifier.slice(0, slash + 1) + canonical : identifier
}
