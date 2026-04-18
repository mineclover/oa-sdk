import { describe, expect, it } from 'vitest'
import type { BuildSpecCompositionReport } from '../cli/lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../cli/lib/duplicate-review.js'
import {
  createReviewBundle,
  createRuntimeDriftFailureReport,
  formatReviewBundleMarkdown,
} from '../cli/lib/review-bundle.js'
import { createOpenApiInventory } from '../cli/lib/openapi-inventory.js'

describe('review bundle aggregator', () => {
  it('creates a recommendation-first JSON model with separately inspectable sections', () => {
    const spec = reviewSpec('string')
    const bundle = createReviewBundle({
      base: { document: spec, path: 'base.yaml' },
      head: { document: spec, path: 'head.yaml' },
      artifact: { document: spec, path: 'artifact.yaml' },
      includeInventory: true,
    })

    expect(bundle.schemaVersion).toBe('oa-gen.review-bundle.v1')
    expect(Object.keys(bundle.summary)[0]).toBe('recommendation')
    expect(bundle.summary.recommendation).toBe('APPROVE')
    expect(Object.keys(bundle.sections)).toEqual([
      'breakingDiff',
      'artifactFreshness',
      'inventory',
      'nonBreakingChanges',
    ])
    expect(bundle.sections.breakingDiff.changes).toEqual([])
    expect(bundle.sections.artifactFreshness.report.schemaVersion).toBe('oa-gen.artifact-freshness.v1')
    expect(bundle.sections.artifactFreshness.report.fresh).toBe(true)
    expect(bundle.sections.inventory?.report.schemaVersion).toBe('oa-gen.inventory.v1')
  })

  it('keeps breaking changes before non-breaking changes and requests changes for stale artifacts', () => {
    const base = reviewSpec('string')
    const head = reviewSpec('integer', {
      '/status': {
        get: {
          operationId: 'getStatus',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                },
              },
            },
          },
        },
      },
    })
    const bundle = createReviewBundle({
      base: { document: base, path: 'base.yaml' },
      head: { document: head, path: 'head.yaml' },
      artifact: { document: base, path: 'artifact.yaml' },
    })
    const markdown = formatReviewBundleMarkdown(bundle)

    expect(bundle.summary.recommendation).toBe('REQUEST_CHANGES')
    expect(bundle.summary.breakingChanges).toBeGreaterThan(0)
    expect(bundle.summary.nonBreakingChanges).toBeGreaterThan(0)
    expect(bundle.sections.artifactFreshness.report.fresh).toBe(false)
    expect(markdown.indexOf('## Breaking Changes')).toBeLessThan(markdown.indexOf('## Artifact Freshness'))
    expect(markdown.indexOf('## Breaking Changes')).toBeLessThan(markdown.indexOf('## Non-breaking Changes'))
    expect(markdown).toContain('**stale**')
  })

  it('preserves optional report payloads under stable nested section names', () => {
    const spec = reviewSpec('string')
    const runtimeDrift = createRuntimeDriftFailureReport({
      runtime: 'https://example.test/openapi.json',
      managed: 'head.yaml',
      message: 'runtime OpenAPI URL returned HTTP 500',
      runtimeFetch: { status: 500 },
    })
    const inventory = createOpenApiInventory(spec, { documentPath: 'head.yaml' })
    const composition = compositionReport()
    const duplicateReview = duplicateReviewReport()
    const bundle = createReviewBundle({
      base: { document: spec, path: 'base.yaml' },
      head: { document: spec, path: 'head.yaml' },
      artifact: { document: spec, path: 'artifact.yaml' },
      runtimeDrift,
      inventory,
      composition,
      duplicateReview,
    })
    const parsed = JSON.parse(JSON.stringify(bundle)) as typeof bundle

    expect(bundle.summary.recommendation).toBe('REQUEST_CHANGES')
    expect(parsed.sections.runtimeDrift?.report).toEqual(runtimeDrift)
    expect(parsed.sections.inventory?.report).toEqual(inventory)
    expect(parsed.sections.composition?.report).toEqual(composition)
    expect(parsed.sections.duplicateReview?.report).toEqual(duplicateReview)
    expect(Object.keys(parsed.sections)).toEqual([
      'breakingDiff',
      'artifactFreshness',
      'runtimeDrift',
      'inventory',
      'composition',
      'duplicateReview',
      'nonBreakingChanges',
    ])
  })
})

function reviewSpec(
  valueType: 'string' | 'integer',
  extraPaths: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review fixture', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['value'],
                    properties: {
                      value: { type: valueType },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...extraPaths,
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
  }
}

function compositionReport(): BuildSpecCompositionReport {
  return {
    schemaVersion: 'oa-gen.composition-report.v1',
    target: {
      name: 'public-api',
      targetPath: 'targets/public.yaml',
      fragmentsDir: 'fragments',
      scopes: ['public'],
      domains: ['pet'],
      includePaths: ['/pets'],
      includeDefinitions: [],
    },
    summary: {
      registryNodeCount: 2,
      selectedNodeCount: 2,
      directPathCount: 1,
      directDefinitionCount: 0,
      transitiveComponentCount: 1,
      omittedNodeCount: 0,
      sourceRefCount: 1,
      outputAliasCount: 1,
      renamedOutputAliasCount: 0,
      collisionReportCount: 0,
    },
    selected: {
      directPathIds: ['path:public/pet/PetsPath'],
      directDefinitionIds: [],
      transitiveComponentIds: ['schema:public/pet/Pet'],
      selectedNodeIds: ['path:public/pet/PetsPath', 'schema:public/pet/Pet'],
    },
    output: {
      paths: [],
      components: [],
      aliases: [],
      renamedAliases: [],
      collisionReport: [],
    },
    omitted: {
      total: 0,
      byScope: {},
      byDomain: {},
      byKind: {},
    },
    sourceRefs: [],
  }
}

function duplicateReviewReport(): DefinitionDuplicateReviewResult {
  return {
    schemaVersion: 'oa-gen.duplicate-review.v1',
    valid: false,
    fragmentsDir: 'fragments',
    targets: [{ name: 'public-api', targetPath: 'targets/public.yaml' }],
    diagnostics: [],
    findings: [],
    summary: {
      fragmentCount: 2,
      targetCount: 1,
      findingCount: 0,
      diagnosticCount: 0,
      errors: 1,
      warnings: 0,
      infos: 0,
      findingsByCode: {
        'definition-duplicate-review/duplicate-canonical-id': 0,
        'definition-duplicate-review/same-content-hash': 0,
        'definition-duplicate-review/same-local-name-different-shape': 0,
        'definition-duplicate-review/output-name-collision': 0,
        'definition-duplicate-review/semantic-alias': 0,
      },
    },
  }
}
