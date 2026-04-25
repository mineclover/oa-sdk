import { describe, expect, it } from 'vitest'
import type { BuildSpecCompositionReport } from '../cli/lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../cli/lib/duplicate-review.js'
import type { BuildSpecMetadataRegistry } from '../cli/lib/metadata-registry.js'
import {
  createReviewBundle,
  createRuntimeDriftFailureReport,
  formatReviewBundleMarkdown,
} from '../cli/lib/review-bundle.js'
import type { ReviewBundleProvenanceDiff } from '../cli/lib/review-bundle.js'
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
    expect(markdown.startsWith('Recommendation: **REQUEST_CHANGES**\n\n## Summary')).toBe(true)
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
    const metadataRegistry = metadataRegistryReport()
    const provenanceDiff = provenanceDiffReport()
    const baseMetadataEntry = metadataRegistry.entries['#/paths/~1pets']!
    const headMetadataEntry = metadataRegistryReport('trk_meta_v2', 'oa-meta:v1:meta2').entries['#/paths/~1pets']!
    const metadataRegistryDiff = {
      checked: true,
      base: 'base.metadata.json',
      head: 'head.metadata.json',
      changed: true,
      summary: '1 metadata registry entry changed',
      differences: [
        {
          kind: 'changed' as const,
          pointer: '#/paths/~1pets',
          base: baseMetadataEntry,
          head: headMetadataEntry,
          message: 'Metadata registry entry changed for #/paths/~1pets.',
        },
      ],
    }
    const duplicateReview = duplicateReviewReport()
    const bundle = createReviewBundle({
      base: { document: spec, path: 'base.yaml' },
      head: { document: spec, path: 'head.yaml' },
      artifact: { document: spec, path: 'artifact.yaml' },
      runtimeDrift,
      provenanceDiff,
      inventory,
      composition,
      metadataRegistry,
      metadataRegistryDiff,
      duplicateReview,
    })
    const parsed = JSON.parse(JSON.stringify(bundle)) as typeof bundle

    expect(bundle.summary.recommendation).toBe('REQUEST_CHANGES')
    expect(parsed.sections.runtimeDrift?.report).toEqual(runtimeDrift)
    expect(parsed.sections.provenanceDiff?.report).toEqual(provenanceDiff)
    expect(parsed.sections.inventory?.report).toEqual(inventory)
    expect(parsed.sections.composition?.report).toEqual(composition)
    expect(parsed.sections.metadataRegistry?.report).toEqual(metadataRegistry)
    expect(parsed.sections.metadataRegistryDiff?.report).toEqual(metadataRegistryDiff)
    expect(parsed.sections.duplicateReview?.report).toEqual(duplicateReview)
    expect(Object.keys(parsed.sections)).toEqual([
      'breakingDiff',
      'artifactFreshness',
      'runtimeDrift',
      'provenanceDiff',
      'inventory',
      'composition',
      'metadataRegistry',
      'metadataRegistryDiff',
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

function metadataRegistryReport(
  trackingId = 'trk_meta_v1',
  stableKey = 'oa-meta:v1:meta1',
): BuildSpecMetadataRegistry {
  return {
    schemaVersion: 'oa-gen.metadata-registry.v1',
    targetName: 'public-api',
    summary: {
      entryCount: 1,
      explicitTrackingIdCount: 0,
      generatedTrackingIdCount: 1,
      invalidTrackingIdCount: 0,
      duplicateTrackingIdCount: 0,
      duplicateStableKeyCount: 0,
      duplicateOutputPointerCount: 0,
    },
    duplicates: {
      trackingIds: [],
      stableKeys: [],
      outputPointers: [],
    },
    entries: {
      '#/paths/~1pets': {
        pointer: '#/paths/~1pets',
        canonicalId: 'path:public/pet/PetsPath',
        kind: 'path',
        sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trackingId,
        trackingIdSource: 'generated',
        identityKey: 'definition:path:public/pet/PetsPath',
        identitySource: 'canonical',
        stableKey,
        metadata: { path: '/pets' },
        openApiPath: '/pets',
      },
    },
  }
}

function provenanceDiffReport(): ReviewBundleProvenanceDiff {
  return {
    checked: true,
    base: 'base.provenance.json',
    head: 'head.provenance.json',
    changed: true,
    summary: '1 provenance entry changed',
    differences: [
      {
        kind: 'changed',
        pointer: '#/paths/~1pets',
        base: {
          canonicalId: 'path:public/pet/PetsPath',
          kind: 'path',
          sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
          sourcePointer: '#/content',
          contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        head: {
          canonicalId: 'path:public/pet/PetsPath',
          kind: 'path',
          sourcePath: 'fragments/path/public/pet/PetsPath.yaml',
          sourcePointer: '#/content',
          contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        message: 'Provenance changed for #/paths/~1pets.',
      },
    ],
  }
}
