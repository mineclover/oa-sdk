import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const cliPath = resolve(root, 'packages/codegen/dist/cli/index.js')

if (!existsSync(cliPath) || !statSync(cliPath).isFile()) {
  console.error('OpenAPI/Definition Builder requires the built @oa-sdk/codegen CLI.')
  console.error(`Missing: ${cliPath}`)
  console.error('Run `pnpm schema:prepare-openapi` first, or use `pnpm schema:validate:openapi` / `pnpm schema:bundle:openapi`.')
  process.exit(1)
}

console.log(`Codegen CLI preflight passed: ${cliPath}`)
