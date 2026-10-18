import { describe, expect, it } from 'vitest'
import { emitSketchArtifacts } from '../../index.js'

const SAMPLE_TSP = `
namespace PstackMonitor.ModelRouting;

/**
 * Base model routing policy.
 * ## @evidence contracts/routing.md#base-policy
 */
@intent("INTENT-ROUTE-BASE", "docs/routing.md#base-policy")
model BaseRoutingPolicy {
  taskKind: string;
  preferredModel: string;
  timeoutSec: int32;
}

/**
 * Derived deep-workload routing policy.
 * ## @evidence contracts/routing.md#deep-policy
 */
@intent("INTENT-ROUTE-DEEP", "docs/routing.md#deep-policy")
@derivedFrom("BaseRoutingPolicy", "Separate 10m+ deep workload budget from instant routing")
model DeepRoutingPolicy is BaseRoutingPolicy {
  requireApprovalMemo: boolean;
  maxSubagents: int32;
}

interface ModelRouter {
  @evidence("contracts/routing.md#resolve-route")
  resolveDeepRoute(policy: DeepRoutingPolicy): string;
}
`

describe('emitSketchArtifacts in @oa-sdk/codegen (TODO-OA-03)', () => {
  it('emits JSON Schema 2020-12 with x-evidence/x-oa-sdk-intent/x-oa-sdk-derived-from, OpenAPI 3.1, Mermaid, TS stub, and Python stub', () => {
    const out = emitSketchArtifacts(SAMPLE_TSP, 'model-routing')

    expect(out.ir.profile).toBe('interface-sketch')
    expect(out.jsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')

    const defs = out.jsonSchema.$defs as Record<string, Record<string, unknown>>
    expect(defs.DeepRoutingPolicy).toBeDefined()
    expect(defs.DeepRoutingPolicy?.['x-oa-sdk-derived-from']).toEqual({
      baseSymbol: 'BaseRoutingPolicy',
      reason: 'Separate 10m+ deep workload budget from instant routing',
    })
    expect(defs.DeepRoutingPolicy?.['x-evidence']).toEqual({
      requirements: ['contracts/routing.md#deep-policy'],
    })

    expect(out.openApi.openapi).toBe('3.1.0')
    expect(out.mermaid).toContain('BaseRoutingPolicy <|-- DeepRoutingPolicy : @derivedFrom')
    expect(out.tsStub).toContain('export interface DeepRoutingPolicy extends BaseRoutingPolicy')
    expect(out.tsStub).toContain('throw new Error("not implemented");')
    expect(out.pyStub).toContain('class DeepRoutingPolicy(BaseRoutingPolicy):')
    expect(out.pyStub).toContain('raise NotImplementedError("not implemented")')
  })
})
