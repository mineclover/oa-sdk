import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createOpenApiGovernanceInterface,
  scaffoldOpenApiGovernance,
} from '../cli/lib/openapi-governance-scaffold.js'

const tmpBase = resolve(__dirname, '../../.tmp-openapi-governance-scaffold')
let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('openapi governance scaffold', () => {
  it('creates a standard interface for oa-sdk consumers', () => {
    const config = createOpenApiGovernanceInterface({
      service: 'nestjs-ref',
      profile: 'nestjs-swagger',
      sourceCommand: 'pnpm export:openapi',
      runtimeOpenApiUrl: 'http://localhost:3000/openapi.json',
    })

    expect(config).toMatchObject({
      schemaVersion: 'oa-gen.openapi-governance.v1',
      artifacts: {
        raw: 'contracts/openapi.raw.yaml',
        normalized: 'contracts/openapi.normalized.yaml',
        upgraded: 'contracts/openapi.upgraded.yaml',
        baseline: 'contracts/v1.openapi.yaml',
      },
      consumers: {
        governance: 'artifacts.normalized',
        inventory: 'artifacts.upgraded',
        validate: 'artifacts.upgraded',
      },
    })
  })

  it('writes config, executable script, and service docs', () => {
    const result = scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'nestjs-swagger',
      sourceCommand: 'pnpm export:openapi',
      runtimeOpenApiUrl: 'http://localhost:3000/openapi.json',
    })

    expect(result.files.map(file => file.replace(tmpDir, ''))).toEqual([
      '/openapi-governance.config.json',
      '/scripts/openapi-governance.sh',
      '/openapi-governance.md',
    ])
    expect(existsSync(join(tmpDir, 'contracts'))).toBe(true)
    expect(existsSync(join(tmpDir, 'src/generated'))).toBe(true)

    const config = JSON.parse(readFileSync(join(tmpDir, 'openapi-governance.config.json'), 'utf8')) as Record<string, unknown>
    expect(config.service).toBe('orders')
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    expect(script).toContain('validate-upgraded')
    expect(script).toContain('"${OA_GEN_CMD[@]}" collect')
    expect(readFileSync(join(tmpDir, 'openapi-governance.md'), 'utf8')).toContain('OpenAPI 3.2 analysis artifact')
  })
})
