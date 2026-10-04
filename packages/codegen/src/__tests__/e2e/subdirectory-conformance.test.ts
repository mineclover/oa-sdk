import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findProjectRootDetail } from '@oa-sdk/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const browserStudioRoot = '/Users/junwoobang/workflow/browser-studio'
const distCli = path.resolve(__dirname, '../../../dist/cli/index.js')
const srcCli = path.resolve(__dirname, '../../cli/index.ts')
const cliExecutable = fs.existsSync(distCli) ? `node "${distCli}"` : `npx tsx "${srcCli}"`

const TEST_DIRECTORIES = [
  { name: 'Monorepo Root', path: browserStudioRoot },
  { name: 'Standard Package', path: path.join(browserStudioRoot, 'packages/surface-engine') },
  { name: 'Nested Package Directory', path: path.join(browserStudioRoot, 'packages/surface-engine/test') },
  { name: 'Git Submodule Root', path: path.join(browserStudioRoot, 'packages/browser-mapper') },
  { name: 'Deep Submodule Package', path: path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils') },
  { name: 'Deep Submodule Package 2', path: path.join(browserStudioRoot, 'packages/browser-mapper/packages/browser-mapper') },
]

describe.skipIf(!fs.existsSync(browserStudioRoot))('Milestone 4: Deep Subdirectory Execution Conformance', () => {
  describe('Resolution Invariant Verification', () => {
    for (const target of TEST_DIRECTORIES) {
      it(`resolves browser-studio root from ${target.name}`, () => {
        const detail = findProjectRootDetail(target.path)
        expect(detail.root).toBe(browserStudioRoot)
        expect(detail.tier).toBe(3)
        expect(detail.reason).toBe('config')
        expect(detail.matchedMarker).toBe('oa.config.ts')
      })
    }
  })

  describe('CLI Command Execution from Subdirectories', () => {
    for (const target of TEST_DIRECTORIES) {
      it(`executes oa-gen validate (no args) from ${target.name}`, () => {
        const stdout = execSync(`${cliExecutable} validate`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('Summary: 6 total targets, 6 passed, 0 failed')
      })

      it(`executes oa-gen audit:csp --bundle dist/guards from ${target.name}`, () => {
        const stdout = execSync(`${cliExecutable} audit:csp --bundle dist/guards`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('0 CSP violations found')
        expect(stdout).toContain('Manifest V3 compliant')
      })
    }
  })
})
