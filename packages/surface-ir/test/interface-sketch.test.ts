import { describe, expect, it } from 'vitest'
import {
  INTERFACE_SKETCH_IR_VERSION,
  compareSketchCandidates,
  detectTypeSpecProfile,
  parseTypeSpecSketch,
} from '../src/index.js'

const DEEP_SKETCH_TSP = `
namespace PstackMonitor.FileLease;

/**
 * Base lease contract shared across intents.
 * ## @evidence contracts/common.md#lease-invariants
 */
@intent("INTENT-LEASE-CORE", "docs/lease.md#core-lease")
model BaseLeaseContract {
  leaseId: string;
  ownerAgentId: string;
  acquiredAtEpochMs: int64;
  ttlMs: int32;
}

/**
 * Derived writer lease contract with exclusive write scope.
 * ## @evidence contracts/common.md#writer-lease
 */
@intent("INTENT-LEASE-WRITER", "docs/lease.md#writer-lease")
@derivedFrom("BaseLeaseContract", "Separate writer exclusive lock from read-only observer lease")
model WriterLeaseContract is BaseLeaseContract {
  exclusivePaths: string[];
  fencingToken: int64;
}

union LeaseOutcomeKind {
  acquired: "acquired",
  contended: "contended",
  expired: "expired",
}

/**
 * Atomic file lease coordinator boundary.
 * ## @evidence contracts/common.md#lease-coordinator
 */
@intent("INTENT-LEASE-COORD", "docs/lease.md#coordinator")
interface FileLeaseCoordinator {
  @evidence("contracts/common.md#acquire-atomic")
  acquireWriterLease(request: WriterLeaseContract): LeaseOutcomeKind;
}
`

const SHALLOW_SKETCH_TSP = `
namespace ShallowExample;

model SimpleInput {
  id: string;
}

interface ShallowService {
  step1_init(x: string): void;
  step2_process(x: string): void;
  passthrough_call(x: string): void;
}
`

describe('InterfaceSketchProfile in @oa-sdk/surface-ir (TODO-OA-02 / IUD-05 / IUD-07)', () => {
  it('detects openapi-http vs interface-sketch vs hybrid profiles on standard .tsp files', () => {
    expect(detectTypeSpecProfile(DEEP_SKETCH_TSP)).toBe('interface-sketch')
    expect(
      detectTypeSpecProfile(`
        using TypeSpec.Http;
        @service(#{ title: "Users API" })
        namespace UsersApi;
        @route("/users")
        op listUsers(): string[];
      `),
    ).toBe('openapi-http')
  })

  it('parses standard .tsp sketch with @intent, @derivedFrom, model B is A, ## @evidence, and depth >= 2.5', () => {
    const ir = parseTypeSpecSketch(DEEP_SKETCH_TSP, 'file-lease')

    expect(ir.schemaVersion).toBe(INTERFACE_SKETCH_IR_VERSION)
    expect(ir.profile).toBe('interface-sketch')
    expect(ir.namespace).toBe('PstackMonitor.FileLease')
    expect(ir.models).toHaveLength(2)
    expect(ir.derivedLineage).toEqual([
      {
        derivedSymbol: 'WriterLeaseContract',
        baseSymbol: 'BaseLeaseContract',
        reason: 'Separate writer exclusive lock from read-only observer lease',
        usesModelIsSyntax: true,
      },
    ])
    expect(ir.depthMetrics.isDeep).toBe(true)
    expect(ir.depthMetrics.interfaceDepth).toBeGreaterThanOrEqual(2.5)
    expect(ir.redFlags).toHaveLength(0)
  })

  it('flags shallow-module, temporal-decomposition, and pass-through-method red flags and compares Arena candidates', () => {
    const comparison = compareSketchCandidates([
      { name: 'candidate-a-shallow', source: SHALLOW_SKETCH_TSP },
      { name: 'candidate-b-deep', source: DEEP_SKETCH_TSP },
    ])

    expect(comparison.recommendedWinner).toBe('candidate-b-deep')
    const shallowScore = comparison.candidates.find(c => c.name === 'candidate-a-shallow')
    expect(shallowScore?.isDeep).toBe(false)
    expect(shallowScore?.redFlagCount).toBeGreaterThanOrEqual(3)
  })
})
