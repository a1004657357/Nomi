import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const file = path.resolve('src/workbench/ai/resident/residentToolDisplay.ts')
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

describe('resident creative display compile boundary', () => {
  it('imports only neutral shared contracts, never main implementation', () => {
    const violations = source.statements.filter(ts.isImportDeclaration).flatMap(node => {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text
      const target = path.resolve(path.dirname(file), specifier)
      const main = path.resolve('electron') + path.sep
      const shared = path.resolve('electron/shared') + path.sep
      return target.startsWith(main) && !target.startsWith(shared) ? [specifier] : []
    })
    expect(violations).toEqual([])
  })

  it.each(['unknown', 'string'])('keeps actual display key annotations assignable when ParseKeys is %s', parseKeys => {
    const annotations = new Map<string, string>()
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ['nameKey', 'boundaryKey'].includes(node.name.getText(source)) && node.type) {
        annotations.set(node.name.getText(source), node.type.getText(source))
      }
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'add' && node.initializer && ts.isArrowFunction(node.initializer)) {
        annotations.set('label', node.initializer.parameters[0].type!.getText(source))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect([...annotations.keys()].sort()).toEqual(['boundaryKey', 'label', 'nameKey'])
    // Compile the real key annotations and their local type owner only. Do not load
    // the resident runtime graph or misreport this as a project typecheck.
    const imports = source.statements.filter(ts.isImportDeclaration)
      .filter(node => (node.moduleSpecifier as ts.StringLiteral).text.endsWith('/locales/agentResident'))
      .map(node => node.getText(source)).join('\n')
    const aliases = source.statements.filter(ts.isTypeAliasDeclaration)
      .filter(node => node.name.text === 'ResidentDisplayKey').map(node => node.getText(source)).join('\n')
    const text = `${imports}\ntype TranslationKey = ${parseKeys};\n${aliases}\n`
      + 'declare const t: (key: string) => string;\n'
      + [...annotations].map(([name, type]) => `declare const ${name}: ${type}; t(${name});`).join('\n')
    const probe = path.join(path.dirname(file), '__resident_key_probe__.ts')
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
    const diagnostics = (extra = '') => {
      const host = ts.createCompilerHost(options)
      const getSourceFile = host.getSourceFile.bind(host)
      host.getSourceFile = (name, version, ...rest) => name === probe
        ? ts.createSourceFile(name, text + extra, version, true) : getSourceFile(name, version, ...rest)
      return ts.getPreEmitDiagnostics(ts.createProgram([probe], options, host))
    }
    expect(diagnostics().map(d => `${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([])
    expect(diagnostics('\nconst misspelled: typeof label = "agentResident.notARealKey";').map(d => d.code)).toEqual([2820])
  })
})
