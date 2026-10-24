import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Run the unchanged product scanner in isolation without its CLI or baseline writer.
export function visibleTextScanner(root) {
  const source = fs.readFileSync(path.join(root, 'scripts/check-i18n-visible-text.mjs'), 'utf8')
  const boundary = source.indexOf('const files = [SRC_ROOT, ELECTRON_ROOT]')
  if (boundary < 0) throw new Error('Visible-text scanner entry point changed')
  const declarations = source.slice(0, boundary).replace(/^import .*$/gm, '')
  return new Function('fs', 'path', 'process', 'ts', `${declarations}\nreturn { scanFile, isProductSource };`)(
    fs, path, { cwd: () => root, argv: [] }, ts,
  )
}

export function scanTsxI18n(root) {
  const scanner = visibleTextScanner(root)
  return ts.sys.readDirectory(path.join(root, 'src'), ['.tsx'], undefined, undefined)
    .filter(scanner.isProductSource)
    .flatMap(scanner.scanFile)
}
