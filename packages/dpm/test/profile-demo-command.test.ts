import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  profileDemoCommandTimeoutMs,
  profileDemoPackageRoot,
} from './support/profile-demo-path-fixtures.js'

describe('DPM Kafka profile demo command', () => {
  it('runs the documented Kafka profile demo command', () => {
    const result = spawnSync('corepack', ['pnpm', 'run', 'demo:profile'], {
      cwd: profileDemoPackageRoot,
      encoding: 'utf8',
      timeout: profileDemoCommandTimeoutMs,
    })
    const marker = '{\n  "demo": "dpm.profile-kafka"'
    const outputStart = result.stdout.indexOf(marker)
    const output = outputStart >= 0 ? JSON.parse(result.stdout.slice(outputStart)) : undefined

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(output?.steps.every((step: Record<string, unknown>) => step.status === 'pass')).toBe(true)
    expect(output?.steps.map((step: { name: string }) => step.name)).toEqual([
      'flatten Kafka topic fixture into profile artifact',
      'inspect profile artifact for editor runtime',
      'analyze profile artifact into review signals',
      'review relationship hint proposal without registry mutation',
      'reject mismatched proposal review target',
      'preserve inspection snapshot after caller mutation',
    ])
  }, profileDemoCommandTimeoutMs + 5_000)
})
