import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('@oa-sdk/typespec-erd emitter', () => {
  it('emits logical ids, relationship endpoints, and TypeSpec source provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-erd-fixture-'))
    tmpDirs.push(directory)
    const nodeModules = join(directory, 'node_modules')
    mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
    symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'logical-erd-contract'), join(nodeModules, '@oa-sdk', 'logical-erd-contract'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'typespec-erd'), join(nodeModules, '@oa-sdk', 'typespec-erd'), 'dir')
    const exampleDir = join(workspaceRoot, 'packages', 'typespec-erd', 'examples', 'commerce')
    writeFileSync(join(directory, 'main.tsp'), readFileSync(join(exampleDir, 'main.tsp'), 'utf8'))
    writeFileSync(join(directory, 'tspconfig.yaml'), readFileSync(join(exampleDir, 'tspconfig.yaml'), 'utf8'))
    try {
      execFileSync(join(workspaceRoot, 'node_modules', '.bin', 'tsp'), ['compile', directory, '--output-dir', join(directory, 'output')], { cwd: directory, encoding: 'utf8' })
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message: string }
      throw new Error(`${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`)
    }
    const emittedPath = join(directory, 'output', '@oa-sdk', 'typespec-erd', 'logical-erd.json')
    expect(existsSync(emittedPath)).toBe(true)
    const artifact = JSON.parse(readFileSync(emittedPath, 'utf8')) as { kind: string; entities: Array<{ id: string; fields: Array<{ id: string; primaryKeyPart?: { groupId: string; order: number } }> }>; relationships: Array<{ from: { entityId: string }; cardinality: string }>; provenance: Array<{ subject: string; span: { file: string; line: number } }> }
    expect(artifact.kind).toBe('oa-sdk.logical-erd.v1')
    expect(artifact.entities.map(entity => entity.id)).toEqual(['commerce.customer', 'commerce.order'])
    expect(artifact.relationships).toEqual([expect.objectContaining({ cardinality: 'many-to-one', from: { entityId: 'commerce.order', fieldId: 'commerce.order.customer-id' } })])
    expect(artifact.entities.find(entity => entity.id === 'commerce.order')?.fields).toContainEqual(expect.objectContaining({
      id: 'commerce.order.customer-id',
      primaryKeyPart: { groupId: 'commerce.order.primary', order: 2 },
    }))
    expect(artifact.provenance).toContainEqual(expect.objectContaining({ subject: 'relationship:commerce.order-customer', span: expect.objectContaining({ file: join(directory, 'main.tsp'), line: expect.any(Number) }) }))
  })

  it('rejects an entity property without a stable logical field id', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-erd-invalid-fixture-'))
    tmpDirs.push(directory)
    const nodeModules = join(directory, 'node_modules')
    mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
    symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'logical-erd-contract'), join(nodeModules, '@oa-sdk', 'logical-erd-contract'), 'dir')
    symlinkSync(join(workspaceRoot, 'packages', 'typespec-erd'), join(nodeModules, '@oa-sdk', 'typespec-erd'), 'dir')
    writeFileSync(join(directory, 'main.tsp'), `
import "@oa-sdk/typespec-erd";
using OaSdkErd;

@dataset("commerce")
namespace Commerce {
  @entity("commerce.customer")
  model Customer { id: string; }
}
`)
    writeFileSync(join(directory, 'tspconfig.yaml'), `
kind: project
entrypoint: main.tsp
emit:
  - "@oa-sdk/typespec-erd"
`)
    let output = ''
    try {
      execFileSync(join(workspaceRoot, 'node_modules', '.bin', 'tsp'), ['compile', directory], { cwd: directory, encoding: 'utf8' })
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message: string }
      output = `${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`
    }
    expect(output).toContain('requires @field')
  })
})
