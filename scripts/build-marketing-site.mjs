import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertLocaleParity, locales, shared } from './marketing/content.mjs'
import { renderHomepage } from './marketing/template.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const runtimeFacts = Object.freeze({ ...shared, version: packageJson.version })
const checkOnly = process.argv.includes('--check')

assertLocaleParity()

const outputByLocale = new Map([
  ['zh-CN', 'marketing/index.html'],
  ['en', 'marketing/en/index.html'],
])

const outputs = locales.map((locale) => {
  const relativePath = outputByLocale.get(locale)
  if (!relativePath) throw new Error(`No output path for locale: ${locale}`)
  return { relativePath, contents: renderHomepage(locale, runtimeFacts) }
})

if (checkOnly) {
  const stale = outputs
    .filter(({ relativePath, contents }) => {
      const target = path.join(root, relativePath)
      return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== contents
    })
    .map(({ relativePath }) => relativePath)
  if (stale.length) {
    console.error(`Marketing site output is stale:\n${stale.map((item) => `- ${item}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log('MARKETING SITE CHECK PASS')
  }
} else {
  for (const { relativePath, contents } of outputs) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
    fs.writeFileSync(temporary, contents)
    fs.renameSync(temporary, target)
    console.log(`Generated ${relativePath}`)
  }
}
