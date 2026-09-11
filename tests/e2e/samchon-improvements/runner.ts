import { spawn } from 'node:child_process'
import * as path from 'node:path'

/**
 * Standalone test runner script for the Samchon Improvements E2E test suite.
 * Executes all 150 tests across Tiers 1-4.
 */
async function runE2eSuite(): Promise<void> {
  const repoRoot = process.cwd()
  const testDir = path.resolve(repoRoot, 'tests/e2e/samchon-improvements')

  console.log('='.repeat(80))
  console.log('🚀 Running E2E Test Suite: Samchon-Inspired Contract Provenance (Tiers 1–4)')
  console.log(`📂 Target Directory: ${testDir}`)
  console.log('='.repeat(80))

  const child = spawn(
    'pnpm',
    ['vitest', 'run', 'tests/e2e/samchon-improvements'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    },
  )

  child.on('close', (code) => {
    if (code === 0) {
      console.log('='.repeat(80))
      console.log('✅ ALL E2E TEST SUITES PASSED CLEANLY (Exit code 0)')
      console.log('='.repeat(80))
      process.exit(0)
    } else {
      console.error('='.repeat(80))
      console.error(`❌ Test suite failed with exit code ${code}`)
      console.error('='.repeat(80))
      process.exit(code ?? 1)
    }
  })

  child.on('error', (err) => {
    console.error(`❌ Failed to spawn test process: ${err.message}`)
    process.exit(1)
  })
}

runE2eSuite()
