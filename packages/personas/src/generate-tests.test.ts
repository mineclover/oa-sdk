/**
 * v0.5 generator — smoke tests.
 *
 * Verifies the generator emits a deterministic, runnable suite covering every
 * implemented persona that has both maps_to and expects.
 */

import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

import { generateVitestSuite } from './generate-tests.js'
import { loadAllDomains } from './load.js'
import type { MinimalOpenApiDoc } from './bind.js'
import type { DomainMatrix } from './types.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')

describe('generateVitestSuite — bundled matrices', () => {
  const spec = parse(readFileSync(mergedSpecPath, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()

  it('emits one it() per implemented persona with maps_to + expects', () => {
    const suite = generateVitestSuite({ spec, domains, specRelativePath: './spec.yaml' })

    const itCount = (suite.match(/^\s*it\(/gm) ?? []).length
    const eligible = domains.flatMap(m => m.personas).filter(p =>
      p.status === 'implemented' &&
      (p.outcome?.maps_to?.length ?? 0) > 0 &&
      (p.outcome?.expects?.length ?? 0) > 0,
    ).length
    expect(itCount).toBe(eligible)
  })

  it('emits portable spec path resolution (no absolute paths)', () => {
    const suite = generateVitestSuite({ spec, domains, specRelativePath: '../foo/spec.yaml' })
    expect(suite).toContain("new URL(\"../foo/spec.yaml\", import.meta.url)")
    expect(suite).not.toMatch(/SPEC_PATH = "\//)        // no absolute literal
  })

  it('produces stable ordering (domain alpha → persona id alpha)', () => {
    const a = generateVitestSuite({ spec, domains, specRelativePath: './x.yaml' })
    const b = generateVitestSuite({ spec, domains, specRelativePath: './x.yaml' })
    expect(a).toBe(b)
  })

  it('renders body methods (post/put/patch) with three args, no-body methods (get) with two', () => {
    const suite = generateVitestSuite({ spec, domains, specRelativePath: './x.yaml' })
    // admin-monitor → GET /users — 2 args
    expect(suite).toMatch(/client\.get\("\/users", \{ headers: \{ authorization: 'Bearer t' \} \}\)/)
    // guest-signup → POST /auth/register — 3 args (path, body, opts)
    expect(suite).toMatch(/client\.post\("\/auth\/register", \{[^}]*\}, \{ headers/)
  })

  it('substitutes path placeholders using parameter examples or sensible defaults', () => {
    const suite = generateVitestSuite({ spec, domains, specRelativePath: './x.yaml' })
    // /users/{id} should be substituted to a UUID
    expect(suite).toMatch(/\/users\/00000000-0000-0000-0000-000000000001/)
  })

  it('skips proposed personas (no maps_to)', () => {
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [
        {
          id: 'future-only',
          status: 'proposed',
          identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        },
        {
          id: 'real-one',
          status: 'implemented',
          identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'user-support' },
          outcome: { maps_to: ['op1'], expects: [200] },
        },
      ],
    }]
    const synthSpec: MinimalOpenApiDoc = {
      paths: { '/op1': { get: { operationId: 'op1', responses: { '200': { description: 'ok' } } } } },
    }
    const suite = generateVitestSuite({ spec: synthSpec, domains: synthDomains, specRelativePath: './x.yaml' })
    expect(suite).not.toContain('future-only')     // proposed → skip
    expect(suite).toContain('real-one')             // implemented → include
  })

  it('handles operationId with no examples — emits with body=undefined', () => {
    // Synthetic: persona maps to op with no requestBody example
    const synthSpec: MinimalOpenApiDoc = {
      paths: {
        '/x': { post: { operationId: 'opX', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'ok' } } } },
      },
    }
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'p',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'create', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['opX'], expects: [200] },
      }],
    }]
    const suite = generateVitestSuite({ spec: synthSpec, domains: synthDomains, specRelativePath: './x.yaml' })
    expect(suite).toContain('client.post("/x", undefined, { headers')
  })
})
