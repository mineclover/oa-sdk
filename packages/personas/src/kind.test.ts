/**
 * v0.13 — surface kind helpers.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_KIND, KIND_VALUES, domainKind, isHttpDomain, httpDomainsOnly, isValidKind } from './kind.js'
import type { DomainMatrix } from './types.js'

const noPersonas: DomainMatrix['personas'] = []

describe('kind helpers', () => {
  it('domainKind returns explicit kind', () => {
    const m: DomainMatrix = { domain: 'cli', metadata: { kind: 'cli-tool' }, personas: noPersonas }
    expect(domainKind(m)).toBe('cli-tool')
  })

  it('domainKind defaults to openapi-http when metadata absent', () => {
    expect(domainKind({ domain: 'd', personas: noPersonas })).toBe(DEFAULT_KIND)
    expect(DEFAULT_KIND).toBe('openapi-http')
  })

  it('domainKind defaults to openapi-http when kind field absent in metadata', () => {
    const m: DomainMatrix = { domain: 'd', metadata: { responsibility: 'r' }, personas: noPersonas }
    expect(domainKind(m)).toBe('openapi-http')
  })

  it('isHttpDomain reflects domainKind', () => {
    expect(isHttpDomain({ domain: 'a', personas: noPersonas })).toBe(true)
    expect(isHttpDomain({ domain: 'b', metadata: { kind: 'openapi-http' }, personas: noPersonas })).toBe(true)
    expect(isHttpDomain({ domain: 'c', metadata: { kind: 'cli-tool' }, personas: noPersonas })).toBe(false)
    expect(isHttpDomain({ domain: 'd', metadata: { kind: 'library-api' }, personas: noPersonas })).toBe(false)
    expect(isHttpDomain({ domain: 'e', metadata: { kind: 'event-stream' }, personas: noPersonas })).toBe(false)
  })

  it('isValidKind accepts the four canonical values', () => {
    expect(isValidKind('openapi-http')).toBe(true)
    expect(isValidKind('cli-tool')).toBe(true)
    expect(isValidKind('library-api')).toBe(true)
    expect(isValidKind('event-stream')).toBe(true)
  })

  it('isValidKind rejects unknown / typo values', () => {
    expect(isValidKind('openpi-http')).toBe(false)       // typo
    expect(isValidKind('clitool')).toBe(false)           // missing dash
    expect(isValidKind('grpc')).toBe(false)              // unknown
    expect(isValidKind('')).toBe(false)
    expect(isValidKind(undefined)).toBe(false)
    expect(isValidKind(42)).toBe(false)
  })

  it('KIND_VALUES contains exactly four kinds', () => {
    expect(KIND_VALUES.size).toBe(4)
  })

  it('httpDomainsOnly filters out non-HTTP kinds', () => {
    const matrices: DomainMatrix[] = [
      { domain: 'http-default', personas: noPersonas },
      { domain: 'http-explicit', metadata: { kind: 'openapi-http' }, personas: noPersonas },
      { domain: 'cli', metadata: { kind: 'cli-tool' }, personas: noPersonas },
      { domain: 'lib', metadata: { kind: 'library-api' }, personas: noPersonas },
    ]
    const filtered = httpDomainsOnly(matrices).map(m => m.domain)
    expect(filtered).toEqual(['http-default', 'http-explicit'])
  })
})
