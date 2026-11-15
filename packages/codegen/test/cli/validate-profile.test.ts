import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { validate } from '../../src/cli/commands/validate.js'
import { CliExitError } from '../../src/cli/lib/errors.js'

describe('CLI validate --profile unit & integration tests', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-cli-validate-'))
    tempDirs.push(dir)
    return dir
  }

  describe('Profile option validation', () => {
    it('throws when invalid profile name is provided', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')
      await fs.writeFile(
        specFile,
        JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }),
        'utf8',
      )

      await expect(
        validate.run({
          spec: specFile,
          profile: 'non-existent-profile',
        }),
      ).rejects.toThrow(/--profile 값은 component-bundle \| operation-contract \| full-api-document 중 하나여야 합니다/)
    })
  })

  describe('operation-contract profile validation', () => {
    it('fails when paths has no operations', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      // Empty paths object
      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Operation Contract Test',
          version: '1.0.0',
        },
        paths: {},
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
          profile: 'operation-contract',
        }),
      ).rejects.toThrow(CliExitError)
    })

    it('passes when paths contains at least one valid operation', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Operation Contract Test',
          version: '1.0.0',
        },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              summary: 'Get users',
              responses: {
                '200': {
                  description: 'List of users',
                },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
          profile: 'operation-contract',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('component-bundle profile validation', () => {
    it('passes when paths is empty but components.schemas has schemas', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Schema Bundle',
          version: '1.0.0',
        },
        paths: {},
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
          profile: 'component-bundle',
        }),
      ).resolves.toBeUndefined()
    })

    it('fails when components.schemas is missing or empty', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Invalid Bundle',
          version: '1.0.0',
        },
        paths: {},
        components: {
          schemas: {},
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
          profile: 'component-bundle',
        }),
      ).rejects.toThrow(CliExitError)
    })
  })

  describe('full-api-document profile validation', () => {
    it('passes for complete OpenAPI document', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Full API Document',
          version: '1.0.0',
        },
        paths: {
          '/health': {
            get: {
              operationId: 'getHealth',
              summary: 'Health check',
              responses: {
                '200': {
                  description: 'healthy',
                },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
          profile: 'full-api-document',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('Default validation without profile', () => {
    it('runs normally when no profile option is specified', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Normal API',
          version: '1.0.0',
        },
        paths: {
          '/ping': {
            get: {
              operationId: 'ping',
              summary: 'ping',
              responses: {
                '200': {
                  description: 'pong',
                },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        validate.run({
          spec: specFile,
        }),
      ).resolves.toBeUndefined()
    })
  })
})
