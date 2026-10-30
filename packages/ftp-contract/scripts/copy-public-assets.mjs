import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(packageRoot, 'dist')

for (const directory of ['schema', 'fixtures']) {
  const source = resolve(packageRoot, directory)
  const destination = resolve(distRoot, directory)
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true })
}
