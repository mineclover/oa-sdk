import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createOpenApiGovernanceInterface,
  fingerprintGovernanceConfig,
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
      schemaVersion: 'oa-gen.openapi-governance.v2',
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
      tooling: { oaGenCommand: 'oa-gen', installation: 'path-command' },
      automation: expect.objectContaining({
        artifactDirectory: '.oa-sdk/governance',
        typegen: { policy: 'verify-only' },
      }),
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
      '/.github/workflows/openapi-governance.yml',
    ])
    expect(existsSync(join(tmpDir, 'contracts'))).toBe(true)
    expect(existsSync(join(tmpDir, 'src/generated'))).toBe(true)

    const config = JSON.parse(readFileSync(join(tmpDir, 'openapi-governance.config.json'), 'utf8')) as Record<string, unknown>
    expect(config.service).toBe('orders')
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    expect(script).toContain('validate-upgraded')
    expect(script).toContain('oa_gen collect')
    expect(script).toContain('(cd "$APP_DIR" && "${OA_GEN_CMD[@]}" "$@")')
    expect(script).not.toContain('git -C "$APP_DIR" rev-parse --show-toplevel')
    expect(script).toContain('read -ra OA_GEN_CMD <<< "${OA_GEN:-oa-gen}"')
    expect(script).toContain('require_baseline()')
    expect(script).toContain("hint: run '$0 update-baseline'")
    expect(script).toContain('Override it per invocation by setting OA_GEN')
    expect(script).toContain('source_openapi runs the --source-command captured at scaffold time as')
    expect(script).toContain('review-bundle')
    expect(script).toContain('  ci)')
    expect(script).toContain('CI_REVIEW_BUNDLE')
    expect(script).toContain('generate_types()')
    expect(script).toContain('verify-only: generation must succeed')
    expect(script).toContain('--inventory')
    expect(script).toContain('shift || true')
    expect(script).toMatch(/drift --runtime-openapi-url[^\n]*"\$@"/)
    const doc = readFileSync(join(tmpDir, 'openapi-governance.md'), 'utf8')
    expect(doc).toContain('OpenAPI 3.2 analysis artifact')
    expect(doc).toContain('`all` runs the PR gate pipeline')
    expect(doc).toContain('install-manager-neutral template')
    const workflow = readFileSync(join(tmpDir, '.github/workflows/openapi-governance.yml'), 'utf8')
    expect(workflow).toContain("OA_GEN: 'oa-gen'")
    expect(workflow).toContain('actions/upload-artifact@v6')
    expect(workflow).toContain('bash scripts/openapi-governance.sh ci')
  })

  it('refuses to overwrite existing scaffold without --force', () => {
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'generic',
    })

    expect(() =>
      scaffoldOpenApiGovernance({
        rootDir: tmpDir,
        service: 'orders',
        profile: 'generic',
      }),
    ).toThrow(/refusing to overwrite/)
  })

  it('emits source_openapi guard when --source-command is omitted', () => {
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'generic',
    })
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    expect(script).toContain('test -f "$RAW" || { echo "missing raw OpenAPI artifact: $RAW"; exit 1; }')
  })

  it('renders an explicit service-owned CLI setup command into the CI template', () => {
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'generic',
      oaGenCommand: 'pnpm exec oa-gen',
      oaGenSetupCommand: 'pnpm install --frozen-lockfile',
    })
    const config = JSON.parse(readFileSync(join(tmpDir, 'openapi-governance.config.json'), 'utf8')) as {
      tooling: { oaGenCommand: string; setupCommand: string | null }
    }
    expect(config.tooling).toEqual({
      oaGenCommand: 'pnpm exec oa-gen',
      installation: 'path-command',
      setupCommand: 'pnpm install --frozen-lockfile',
    })
    const workflow = readFileSync(join(tmpDir, '.github/workflows/openapi-governance.yml'), 'utf8')
    expect(workflow).toContain('run: |\n          pnpm install --frozen-lockfile')
  })

  it('renders shell variables that follow consumers map exactly', () => {
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'nestjs-swagger',
      sourceCommand: 'pnpm export:openapi',
    })
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    // governance + review + typegen + driftManaged read normalized
    expect(script).toContain('check-artifact --head "${NORMALIZED}"')
    expect(script).toContain('review --base "$BASELINE" --head "${NORMALIZED}"')
    expect(script).toContain('typegen --spec "${NORMALIZED}"')
    expect(script).toContain('drift --runtime-openapi-url "$RUNTIME_OPENAPI_URL" --managed-openapi "${NORMALIZED}"')
    // inventory + validate read upgraded
    expect(script).toContain('inventory --spec "${UPGRADED}"')
    expect(script).toContain('validate --spec "${UPGRADED}"')
  })

  it('enforces a tracked, fresh generated artifact when commit-required is selected', () => {
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'generic',
      typegenPolicy: 'commit-required',
    })
    const config = JSON.parse(readFileSync(join(tmpDir, 'openapi-governance.config.json'), 'utf8')) as {
      automation: { typegen: { policy: string } }
    }
    expect(config.automation.typegen.policy).toBe('commit-required')
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    expect(script).toContain('git -C "$APP_DIR" ls-files --error-unmatch "src/generated/api-types.ts"')
    expect(script).toContain('generated type artifact is stale: src/generated/api-types.ts')
  })

  it('rejects unsupported type generation policies', () => {
    expect(() => createOpenApiGovernanceInterface({
      service: 'orders',
      profile: 'generic',
      typegenPolicy: 'invalid' as 'verify-only',
    })).toThrow(/invalid --typegen-policy/)
  })

  it('embeds a config fingerprint in the script header that matches helper output', () => {
    const config = createOpenApiGovernanceInterface({
      service: 'orders',
      profile: 'nestjs-swagger',
      sourceCommand: 'pnpm export:openapi',
      runtimeOpenApiUrl: 'http://localhost:3000/openapi.json',
    })
    scaffoldOpenApiGovernance({
      rootDir: tmpDir,
      service: 'orders',
      profile: 'nestjs-swagger',
      sourceCommand: 'pnpm export:openapi',
      runtimeOpenApiUrl: 'http://localhost:3000/openapi.json',
    })
    const expected = fingerprintGovernanceConfig(config)
    const script = readFileSync(join(tmpDir, 'scripts/openapi-governance.sh'), 'utf8')
    expect(script).toContain(`# config fingerprint: ${expected}`)
  })

  it('fingerprint changes when consumers/profile/artifacts diverge', () => {
    const a = createOpenApiGovernanceInterface({ service: 'a', profile: 'generic' })
    const b = createOpenApiGovernanceInterface({ service: 'a', profile: 'nestjs-swagger' })
    expect(fingerprintGovernanceConfig(a)).not.toBe(fingerprintGovernanceConfig(b))

    const c = createOpenApiGovernanceInterface({ service: 'a', profile: 'generic' })
    c.consumers.review = 'artifacts.upgraded'
    expect(fingerprintGovernanceConfig(a)).not.toBe(fingerprintGovernanceConfig(c))
  })

  it('rejects a non-http(s) runtime URL at scaffold time', () => {
    expect(() =>
      scaffoldOpenApiGovernance({
        rootDir: tmpDir,
        service: 'orders',
        profile: 'generic',
        runtimeOpenApiUrl: 'file:///etc/passwd',
      }),
    ).toThrow(/expected http: or https:/)
    expect(() =>
      scaffoldOpenApiGovernance({
        rootDir: tmpDir,
        service: 'orders',
        profile: 'generic',
        runtimeOpenApiUrl: 'not a url',
      }),
    ).toThrow(/invalid --runtime-openapi-url/)
  })
})
