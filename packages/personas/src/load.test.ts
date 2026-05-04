/**
 * load.ts — I/O boundary tests.
 *
 * Verifies parser handles missing files, partial yaml, and operations with
 * unusual response shapes (range / default / no responses block).
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadAllDomains,
  loadAllTraits,
  loadOperationIdsFromMergedSpec,
  loadOperationsFromMergedSpec,
  loadRegistry,
} from './load.js'

const tmpRoot = mkdtempSync(join(tmpdir(), 'personas-load-'))

function writeSpec(name: string, body: string): string {
  const path = join(tmpRoot, name)
  writeFileSync(path, body)
  return path
}

describe('load.ts — I/O boundary', () => {
  it('returns null for missing spec file', () => {
    expect(loadOperationsFromMergedSpec('/nonexistent/path/to/spec.yaml')).toBeNull()
    expect(loadOperationIdsFromMergedSpec('/nonexistent/path/to/spec.yaml')).toBeNull()
  })

  it('returns empty map for spec with no paths block', () => {
    const path = writeSpec('no-paths.yaml', `openapi: "3.2.0"\ninfo:\n  title: x\n  version: "1"\n`)
    const ops = loadOperationsFromMergedSpec(path)
    expect(ops).not.toBeNull()
    expect(ops!.size).toBe(0)
  })

  it('skips operations missing operationId', () => {
    const path = writeSpec('no-opid.yaml', [
      'openapi: "3.2.0"',
      'paths:',
      '  /noid:',
      '    get:',
      '      responses:',
      '        "200":',
      '          description: ok',
      '  /yesid:',
      '    get:',
      '      operationId: getYes',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'))
    const ops = loadOperationsFromMergedSpec(path)
    expect(ops!.size).toBe(1)
    expect(ops!.has('getYes')).toBe(true)
  })

  it('captures all declared response status keys (codes + ranges + default)', () => {
    const path = writeSpec('responses.yaml', [
      'openapi: "3.2.0"',
      'paths:',
      '  /op:',
      '    get:',
      '      operationId: opId',
      '      responses:',
      '        "200":',
      '          description: ok',
      '        "4XX":',
      '          description: client error range',
      '        "default":',
      '          description: fallback',
      '',
    ].join('\n'))
    const ops = loadOperationsFromMergedSpec(path)
    expect(ops!.get('opId')!.responses).toEqual(new Set(['200', '4XX', 'default']))
  })

  it('handles operations with no responses block', () => {
    const path = writeSpec('no-responses.yaml', [
      'openapi: "3.2.0"',
      'paths:',
      '  /op:',
      '    get:',
      '      operationId: opId',
      '',
    ].join('\n'))
    const ops = loadOperationsFromMergedSpec(path)
    expect(ops!.get('opId')!.responses.size).toBe(0)
  })

  it('ignores non-HTTP-method keys in path items (parameters, summary, etc.)', () => {
    const path = writeSpec('mixed.yaml', [
      'openapi: "3.2.0"',
      'paths:',
      '  /op:',
      '    summary: a path',
      '    parameters:',
      '      - name: id',
      '        in: query',
      '    get:',
      '      operationId: opGet',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'))
    const ops = loadOperationsFromMergedSpec(path)
    expect(ops!.size).toBe(1)
    expect(ops!.has('opGet')).toBe(true)
  })

  it('loads bundled registry, traits, and domains successfully', () => {
    const registry = loadRegistry()
    expect(registry.version).toMatch(/^\d/)
    expect(Object.keys(registry.buckets)).toEqual(['identity', 'reference', 'outcome'])

    const traits = loadAllTraits(registry)
    expect(traits.has('actor')).toBe(true)
    expect(traits.has('intent')).toBe(true)

    const domains = loadAllDomains()
    expect(domains.length).toBeGreaterThan(0)
    for (const d of domains) {
      expect(d.domain).toBeTruthy()
      expect(Array.isArray(d.personas)).toBe(true)
    }
  })

  // cleanup
  afterAllCleanup()
})

function afterAllCleanup(): void {
  process.on('exit', () => {
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  })
}
