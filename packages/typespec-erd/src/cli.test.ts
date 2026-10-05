import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const cliPath = join(workspaceRoot, 'packages', 'typespec-erd', 'dist', 'cli', 'index.js')
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('oa-erd CLI', () => {
  it('emits, validates, and diffs an artifact without a DPM dependency', () => {
    const directory = fixture()
    const artifact = join(directory, 'logical-erd.json')
    const emitted = spawnSync(process.execPath, [cliPath, 'emit', '--project', directory, '--output', artifact], { cwd: directory, encoding: 'utf8' })
    expect(emitted.status).toBe(0)
    expect(readFileSync(artifact, 'utf8')).toContain('oa-sdk.logical-erd.v1')

    const checked = spawnSync(process.execPath, [cliPath, 'check', '--artifact', artifact], { cwd: directory, encoding: 'utf8' })
    expect(checked.status).toBe(0)
    expect(checked.stdout).toContain('artifact is valid')

    const compared = spawnSync(process.execPath, [cliPath, 'diff', '--base', artifact, '--next', artifact, '--format', 'json'], { cwd: directory, encoding: 'utf8' })
    expect(compared.status).toBe(0)
    expect(JSON.parse(compared.stdout)).toMatchObject({ kind: 'oa-sdk.logical-erd-diff.v1', changes: [] })

    const reviewed = spawnSync(process.execPath, [cliPath, 'review', '--artifact', artifact, '--format', 'json'], { cwd: directory, encoding: 'utf8' })
    expect(reviewed.status).toBe(0)
    expect(JSON.parse(reviewed.stdout)).toMatchObject({
      kind: 'oa-sdk.logical-erd-review.v1',
      purpose: 'review-evidence-only',
      artifactId: expect.any(String),
    })
  })

  it('rejects a wire-invalid artifact before semantic comparison', () => {
    const directory = fixture()
    const invalid = join(directory, 'invalid.json')
    writeFileSync(invalid, JSON.stringify({ kind: 'oa-sdk.logical-erd.v1' }))

    const checked = spawnSync(process.execPath, [cliPath, 'check', '--artifact', invalid], { cwd: directory, encoding: 'utf8' })
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain('ERD-SCHEMA')

    const compared = spawnSync(process.execPath, [cliPath, 'diff', '--base', invalid, '--next', invalid], { cwd: directory, encoding: 'utf8' })
    expect(compared.status).toBe(1)
    expect(compared.stderr).toContain('Invalid logical ERD artifact')
  })

  it('rejects malformed catalog evidence with a clear error before building a review', () => {
    const directory = fixture()
    const artifact = join(directory, 'logical-erd.json')
    expect(spawnSync(process.execPath, [cliPath, 'emit', '--project', directory, '--output', artifact], { cwd: directory, encoding: 'utf8' }).status).toBe(0)
    const artifactId = (JSON.parse(readFileSync(artifact, 'utf8')) as { artifactId: string }).artifactId

    const review = (evidence: unknown) => {
      const path = join(directory, 'evidence.json')
      writeFileSync(path, JSON.stringify(evidence))
      return spawnSync(process.execPath, [cliPath, 'review', '--artifact', artifact, '--catalog-evidence', path, '--format', 'json'], { cwd: directory, encoding: 'utf8' })
    }

    const notList = review({ artifactId, fields: 'commerce.customer.id' })
    expect(notList.status).toBe(1)
    expect(notList.stderr).toContain('Catalog evidence must be an object with a string artifactId and a fields array')

    const badEntry = review({ artifactId, fields: [{ logicalFieldId: 'commerce.customer.id', status: 'confirmed' }] })
    expect(badEntry.stderr).toContain('Catalog evidence fields[0] must have string logicalFieldId, status, and reason')

    const badStatus = review({ artifactId, fields: [{ logicalFieldId: 'commerce.customer.id', status: 'maybe', reason: 'r' }] })
    expect(badStatus.stderr).toContain('Unsupported catalog evidence status maybe.')

    const valid = review({ artifactId, fields: [{ logicalFieldId: 'commerce.customer.id', status: 'confirmed', reason: 'catalog match' }] })
    expect(valid.status).toBe(0)
    expect(JSON.parse(valid.stdout)).toMatchObject({ summary: { catalogEvidence: { confirmed: 1 } } })
  })
})

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-erd-cli-fixture-'))
  directories.push(directory)
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
  model Customer {
    @field("commerce.customer.id")
    @primaryKey
    id: string;
  }
}
`)
  return directory
}
