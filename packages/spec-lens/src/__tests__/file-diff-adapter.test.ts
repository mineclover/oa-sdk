import { describe, expect, it } from 'vitest'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GetFileEntriesOptions } from '../application/ports/spec-source.port.js'
import { FileDiffAdapter } from '../infrastructure/source-adapters/file/file-diff.adapter.js'

const TYPESPEC_READ_BUDGET = resolveSpecLensTypeSpecSourceReadBudget()

describe('FileDiffAdapter TypeSpec source reads', () => {
  it('requires the canonical read budget before touching the filesystem', async () => {
    const adapter = new FileDiffAdapter({
      basePath: '/path/that/does/not/exist/base',
      headPath: '/path/that/does/not/exist/head',
    })
    const [revision] = await adapter.listRevisions({})

    await expect(adapter.getFileEntries({
      revision: revision!,
      sourceKind: 'typespec-bundle',
    } as unknown as GetFileEntriesOptions)).rejects.toThrow(
      'TypeSpec source reads require an explicit readBudget',
    )
  })

  it.each([
    {
      constraint: 'file count',
      populate(headPath: string) {
        for (let index = 0; index < TYPESPEC_READ_BUDGET.maxFiles + 2; index += 1) {
          writeFileSync(join(headPath, `source-${String(index).padStart(3, '0')}.tsp`), '')
        }
      },
      expectedError: `file count ${TYPESPEC_READ_BUDGET.maxFiles + 1} exceeds limit`,
    },
    {
      constraint: 'per-file bytes',
      populate(headPath: string) {
        const oversized = join(headPath, 'oversized.tsp')
        writeFileSync(oversized, '')
        truncateSync(oversized, TYPESPEC_READ_BUDGET.maxFileBytes + 1)
      },
      expectedError: `exceeds ${TYPESPEC_READ_BUDGET.maxFileBytes} bytes`,
    },
    {
      constraint: 'aggregate bytes',
      populate(headPath: string) {
        const fileCount = Math.floor(
          TYPESPEC_READ_BUDGET.maxTotalBytes / TYPESPEC_READ_BUDGET.maxFileBytes,
        ) + 1
        for (let index = 0; index < fileCount; index += 1) {
          const source = join(headPath, `aggregate-${index}.tsp`)
          writeFileSync(source, '')
          truncateSync(source, TYPESPEC_READ_BUDGET.maxFileBytes)
        }
      },
      expectedError: `aggregate bytes exceed limit ${TYPESPEC_READ_BUDGET.maxTotalBytes}`,
    },
  ])('prevalidates TypeSpec $constraint before reading file contents', async ({ populate, expectedError }) => {
    const fixture = createFixture()
    try {
      populate(fixture.headPath)
      const [headRevision] = await fixture.adapter.listRevisions({})

      await expect(fixture.adapter.getFileEntries({
        revision: headRevision!,
        sourceKind: 'typespec-bundle',
        readBudget: TYPESPEC_READ_BUDGET,
      })).rejects.toThrow(expectedError)
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects the whole TypeSpec revision when a symlink escapes the configured root', async () => {
    const fixture = createFixture()
    try {
      const outsideSource = join(fixture.rootPath, 'outside.tsp')
      writeFileSync(outsideSource, 'namespace Escaped;\n')
      writeFileSync(join(fixture.headPath, 'main.tsp'), 'namespace Safe;\n')
      symlinkSync(outsideSource, join(fixture.headPath, 'escaped.tsp'))
      const [headRevision] = await fixture.adapter.listRevisions({})

      await expect(fixture.adapter.getFileEntries({
        revision: headRevision!,
        sourceKind: 'typespec-bundle',
        readBudget: TYPESPEC_READ_BUDGET,
      })).rejects.toThrow('TypeSpec source path escapes configured root')
    } finally {
      fixture.cleanup()
    }
  })

  it('reads all valid TypeSpec candidates only after traversal succeeds', async () => {
    const fixture = createFixture()
    try {
      mkdirSync(join(fixture.headPath, 'models'))
      writeFileSync(join(fixture.headPath, 'main.tsp'), 'namespace Example;\n')
      writeFileSync(join(fixture.headPath, 'models', 'widget.tsp'), 'model Widget {}\n')
      writeFileSync(join(fixture.headPath, 'ignored.md'), 'not a TypeSpec input\n')
      const [headRevision] = await fixture.adapter.listRevisions({})

      const entries = await fixture.adapter.getFileEntries({
        revision: headRevision!,
        sourceKind: 'typespec-bundle',
        readBudget: TYPESPEC_READ_BUDGET,
      })

      expect(entries.map(entry => entry.relativePath)).toEqual([
        'main.tsp',
        join('models', 'widget.tsp'),
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('marks an evidence-only directory unreadable', async () => {
    const fixture = createFixture()
    try {
      mkdirSync(join(fixture.headPath, 'toolchain'))
      const [headRevision] = await fixture.adapter.listRevisions({})
      await expect(fixture.adapter.getObservationInputEvidence({
        revision: headRevision!,
        inputs: [{ path: 'toolchain', class: 'evidence-only' }],
      })).resolves.toEqual([{
        path: 'toolchain', class: 'evidence-only', availability: 'unreadable', reason: 'evidence input is not a file',
      }])
    } finally {
      fixture.cleanup()
    }
  })
})

function createFixture() {
  const rootPath = mkdtempSync(join(tmpdir(), 'spec-lens-file-diff-budget-'))
  const basePath = join(rootPath, 'base')
  const headPath = join(rootPath, 'head')
  mkdirSync(basePath)
  mkdirSync(headPath)
  return {
    rootPath,
    basePath,
    headPath,
    adapter: new FileDiffAdapter({ basePath, headPath }),
    cleanup() {
      rmSync(rootPath, { recursive: true, force: true })
    },
  }
}
