import { describe, it, expect } from 'vitest'
import {
  dispatchArtifactPath,
  resolvePathPattern,
  resolveImportSpecifier,
  validateOaConfig,
  type OutputRoutingConfig,
} from '../index.js'

describe('E2E Codegen Output Path Routing', () => {
  it('e2e-codegen-routing-1: dispatches to FSD pattern', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
    }
    const res = dispatchArtifactPath({ tag: 'users', kind: 'queries' }, { config })
    expect(res.relativePath).toBe('src/features/users/api/users.queries.ts')
  })

  it('e2e-codegen-routing-2: resolves relative import paths correctly', () => {
    const rel = resolveImportSpecifier({
      fromFilePath: 'src/features/users/api/users.queries.ts',
      toFilePath: 'src/features/users/api/users.keys.ts',
    })
    expect(rel).toBe('./users.keys.js')
  })

  it('e2e-codegen-routing-3: validates OutputRoutingConfig schema', () => {
    const res = validateOaConfig({
      outputRouting: {
        pattern: 'src/api/{tag}.ts',
        casing: 'kebab',
      },
    })
    expect(res.valid).toBe(true)
  })
})
