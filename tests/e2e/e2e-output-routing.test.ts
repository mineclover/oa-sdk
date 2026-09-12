import { describe, it, expect } from 'vitest'
import {
  resolvePathPattern,
  dispatchArtifactPath,
  resolveImportSpecifier,
  validateOutputRoutingConfig,
  type OutputRoutingConfig,
} from './output-routing-tanstack/helpers/routing-harness.js'

describe('E2E Output Path Routing Engine Entrypoint', () => {
  it('e2e-routing-1: resolves FSD directory pattern', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      casing: 'kebab',
    }
    const path = dispatchArtifactPath({ tag: 'users', kind: 'queries' }, config)
    expect(path).toBe('src/features/users/api/users.queries.ts')
  })

  it('e2e-routing-2: resolves Clean Architecture DDD directory pattern', () => {
    const config: OutputRoutingConfig = {
      byKind: {
        schemas: 'src/domain/{tag}/model/{tag}.types.ts',
        client: 'src/infrastructure/http/{tag}.client.ts',
      },
    }
    expect(dispatchArtifactPath({ tag: 'orders', kind: 'schemas' }, config)).toBe(
      'src/domain/orders/model/orders.types.ts',
    )
    expect(dispatchArtifactPath({ tag: 'orders', kind: 'client' }, config)).toBe(
      'src/infrastructure/http/orders.client.ts',
    )
  })

  it('e2e-routing-3: recalculates relative imports across folders', () => {
    const from = 'src/features/users/api/users.queries.ts'
    const to = 'src/shared/api/users.client.ts'
    const rel = resolveImportSpecifier({ fromFilePath: from, toFilePath: to })
    expect(rel).toBe('../../../shared/api/users.client.js')
  })

  it('e2e-routing-4: validates output routing configuration schema', () => {
    const valid = validateOutputRoutingConfig({
      pattern: 'src/api/{tag}.{kind}.ts',
      casing: 'camel',
    })
    expect(valid.valid).toBe(true)

    const invalid = validateOutputRoutingConfig({
      casing: 'unsupported',
    })
    expect(invalid.valid).toBe(false)
  })
})
