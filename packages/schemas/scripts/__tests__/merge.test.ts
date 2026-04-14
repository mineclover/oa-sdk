import { describe, it, expect } from 'vitest'
import { mergeSpecs, sortDomainNames, countComponents, type OpenApiSpec } from '../merge.js'

/* ── sortDomainNames ────────────────────────────────────────── */

describe('sortDomainNames', () => {
  it('places "common" first, then alphabetical', () => {
    expect(sortDomainNames(['billing', 'common', 'auth'])).toEqual([
      'common',
      'auth',
      'billing',
    ])
  })

  it('handles list without "common"', () => {
    expect(sortDomainNames(['zeta', 'alpha', 'beta'])).toEqual([
      'alpha',
      'beta',
      'zeta',
    ])
  })

  it('handles empty list', () => {
    expect(sortDomainNames([])).toEqual([])
  })

  it('handles "common" as only element', () => {
    expect(sortDomainNames(['common'])).toEqual(['common'])
  })
})

/* ── countComponents ────────────────────────────────────────── */

describe('countComponents', () => {
  it('returns 0 for undefined', () => {
    expect(countComponents(undefined)).toBe(0)
  })

  it('counts keys across all sections', () => {
    expect(
      countComponents({
        schemas: { A: {}, B: {} },
        responses: { C: {} },
      }),
    ).toBe(3)
  })
})

/* ── mergeSpecs — core logic ────────────────────────────────── */

describe('mergeSpecs', () => {
  const base: OpenApiSpec = {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0' },
    tags: [{ name: 'base-tag' }],
  }

  const profile = { servers: [{ url: 'https://api.example.com' }] }

  it('injects servers from profile', () => {
    const result = mergeSpecs(base, profile, [])
    expect(result.document.servers).toEqual(profile.servers)
  })

  it('merges paths from multiple domains', () => {
    const domains = [
      {
        name: 'auth',
        spec: { paths: { '/login': { post: {} } } } as OpenApiSpec,
      },
      {
        name: 'billing',
        spec: { paths: { '/invoices': { get: {} } } } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains)
    expect(result.document.paths).toEqual({
      '/login': { post: {} },
      '/invoices': { get: {} },
    })
    expect(result.pathCount).toBe(2)
  })

  it('throws on duplicate paths from different domains', () => {
    const domains = [
      {
        name: 'auth',
        spec: { paths: { '/users': { get: {} } } } as OpenApiSpec,
      },
      {
        name: 'billing',
        spec: { paths: { '/users': { post: {} } } } as OpenApiSpec,
      },
    ]
    expect(() => mergeSpecs(base, profile, domains)).toThrow(/중복 경로.*\/users/)
  })

  it('merges components and counts them', () => {
    const domains = [
      {
        name: 'common',
        spec: {
          components: { schemas: { Error: { type: 'object' } } },
        } as OpenApiSpec,
      },
      {
        name: 'auth',
        spec: {
          components: { schemas: { Token: { type: 'string' } } },
        } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains)
    expect(result.document.components!['schemas']).toEqual({
      Error: { type: 'object' },
      Token: { type: 'string' },
    })
    expect(result.componentCount).toBe(2)
  })

  it('throws on duplicate component by default', () => {
    const domains = [
      {
        name: 'common',
        spec: {
          components: { schemas: { Shared: { type: 'string' } } },
        } as OpenApiSpec,
      },
      {
        name: 'billing',
        spec: {
          components: { schemas: { Shared: { type: 'number' } } },
        } as OpenApiSpec,
      },
    ]
    expect(() => mergeSpecs(base, profile, domains)).toThrow(/중복 컴포넌트.*schemas\.Shared.*common.*billing/)
  })

  it('allows duplicate component with explicit warn policy', () => {
    const domains = [
      {
        name: 'common',
        spec: {
          components: { schemas: { Shared: { type: 'string' } } },
        } as OpenApiSpec,
      },
      {
        name: 'billing',
        spec: {
          components: { schemas: { Shared: { type: 'number' } } },
        } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains, { duplicateComponents: 'warn' })
    expect(result.document.components!['schemas']!['Shared']).toEqual({
      type: 'number',
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/중복 컴포넌트.*schemas\.Shared.*billing/)
    expect(result.warnings[0]).toContain('스키마 이름 충돌 방지')
  })

  it('allows duplicate component with allow-list', () => {
    const domains = [
      {
        name: 'common',
        spec: {
          components: { schemas: { Shared: { type: 'string' } } },
        } as OpenApiSpec,
      },
      {
        name: 'billing',
        spec: {
          components: { schemas: { Shared: { type: 'number' } } },
        } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains, { allowComponentOverrides: ['schemas.Shared'] })
    expect(result.document.components!['schemas']!['Shared']).toEqual({ type: 'number' })
    expect(result.warnings[0]).toContain('명시 허용')
  })

  it('skips duplicate tags', () => {
    const baseWithTag: OpenApiSpec = {
      openapi: '3.2.0',
      info: { title: 'Test', version: '1.0' },
      tags: [{ name: 'Auth' }],
    }
    const domains = [
      {
        name: 'auth',
        spec: {
          tags: [{ name: 'Auth' }, { name: 'Users' }],
        } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(baseWithTag, profile, domains)
    const tagNames = (result.document.tags as Array<{ name: string }>).map(t => t.name)
    expect(tagNames).toEqual(['Auth', 'Users'])
  })

  it('initialises tags if base has none', () => {
    const baseNoTags: OpenApiSpec = {
      openapi: '3.2.0',
      info: { title: 'Test', version: '1.0' },
    }
    const domains = [
      {
        name: 'auth',
        spec: { tags: [{ name: 'Auth' }] } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(baseNoTags, profile, domains)
    expect(result.document.tags).toEqual([{ name: 'Auth' }])
  })

  it('does not mutate the original base spec', () => {
    const original: OpenApiSpec = {
      openapi: '3.2.0',
      info: { title: 'Test', version: '1.0' },
    }
    mergeSpecs(original, profile, [])
    // Original should not have paths/components added
    expect(original.paths).toBeUndefined()
  })

  it('handles domains without paths or components gracefully', () => {
    const domains = [
      {
        name: 'empty',
        spec: {} as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains)
    expect(result.pathCount).toBe(0)
    expect(result.componentCount).toBe(0)
  })

  it('merges multiple component sections', () => {
    const domains = [
      {
        name: 'auth',
        spec: {
          components: {
            schemas: { Token: { type: 'string' } },
            securitySchemes: { Bearer: { type: 'http' } },
          },
        } as OpenApiSpec,
      },
    ]
    const result = mergeSpecs(base, profile, domains)
    expect(result.document.components!['schemas']).toEqual({ Token: { type: 'string' } })
    expect(result.document.components!['securitySchemes']).toEqual({ Bearer: { type: 'http' } })
    expect(result.componentCount).toBe(2)
  })
})
