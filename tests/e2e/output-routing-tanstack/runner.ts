import { spawn } from 'node:child_process'
import * as path from 'node:path'

/**
 * Standalone test runner script for the Output Path Routing & TanStack Query v5 E2E test suite.
 * Executes all tests across Tiers 1-4.
 */
async function runE2eSuite(): Promise<void> {
  const repoRoot = process.cwd()
  const testDir = path.resolve(repoRoot, 'tests/e2e/output-routing-tanstack')

  console.log('='.repeat(80))
  console.log('🚀 Running E2E Test Suite: Output Path Routing & TanStack Query v5 (Tiers 1–4)')
  console.log(`📂 Target Directory: ${testDir}`)
  console.log('='.repeat(80))

  const child = spawn(
    'pnpm',
    ['vitest', 'run', 'tests/e2e/output-routing-tanstack'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    },
  )

  child.on('close', (code) => {
    if (code === 0) {
      console.log('='.repeat(80))
      console.log('✅ ALL OUTPUT ROUTING & TANSTACK QUERY E2E TESTS PASSED CLEANLY (Exit code 0)')
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
