import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  lint,
  parseLintCategories,
  isLintCategory,
  ALLOWED_LINT_CATEGORIES,
} from '../../src/cli/commands/lint.js'
import { CliExitError } from '../../src/cli/lib/errors.js'

describe('CLI lint --categories unit & integration tests', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-cli-lint-'))
    tempDirs.push(dir)
    return dir
  }

  describe('Category parsing and validation', () => {
    it('returns undefined when categories option is not provided', () => {
      expect(parseLintCategories(undefined)).toBeUndefined()
    })

    it('parses single category', () => {
      expect(parseLintCategories('surface')).toEqual(['surface'])
    })

    it('parses multiple comma-separated categories with whitespace', () => {
      expect(parseLintCategories('surface, structure, operations')).toEqual([
        'surface',
        'structure',
        'operations',
      ])
    })

    it('parses array of category strings', () => {
      expect(parseLintCategories(['surface', 'operations, parameters'])).toEqual([
        'surface',
        'operations',
        'parameters',
      ])
    })

    it('validates each allowed category correctly', () => {
      for (const cat of ALLOWED_LINT_CATEGORIES) {
        expect(isLintCategory(cat)).toBe(true)
        expect(parseLintCategories(cat)).toEqual([cat])
      }
      expect(isLintCategory('not-a-category')).toBe(false)
    })

    it('throws error when empty or whitespace string is provided', () => {
      expect(() => parseLintCategories('')).toThrow(/하나 이상의 유효한 카테고리를 지정해야 합니다/)
      expect(() => parseLintCategories('   ')).toThrow(/하나 이상의 유효한 카테고리를 지정해야 합니다/)
    })

    it('throws error when unknown category is provided', () => {
      expect(() => parseLintCategories('surface, unknown-cat')).toThrow(
        /--categories 값은.*중 하나여야 합니다: unknown-cat/,
      )
    })
  })

  describe('CLI lint execution with category filtering', () => {
    it('executes only surface lint rules when --categories surface is passed', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      // Document has missing info.title (structure error),
      // but valid surface extensions (or no surface violations)
      const specDoc = {
        openapi: '3.1.0',
        info: {
          version: '1.0.0',
          // title is intentionally missing -> would fail structure lint
        },
        paths: {
          '/items': {
            get: {
              operationId: 'getItems',
              responses: {
                '200': {
                  description: 'ok',
                },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      // Without category filtering, linting fails due to missing info.title
      await expect(lint.run({ spec: specFile })).rejects.toThrow(CliExitError)

      // With --categories surface, structure rules are skipped and surface rules pass
      await expect(
        lint.run({
          spec: specFile,
          categories: 'surface',
        }),
      ).resolves.toBeUndefined()
    })

    it('executes structure rules when --categories structure is specified', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          version: '1.0.0',
          // title is missing -> structure error
        },
        paths: {},
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      // Structure category fails
      await expect(
        lint.run({
          spec: specFile,
          categories: 'structure',
        }),
      ).rejects.toThrow(CliExitError)
    })

    it('executes operations category rules', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      // Document has valid structure and info, but duplicate operationId (operations error)
      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        paths: {
          '/items': {
            get: {
              operationId: 'getItems',
              responses: { '200': { description: 'ok' } },
            },
            post: {
              operationId: 'getItems', // Duplicate operationId -> operations error
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      // Running operations category fails due to duplicate operationId error
      await expect(
        lint.run({
          spec: specFile,
          categories: 'operations',
        }),
      ).rejects.toThrow(CliExitError)

      // Running structure category passes because structure is valid
      await expect(
        lint.run({
          spec: specFile,
          categories: 'structure',
        }),
      ).resolves.toBeUndefined()
    })

    it('supports multiple categories combined', async () => {
      const tempDir = await createTempDir()
      const specFile = path.join(tempDir, 'spec.json')

      const specDoc = {
        openapi: '3.1.0',
        info: {
          title: 'Combined API',
          version: '1.0.0',
        },
        paths: {
          '/items': {
            get: {
              operationId: 'getItems',
              responses: {
                '200': {
                  description: 'ok',
                },
              },
            },
          },
        },
      }

      await fs.writeFile(specFile, JSON.stringify(specDoc, null, 2), 'utf8')

      await expect(
        lint.run({
          spec: specFile,
          categories: 'structure, operations, surface',
        }),
      ).resolves.toBeUndefined()
    })
  })
})
