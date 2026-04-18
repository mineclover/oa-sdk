import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeDefinitionDuplicateReview } from '../cli/lib/duplicate-review.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-duplicate-review-'))
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('definition duplicate review analyzer', () => {
  it('reports duplicate identity, shape, naming, and semantic alias candidates without mutating fragments', () => {
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    })
    writeFragment('schema/public/book/BookDuplicate.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        required: ['duplicateId'],
        properties: {
          duplicateId: { type: 'string' },
        },
      },
    })
    writeFragment('schema/public/book/BookAlias.yaml', {
      id: 'schema:public/book/BookAlias',
      metadata: {
        semanticAliasOf: 'oa://schema/public/book/Book',
      },
      content: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    })
    writeFragment('schema/public/notebook/Book.yaml', {
      id: 'schema:public/notebook/Book',
      content: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
        },
      },
    })
    const targetPath = writeTarget('public-api.yaml', {
      name: 'public-api',
      scopes: ['public'],
      domains: ['book', 'notebook'],
      servers: [],
      includePaths: [],
      includeDefinitions: [
        'schema:public/book/Book',
        'schema:public/notebook/Book',
      ],
      namingPolicy: {
        aliases: {
          'schema:public/book/Book': 'SameBook',
          'schema:public/notebook/Book': 'SameBook',
        },
      },
    })
    const before = snapshotFragments()

    const result = analyzeDefinitionDuplicateReview({
      fragmentsDir: join(tmpDir, 'fragments'),
      targetPaths: [targetPath],
    })

    expect(snapshotFragments()).toEqual(before)
    expect(result.valid).toBe(false)
    expect(result.summary.findingsByCode).toEqual(expect.objectContaining({
      'definition-duplicate-review/duplicate-canonical-id': 1,
      'definition-duplicate-review/same-content-hash': 1,
      'definition-duplicate-review/same-local-name-different-shape': 1,
      'definition-duplicate-review/output-name-collision': 1,
      'definition-duplicate-review/semantic-alias': 1,
    }))

    const duplicateId = finding(result, 'definition-duplicate-review/duplicate-canonical-id')
    expect(duplicateId.canonicalIds).toEqual(['schema:public/book/Book'])
    expect(duplicateId.sources.map(source => source.sourcePath)).toEqual([
      join(tmpDir, 'fragments/schema/public/book/Book.yaml'),
      join(tmpDir, 'fragments/schema/public/book/BookDuplicate.yaml'),
    ])

    const sameHash = finding(result, 'definition-duplicate-review/same-content-hash')
    expect(sameHash.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(sameHash.canonicalIds).toEqual([
      'schema:public/book/Book',
      'schema:public/book/BookAlias',
    ])

    const localName = finding(result, 'definition-duplicate-review/same-local-name-different-shape')
    expect(localName).toEqual(expect.objectContaining({
      kind: 'schema',
      localName: 'Book',
      canonicalIds: [
        'schema:public/book/Book',
        'schema:public/notebook/Book',
      ],
    }))
    expect(localName.contentHashes?.length).toBeGreaterThan(1)

    const outputCollision = finding(result, 'definition-duplicate-review/output-name-collision')
    expect(outputCollision).toEqual(expect.objectContaining({
      targetName: 'public-api',
      targetPath,
      kind: 'schema',
      outputName: 'SameBook',
      canonicalIds: [
        'schema:public/book/Book',
        'schema:public/notebook/Book',
      ],
    }))
    expect(outputCollision.outputNameReport).toEqual([
      expect.objectContaining({
        canonicalId: 'schema:public/book/Book',
        reason: 'output-name-collision',
        severity: 'error',
      }),
      expect.objectContaining({
        canonicalId: 'schema:public/notebook/Book',
        reason: 'output-name-collision',
        severity: 'error',
      }),
    ])

    const semanticAlias = finding(result, 'definition-duplicate-review/semantic-alias')
    expect(semanticAlias.semanticAlias).toEqual(expect.objectContaining({
      sourceId: 'schema:public/book/BookAlias',
      targetId: 'schema:public/book/Book',
    }))
  })
})

function finding(
  result: ReturnType<typeof analyzeDefinitionDuplicateReview>,
  code: string,
) {
  const match = result.findings.find(entry => entry.code === code)
  if (!match) throw new Error(`Missing finding ${code}`)
  return match
}

function writeFragment(relativePath: string, value: unknown): string {
  return writeYaml(join(tmpDir, 'fragments', relativePath), value)
}

function writeTarget(relativePath: string, value: unknown): string {
  return writeYaml(join(tmpDir, 'targets', relativePath), value)
}

function writeYaml(filePath: string, value: unknown): string {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function snapshotFragments(): Record<string, string> {
  const root = join(tmpDir, 'fragments')
  const files = [
    'schema/public/book/Book.yaml',
    'schema/public/book/BookAlias.yaml',
    'schema/public/book/BookDuplicate.yaml',
    'schema/public/notebook/Book.yaml',
  ]

  return Object.fromEntries(files.map(relativePath => [
    relativePath,
    readFileSync(join(root, relativePath), 'utf8'),
  ]))
}
