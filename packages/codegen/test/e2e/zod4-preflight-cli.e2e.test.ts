import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { runCommand } from '../../src/cli/lib/run.js'
import { generateZod } from '../../src/cli/commands/generate-zod.js'

describe('CLI E2E & Adversarial: oa-gen generate:zod Preflight Validation & Normalization', () => {
  const createTempDir = () => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'oa-zod-preflight-e2e-'))
  }

  const validYaml = `
openapi: 3.2.0
info:
  title: Petstore Valid
  version: 1.0.0
paths: {}
components:
  schemas:
    Pet:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        tag:
          type: string
`

  const brokenRefYaml = `
openapi: 3.2.0
info:
  title: Broken Ref API
  version: 1.0.0
paths: {}
components:
  schemas:
    Order:
      type: object
      properties:
        item:
          $ref: '#/components/schemas/NonExistentItem'
`

  const missingStructureYaml = `
info:
  title: Missing OpenAPI Version API
  version: 1.0.0
paths: {}
components:
  schemas:
    Widget:
      type: string
`

  const noisyAnchorYaml = `
openapi: 3.2.0
info:
  title: Anchored API
  version: 1.0.0
  contact: {}
servers: []
tags: []
paths: {}
components:
  schemas:
    BaseConfig: &base_cfg
      type: object
      properties:
        timeout:
          type: integer
    AppConfig:
      <<: *base_cfg
      type: object
      properties:
        timeout:
          type: integer
        name:
          type: string
`

  it('succeeds cleanly on valid specification without extraneous noise', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'valid.yaml')
    const outFile = path.join(tempDir, 'valid-schemas.ts')
    fs.writeFileSync(specFile, validYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const PetSchema = z.object({')
    expect(stderrOutput).toBe('')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('fails with exit code 1 and outputs structured lint diagnostics on broken $ref', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'broken-ref.yaml')
    const outFile = path.join(tempDir, 'broken-schemas.ts')
    fs.writeFileSync(specFile, brokenRefYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(1)
    expect(stderrOutput).toContain('Preflight validation failed')
    expect(stderrOutput).toContain('refs/valid-ref')
    expect(stderrOutput).toContain('#/components/schemas/NonExistentItem')
    // Output file must not have been created (fail-fast)
    expect(fs.existsSync(outFile)).toBe(false)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('fails with exit code 1 when specification structure is missing (no openapi field)', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'missing-structure.yaml')
    const outFile = path.join(tempDir, 'out.ts')
    fs.writeFileSync(specFile, missingStructureYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(1)
    expect(stderrOutput).toContain('structure/openapi-version')
    expect(fs.existsSync(outFile)).toBe(false)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('emits warnings but generates code with exit code 0 when --force is passed on broken spec', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'broken-ref.yaml')
    const outFile = path.join(tempDir, 'forced-schemas.ts')
    fs.writeFileSync(specFile, brokenRefYaml, 'utf8')

    const origWarn = console.warn
    let warnOutput = ''
    console.warn = (msg: string) => {
      warnOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--force'])
    } finally {
      console.warn = origWarn
    }

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const OrderSchema = z.object({')
    expect(emitted).toContain('item: z.lazy(() => NonExistentItemSchema).optional()')
    expect(warnOutput).toContain('--force enabled, proceeding best-effort')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('skips validation completely and emits code with exit code 0 when --no-validate is passed', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'broken-ref.yaml')
    const outFile = path.join(tempDir, 'no-validate-schemas.ts')
    fs.writeFileSync(specFile, brokenRefYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--no-validate'])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const OrderSchema = z.object({')
    expect(stderrOutput).toBe('')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('supports explicit --validate flag and runs preflight checks', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'valid.yaml')
    const outFile = path.join(tempDir, 'explicit-validate.ts')
    fs.writeFileSync(specFile, validYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--validate'])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('supports explicit --lint flag and runs preflight checks', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'valid.yaml')
    const outFile = path.join(tempDir, 'explicit-lint.ts')
    fs.writeFileSync(specFile, validYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--lint'])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('supports --no-normalize to bypass normalization pipeline', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'valid.yaml')
    const outFile = path.join(tempDir, 'no-normalize.ts')
    fs.writeFileSync(specFile, validYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--no-normalize'])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const PetSchema = z.object({')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('handles adversarial YAML anchor noise cleanly with automatic normalization', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'anchors.yaml')
    const outFile = path.join(tempDir, 'anchors.ts')
    fs.writeFileSync(specFile, noisyAnchorYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const AppConfigSchema = z.object({')
    expect(emitted).toContain('export const BaseConfigSchema = z.object({')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('supports category filtering via --categories flag to isolate validation scope', async () => {
    const tempDir = createTempDir()
    // Spec with structure issue (missing title) but valid surface
    const specFile = path.join(tempDir, 'surface-only.yaml')
    const outFile = path.join(tempDir, 'surface-only.ts')
    const noTitleYaml = `
openapi: 3.2.0
info:
  version: 1.0.0
paths: {}
components:
  schemas:
    Simple:
      type: string
`
    fs.writeFileSync(specFile, noTitleYaml, 'utf8')

    process.exitCode = 0
    // If we only run surface category, structure errors won't block generation
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--categories', 'surface'])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('enforces validation when --lint is explicitly provided even if --no-validate is passed', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'broken-ref.yaml')
    const outFile = path.join(tempDir, 'out.ts')
    fs.writeFileSync(specFile, brokenRefYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--no-validate', '--lint'])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(1)
    expect(stderrOutput).toContain('Preflight validation failed')
    expect(stderrOutput).toContain('refs/valid-ref')
    expect(fs.existsSync(outFile)).toBe(false)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('successfully generates code for specifications containing OAS 3.1/3.2 boolean schemas', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'boolean-schemas.yaml')
    const outFile = path.join(tempDir, 'boolean-out.ts')
    const booleanYaml = `
openapi: 3.2.0
info:
  title: Boolean Schema API
  version: 1.0.0
paths: {}
components:
  schemas:
    Allowed: true
    Blocked: false
`
    fs.writeFileSync(specFile, booleanYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const AllowedSchema = z.unknown()')
    expect(emitted).toContain('export const BlockedSchema = z.never()')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('warns and emits code with exit code 0 when both --validate and --force are passed on broken spec', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'broken-ref.yaml')
    const outFile = path.join(tempDir, 'validated-forced.ts')
    fs.writeFileSync(specFile, brokenRefYaml, 'utf8')

    const origWarn = console.warn
    let warnOutput = ''
    console.warn = (msg: string) => {
      warnOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--validate', '--force'])
    } finally {
      console.warn = origWarn
    }

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const OrderSchema = z.object({')
    expect(warnOutput).toContain('--force enabled, proceeding best-effort')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('fails with exit code 1 on circular YAML anchor loop with actionable diagnostics', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'cyclic-anchor.yaml')
    const outFile = path.join(tempDir, 'out.ts')
    const cyclicAnchorYaml = `
openapi: 3.2.0
info:
  title: Circular Anchor API
  version: 1.0.0
paths: {}
components:
  schemas:
    Node: &node_anchor
      type: object
      properties:
        value:
          type: string
        child: *node_anchor
`
    fs.writeFileSync(specFile, cyclicAnchorYaml, 'utf8')

    const origStderr = console.error
    let stderrOutput = ''
    console.error = (msg: string) => {
      stderrOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    } finally {
      console.error = origStderr
    }

    expect(process.exitCode).toBe(1)
    expect(stderrOutput).toContain('structure/circular-anchor')
    expect(stderrOutput).toContain('YAML anchor cycle')
    expect(fs.existsSync(outFile)).toBe(false)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('proceeds with exit code 0 when --force is used on circular YAML anchor loop', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'cyclic-anchor-force.yaml')
    const outFile = path.join(tempDir, 'out.ts')
    const cyclicAnchorYaml = `
openapi: 3.2.0
info:
  title: Circular Anchor API
  version: 1.0.0
paths: {}
components:
  schemas:
    Node: &node_anchor
      type: object
      properties:
        value:
          type: string
        child: *node_anchor
`
    fs.writeFileSync(specFile, cyclicAnchorYaml, 'utf8')

    const origWarn = console.warn
    let warnOutput = ''
    console.warn = (msg: string) => {
      warnOutput += msg + '\n'
    }

    process.exitCode = 0
    try {
      await runCommand(generateZod, ['--spec', specFile, '--output', outFile, '--force'])
    } finally {
      console.warn = origWarn
    }

    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const NodeSchema: z.ZodTypeAny = z.object({')
    expect(emitted).toContain('child: z.lazy(() => NodeSchema).optional()')
    expect(warnOutput).toContain('--force enabled, proceeding best-effort')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('generates code cleanly for specs with special character schema names and RFC 6901 refs via CLI', async () => {
    const tempDir = createTempDir()
    const specFile = path.join(tempDir, 'special-chars.yaml')
    const outFile = path.join(tempDir, 'out.ts')
    const specialYaml = `
openapi: 3.2.0
info:
  title: Special Chars API
  version: 1.0.0
paths: {}
components:
  schemas:
    user/profile:
      type: object
      properties:
        name:
          type: string
    Account:
      type: object
      properties:
        owner:
          $ref: '#/components/schemas/user~1profile'
`
    fs.writeFileSync(specFile, specialYaml, 'utf8')

    process.exitCode = 0
    await runCommand(generateZod, ['--spec', specFile, '--output', outFile])
    expect(process.exitCode).toBe(0)
    expect(fs.existsSync(outFile)).toBe(true)
    const emitted = fs.readFileSync(outFile, 'utf8')
    expect(emitted).toContain('export const UserProfileSchema = z.object({')
    expect(emitted).toContain('export const AccountSchema = z.object({')
    expect(emitted).toContain('owner: z.lazy(() => UserProfileSchema).optional()')

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
