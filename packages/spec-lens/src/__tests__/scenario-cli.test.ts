import { describe, expect, it } from 'vitest'
import { runScenarioCli, verifyAllScenarios } from '../scenario-cli.js'
import { ScenarioRegistry } from '@oa-sdk/spec-lens-contract'

describe('spec-lens scenario CLI', () => {
  it('lists registered scenarios', async () => {
    const logs: string[] = []
    const handled = await runScenarioCli(['list'], {
      stdout: (msg) => logs.push(msg),
    })

    expect(handled).toBe(true)
    const combined = logs.join('\n')
    expect(combined).toContain('Registered User Scenarios')
    expect(combined).toContain('spec-drift-triage')
    expect(combined).toContain('endpoint-exploration')
    expect(combined).toContain('breaking-impact-analysis')
    expect(combined).toContain('circular-ref-diagnostic')
  })

  it('inspects a specific scenario and prints transition matrix', async () => {
    const logs: string[] = []
    const handled = await runScenarioCli(['inspect', 'spec-drift-triage'], {
      stdout: (msg) => logs.push(msg),
    })

    expect(handled).toBe(true)
    const combined = logs.join('\n')
    expect(combined).toContain('스펙 드리프트 감지 및 원인 규명')
    expect(combined).toContain('Transition Matrix')
    expect(combined).toContain('REQUEST_DIFF')
    expect(combined).toContain('INSPECT_ENDPOINT_PROVENANCE')
  })

  it('handles unknown scenario in inspect with error', async () => {
    const errors: string[] = []
    let exitCode: number | null = null
    const handled = await runScenarioCli(['inspect', 'non-existent-scenario'], {
      stderr: (msg) => errors.push(msg),
      exit: (code) => {
        exitCode = code
      },
    })

    expect(handled).toBe(true)
    expect(exitCode).toBe(1)
    expect(errors.join('\n')).toContain('not found in registry')
  })

  it('renders ascii/ansi preview of scenario flow', async () => {
    const logs: string[] = []
    const handled = await runScenarioCli(['preview', 'endpoint-exploration'], {
      stdout: (msg) => logs.push(msg),
    })

    expect(handled).toBe(true)
    const combined = logs.join('\n')
    expect(combined).toContain('Terminal Flow Preview')
    expect(combined).toContain('START')
    expect(combined).toContain('GOAL REACHED')
  })

  it('verifies all scenarios with zero dead-ends', async () => {
    const logs: string[] = []
    const registry = new ScenarioRegistry()
    const valid = verifyAllScenarios(registry, (msg) => logs.push(msg), (msg) => logs.push(msg))

    expect(valid).toBe(true)
    const combined = logs.join('\n')
    expect(combined).toContain('Verification PASSED')
  })

  it('exports flowcharts in various formats (mermaid, dot, json, markdown)', async () => {
    const mermaidLogs: string[] = []
    await runScenarioCli(['export', '--format', 'mermaid', '--id', 'breaking-impact-analysis'], {
      stdout: (msg) => mermaidLogs.push(msg),
    })
    expect(mermaidLogs.join('\n')).toContain('stateDiagram-v2')

    const dotLogs: string[] = []
    await runScenarioCli(['export', '--format', 'dot', '--id', 'circular-ref-diagnostic'], {
      stdout: (msg) => dotLogs.push(msg),
    })
    expect(dotLogs.join('\n')).toContain('digraph "circular-ref-diagnostic"')

    const jsonLogs: string[] = []
    await runScenarioCli(['export', '--format', 'json', '--id', 'spec-drift-triage'], {
      stdout: (msg) => jsonLogs.push(msg),
    })
    const parsed = JSON.parse(jsonLogs.join('\n'))
    expect(parsed[0].scenarioId).toBe('spec-drift-triage')
    expect(parsed[0].deadEnds).toEqual([])
  })
})
