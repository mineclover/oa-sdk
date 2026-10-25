import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateStandaloneGuards } from '../src/guards/index.js'

describe('Standalone guard composition', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oa-guard-render-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.each([false, true])('renders without filesystem writes and uses the supplied declaration map (split=%s)', async split => {
    const outDir = join(root, 'absent')
    const artifacts = await generateStandaloneGuards({
      schemaDocument: { $defs: { 'Domain.User': { type: 'string', minLength: 1 } } },
      outDir,
      split,
      dryRun: true,
      typeImportSpecifier: '@app/types',
      typeNames: { 'Domain.User': 'DomainUser' },
    })
    expect(existsSync(outDir)).toBe(false)
    expect(artifacts.some(file => file.content.includes('data is DomainUser'))).toBe(true)
    expect(artifacts.some(file => file.content.includes("import type { DomainUser } from '@app/types'"))).toBe(true)
    expect(artifacts.some(file => file.content.includes('export function isDomain_User'))).toBe(true)
  })
})
