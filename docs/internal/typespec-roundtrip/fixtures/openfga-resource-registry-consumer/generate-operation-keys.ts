import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

function readOption(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`${name} is required`)
  return value
}

const catalogDirectory = resolve(readOption('--catalog-dir'))
const outputFile = resolve(readOption('--output'))
const operationKeys = new Set<string>()

for (const fileName of (await readdir(catalogDirectory)).filter(file => file.endsWith('.json')).sort()) {
  const raw = JSON.parse(await readFile(resolve(catalogDirectory, fileName), 'utf8')) as {
    kind?: string
    authorization?: { operations?: Record<string, unknown> }
  }
  if (raw.kind !== 'resource') continue
  for (const key of Object.keys(raw.authorization?.operations ?? {})) operationKeys.add(key)
}

if (operationKeys.size === 0) throw new Error(`No resource operation keys found in ${catalogDirectory}`)

const lines = [
  '/**',
  ` * Generated from ${basename(catalogDirectory)}/*.json. Do not edit manually.`,
  ' * Regenerate this file when the catalog operation registry changes.',
  ' */',
  'alias OperationKey =',
  ...[...operationKeys].sort().map((key, index, values) => `  ${JSON.stringify(key)}${index === values.length - 1 ? ';' : ' |'}`),
]

await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
