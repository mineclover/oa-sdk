import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { runCommand } from '../../src/cli/lib/run.js'
import { lint } from '../../src/cli/commands/lint.js'
import { validate } from '../../src/cli/commands/validate.js'

describe('CLI runCommand dispatch for lint --categories and validate --profile', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-cli-runner-'))
    tempDirs.push(dir)
    return dir
  }

  it('runs lint command via argv with --categories', async () => {
    const tempDir = await createTempDir()
    const specFile = path.join(tempDir, 'spec.json')

    const specDoc = {
      openapi: '3.1.0',
      info: {
        version: '1.0.0',
        // missing title -> structure error
      },
      paths: {},
    }

    await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

    // Test with --categories surface (ignores structure error)
    process.exitCode = 0
    await runCommand(lint, ['--spec', specFile, '--categories', 'surface'])
    expect(process.exitCode).toBe(0)

    // Test with --categories structure (fails due to structure error)
    process.exitCode = 0
    await runCommand(lint, ['--spec', specFile, '--categories', 'structure'])
    expect(process.exitCode).toBe(1)
  })

  it('runs validate command via argv with --profile', async () => {
    const tempDir = await createTempDir()
    const specFile = path.join(tempDir, 'spec.json')

    const specDoc = {
      openapi: '3.1.0',
      info: {
        title: 'API Spec',
        version: '1.0.0',
      },
      paths: {},
    }

    await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

    // operation-contract fails because paths has no operations
    process.exitCode = 0
    await runCommand(validate, ['--spec', specFile, '--profile', 'operation-contract'])
    expect(process.exitCode).toBe(1)

    // invalid profile name fails
    process.exitCode = 0
    await runCommand(validate, ['--spec', specFile, '--profile', 'invalid-profile'])
    expect(process.exitCode).toBe(1)
  })
})
