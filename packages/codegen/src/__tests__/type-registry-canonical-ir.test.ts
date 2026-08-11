import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import {
  canonicalizeTypeDeclaration,
  isSupportedTypeDeclaration,
  normalizeTypeScriptSyntax,
} from '../type-registry-canonical-ir.js'

describe('type registry canonical IR', () => {
  it('normalizes trivia, member order, union order, and generic parameter names', () => {
    const box = declaration(`
      // layout must not affect structural identity
      interface Box<T> {
        second?: number
        first: T | string
      }
    `)
    const crate = declaration(`interface Crate<Value> { first: string | Value; second?: number }`)

    const boxHashes = canonicalizeTypeDeclaration({
      sourceFile: box.sourceFile,
      declaration: box.declaration,
      symbolName: 'Box',
    })
    const crateHashes = canonicalizeTypeDeclaration({
      sourceFile: crate.sourceFile,
      declaration: crate.declaration,
      symbolName: 'Crate',
    })

    expect(boxHashes.shapeHash).toBe(crateHashes.shapeHash)
    expect(boxHashes.semanticHash).not.toBe(crateHashes.semanticHash)
    expect(normalizeTypeScriptSyntax('type A = string // comment\n | number'))
      .toBe(normalizeTypeScriptSyntax('type A=string|number'))
  })

  it('preserves modifiers and primitive literal identity', () => {
    const stringLiteral = declaration(`type Value = '1'`)
    const numericLiteral = declaration(`type Value = 1`)
    const readonlyValue = declaration(`interface Value { readonly id: string }`)
    const mutableValue = declaration(`interface Value { id: string }`)

    expect(hashes(stringLiteral).shapeHash).not.toBe(hashes(numericLiteral).shapeHash)
    expect(hashes(readonlyValue).shapeHash).not.toBe(hashes(mutableValue).shapeHash)
  })

  it('uses resolved reference identity only in the semantic hash', () => {
    const parsed = declaration(`type Result<T> = Promise<T>`)
    const first = canonicalizeTypeDeclaration({
      sourceFile: parsed.sourceFile,
      declaration: parsed.declaration,
      symbolName: 'Result',
      resolveReference: name => name === 'Promise' ? 'lib-a#Promise' : undefined,
    })
    const second = canonicalizeTypeDeclaration({
      sourceFile: parsed.sourceFile,
      declaration: parsed.declaration,
      symbolName: 'Result',
      resolveReference: name => name === 'Promise' ? 'lib-b#Promise' : undefined,
    })

    expect(first.shapeHash).toBe(second.shapeHash)
    expect(first.semanticHash).not.toBe(second.semanticHash)
  })
})

function declaration(source: string): { sourceFile: ts.SourceFile; declaration: ReturnType<typeof findDeclaration> } {
  const sourceFile = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return { sourceFile, declaration: findDeclaration(sourceFile) }
}

function findDeclaration(sourceFile: ts.SourceFile) {
  const result = sourceFile.statements.find(isSupportedTypeDeclaration)
  if (result === undefined) throw new Error('Fixture has no supported declaration')
  return result
}

function hashes(parsed: { sourceFile: ts.SourceFile; declaration: ReturnType<typeof findDeclaration> }) {
  return canonicalizeTypeDeclaration({
    sourceFile: parsed.sourceFile,
    declaration: parsed.declaration,
    symbolName: 'Value',
  })
}
