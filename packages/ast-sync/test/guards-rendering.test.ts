import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

  it.each([false, true])('exposes .errors on is* guards and emits validate*/assert* when includeAssertions=true (split=%s)', async split => {
    const outDir = join(root, `assertions-${split ? 'split' : 'mono'}`)
    const artifacts = await generateStandaloneGuards({
      schemaDocument: {
        $defs: {
          Account: {
            type: 'object',
            required: ['id', 'count'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              count: { type: 'integer', minimum: 1 },
            },
          },
        },
      },
      outDir,
      split,
      includeAssertions: true,
      typeImportSpecifier: './types.js',
    })

    const dtsContents = artifacts.filter(a => a.kind === 'dts').map(a => a.content).join('\n')
    expect(dtsContents).toContain('export declare namespace isAccount')
    expect(dtsContents).toContain('export declare function validateAccount(')
    expect(dtsContents).toContain('export declare function assertAccount(')

    const mod = await import(pathToFileURL(join(outDir, 'index.js')).href)
    expect(mod.isAccount({ id: '', count: 0 })).toBe(false)
    expect(Array.isArray(mod.isAccount.errors)).toBe(true)
    expect(mod.isAccount.errors.length).toBeGreaterThan(0)

    expect(mod.isAccount({ id: 'a1', count: 2 })).toBe(true)
    expect(mod.isAccount.errors).toBeNull()

    const invalid = mod.validateAccount({ id: 'a1', count: 'bad' })
    expect(invalid.valid).toBe(false)
    expect(Array.isArray(invalid.errors)).toBe(true)
    expect(invalid.errors[0].instancePath).toBe('/count')

    const valid = mod.validateAccount({ id: 'a1', count: 3 })
    expect(valid).toEqual({ valid: true, data: { id: 'a1', count: 3 }, errors: null })

    expect(() => mod.assertAccount({ id: 'a1', count: -1 })).toThrow(TypeError)
    expect(() => mod.assertAccount({ id: 'a1', count: 5 })).not.toThrow()
  })

  it('respects writePackageJson options (auto skips ESM ancestors, false never writes, true always writes)', async () => {
    const schemaDocument = { $defs: { Item: { type: 'object', properties: { id: { type: 'string' } } } } }

    // 1. Inside an ESM ancestor package -> 'auto' skips package.json
    const esmParent = join(root, 'esm-parent')
    const esmNestedOut = join(esmParent, 'src', 'generated')
    mkdirSync(esmParent, { recursive: true })
    writeFileSync(join(esmParent, 'package.json'), JSON.stringify({ name: 'esm-parent', type: 'module' }), 'utf8')
    await generateStandaloneGuards({ schemaDocument, outDir: esmNestedOut })
    expect(existsSync(join(esmNestedOut, 'package.json'))).toBe(false)

    // 2. writePackageJson: true overrides ancestor check
    const forceOut = join(esmParent, 'src', 'forced')
    await generateStandaloneGuards({ schemaDocument, outDir: forceOut, writePackageJson: true })
    expect(existsSync(join(forceOut, 'package.json'))).toBe(true)

    // 3. writePackageJson: false skips even when no ancestor package.json exists
    const isolatedDisabled = join(root, 'isolated-no-pkg')
    await generateStandaloneGuards({ schemaDocument, outDir: isolatedDisabled, writePackageJson: false })
    expect(existsSync(join(isolatedDisabled, 'package.json'))).toBe(false)

    // 4. 'auto' creates package.json in isolated directory without ESM ancestor
    const isolatedAuto = join(root, 'isolated-auto')
    await generateStandaloneGuards({ schemaDocument, outDir: isolatedAuto })
    expect(existsSync(join(isolatedAuto, 'package.json'))).toBe(true)
  })
})
