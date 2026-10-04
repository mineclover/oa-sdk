import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { buildSurfaceIr, emitForgeOverlay, emitForgeOverlays, toForgeProjection } from '../src/index.js'

describe('production OpenAPI surface projection', () => {
  it('keeps the current TypeSpec-derived operation surface Forge-projectable', () => {
    const specPath = new URL('../../schemas/src/.merged.yaml', import.meta.url)
    const document = parseDocument(parse(readFileSync(specPath, 'utf8')) as OasDocument)
    const ir = buildSurfaceIr(document, { target: 'forge' })
    const projection = toForgeProjection(ir, document)
    const overlay = emitForgeOverlay(ir, document)
    const overlays = emitForgeOverlays(ir, document)

    expect(document.operations).toHaveLength(34)
    expect(ir.source.operationCount).toBe(34)
    expect(new Set(Object.keys(ir.operations)).size).toBe(34)
    expect(projection.operations).toHaveLength(34)
    expect(Object.keys(projection.commands).sort()).toEqual(['auth', 'health', 'me', 'users', 'world-model'])
    expect(overlay.overlay.actions).toHaveLength(34)
    expect(overlays.map(item => item.name).sort()).toEqual(['auth', 'health', 'me', 'users', 'world-model'])
    expect(overlays.reduce((count, item) => count + item.overlay.actions.length, 0)).toBe(39)
    expect(ir.operations.listUsers?.runtime.pagination).toEqual({ itemsPath: 'items', totalPath: 'total' })
    expect(ir.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  })
})
