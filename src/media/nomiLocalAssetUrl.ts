export type NomiLocalAssetTarget = {
  projectId: string
  relativePath: string
}

function safePathSegments(value: string): string[] | null {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return null
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null
  const segments = value.split('/')
  return segments.length > 0 && segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\\'))
    ? segments
    : null
}

/** Build a project-owned local asset URL without allowing path traversal. */
export function buildNomiLocalAssetUrl(projectId: string, relativePath: string): string {
  const cleanProjectId = projectId.trim()
  const cleanRelativePath = relativePath.trim()
  const pathSegments = safePathSegments(cleanRelativePath)
  if (!cleanProjectId || cleanProjectId === '.' || cleanProjectId === '..' || /[\\/]/.test(cleanProjectId) || !pathSegments) {
    throw new Error('Unsafe local asset path')
  }
  return `nomi-local://asset/${encodeURIComponent(cleanProjectId)}/${pathSegments.map(encodeURIComponent).join('/')}`
}

/**
 * Parse the ownership encoded in a local project asset URL.
 *
 * The URL is the authority for cross-project assets: an "All assets" card can
 * belong to a different project than the workbench that is currently open.
 */
export function parseNomiLocalAssetUrl(url: unknown): NomiLocalAssetTarget | null {
  if (typeof url !== 'string') return null
  const prefix = 'nomi-local://asset/'
  if (!url.startsWith(prefix)) return null
  const pathPart = url.slice(prefix.length).split(/[?#]/, 1)[0]
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length < 2) return null
  try {
    const projectId = decodeURIComponent(segments[0]).trim()
    const relativePath = segments.slice(1).map((segment) => decodeURIComponent(segment)).join('/').trim()
    return projectId && safePathSegments(relativePath) ? { projectId, relativePath } : null
  } catch {
    return null
  }
}
