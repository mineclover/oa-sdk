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

  it('assigns distinct split paths to custom guards of the same type', async () => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: { $defs: { User: { type: 'string' } } },
      outDir: root,
      split: true,
      dryRun: true,
      guards: [
        { name: 'isUser', typeName: 'User', schema: '#/$defs/User' },
        { name: 'isOtherUser', typeName: 'User', schema: '#/$defs/User' },
      ],
    })
    expect(new Set(artifacts.map(file => file.filePath)).size).toBe(artifacts.length)
    expect(artifacts.find(file => file.filePath.endsWith('/index.js'))?.content)
      .toContain("export * from './guards/User_2.js'")
  })

  it('keeps split files distinct on case-insensitive filesystems', async () => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: { $defs: { User: { type: 'string' }, user: { type: 'integer' } } },
      outDir: root,
      split: true,
      dryRun: true,
    })
    expect(new Set(artifacts.map(file => file.filePath.toLowerCase())).size).toBe(artifacts.length)
  })
})
