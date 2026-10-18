import { describe, expect, it } from 'vitest'
import {
  checkImplementationContract,
  validateDetachedEvidenceMarkdown,
} from '../src/index.js'

describe('Phase D/E Contract Canary & Scrap Trigger Detector (@oa-sdk/ast-sync · TODO-OA-04)', () => {
  it('passes clean implementation that satisfies contracted operations and models with 0 friction signals', () => {
    const report = checkImplementationContract({
      implementationSource: `
        export interface WriterLeaseContract {
          leaseId: string;
        }
        export function acquireWriterLease(request: WriterLeaseContract): string {
          return request.leaseId;
        }
      `,
      contractedOperations: ['acquireWriterLease'],
      contractedModels: ['WriterLeaseContract'],
    })

    expect(report.passed).toBe(true)
    expect(report.scrapRequired).toBe(false)
    expect(report.totalFrictionSignals).toBe(0)
    expect(report.recommendation).toBe('proceed')
  })

  it('triggers Phase E Scrap (scrapRequired = true) when >= 2 friction signals accumulate (IUD-06)', () => {
    const report = checkImplementationContract({
      implementationSource: `
        import threading
        # workaround for split lease state
        def acquire_writer_lease(request: Any) -> str:
          lock = threading.Lock()
          return "ok"
      `,
      contractedOperations: ['acquireWriterLease'],
      contractedModels: ['WriterLeaseContract'],
    })

    expect(report.passed).toBe(false)
    expect(report.scrapRequired).toBe(true)
    expect(report.escapeHatches).toHaveLength(1)
    expect(report.lockReflexes).toHaveLength(1)
    expect(report.workaroundMarkers).toHaveLength(1)
    expect(report.signatureDeviations).toHaveLength(1)
    expect(report.recommendation).toBe('scrap-and-redesign-tsp')
  })

  it('validates detached evidence markdown anchors with code-fence masking and 3-way anchor classification', () => {
    const md = [
      '# Lease Evidence Review {#lease-review-root}',
      '',
      '```markdown',
      '## Fake Heading Inside Code Block {#fake-anchor}',
      '```',
      '',
      '## 1. Atomic Lease Acquisition {#acquire-atomic}',
      '<a id="legacy-compat-anchor"></a>',
    ].join('\n')

    const report = validateDetachedEvidenceMarkdown(md, [
      '#lease-review-root',
      '#acquire-atomic',
      '#1-atomic-lease-acquisition',
    ])

    expect(report.valid).toBe(true)
    expect(report.missingAnchors).toEqual([])
    expect(report.discoveredAnchors).not.toContain('fake-anchor')
    expect(report.inlineHtmlAnchorWarnings).toHaveLength(1)
  })
})
