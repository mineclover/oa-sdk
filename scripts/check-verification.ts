import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadVerification, renderVerification, statusPath, validateVerification } from './lib/verification.js'

try {
  const root = process.cwd()
  const context = loadVerification(root)
  const errors = validateVerification(context)
  if (errors.length) throw new Error(errors.join('\n'))
  const expected = renderVerification(context)
  const file = resolve(root, statusPath)
  if (process.argv.includes('--write')) writeFileSync(file, expected)
  if (!existsSync(file) || readFileSync(file, 'utf8') !== expected) {
    throw new Error('Verification status is stale; run pnpm verification:report')
  }
  console.log(`Verification registry OK: ${context.features.length} features, ${context.registry.claims.length} scoped claims, ${context.registry.defects.length} defects. This is an evidence consistency gate, not a product test run.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
