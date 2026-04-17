import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify as stringifyYaml } from 'yaml'
import {
  detectBuilderDirtyTargets,
  scanBuilderWorkspaceFiles,
} from '../builder-index.js'
import { buildSpec } from '../cli/lib/build-spec.js'
import { createMemoryWorkspaceIndex } from '../workspace-index.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-builder-incremental-targets-'))
  writeFixtureWorkspace()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('definition builder incremental target invalidation', () => {
  it('invalidates every target that depends on a changed shared fragment, and leaves unrelated target builds clean', () => {
    const index = createMemoryWorkspaceIndex()
    const targetPaths = [
      file('targets/public-api.yaml'),
      file('targets/admin-api.yaml'),
      file('targets/internal-api.yaml'),
    ]
    const fragmentPaths = [
      file('fragments/path/public/UsersPath.yaml'),
      file('fragments/path/admin/UsersPath.yaml'),
      file('fragments/path/internal/HealthPath.yaml'),
      file('fragments/schema/shared/User.yaml'),
      file('fragments/schema/internal/HealthStatus.yaml'),
    ]

    for (const targetPath of targetPaths) {
      const result = buildSpec({
        targetPath,
        fragmentsDir: file('fragments'),
        outputPath: join(tmpDir, 'out', `${targetPath.split('/').at(-1)}`),
        workspaceIndex: index,
      })
      expect(result.valid).toBe(true)
    }

    writeYaml('fragments/schema/shared/User.yaml', {
      id: 'schema:shared/users/User',
      content: {
        type: 'object',
        required: ['id', 'email'],
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          displayName: { type: 'string' },
        },
      },
    })

    const dirty = detectBuilderDirtyTargets(
      index,
      scanBuilderWorkspaceFiles({ targetPaths, fragmentPaths }),
      { targetPaths },
    )

    expect(dirty.dirtyFragmentPaths).toEqual([
      file('fragments/path/admin/UsersPath.yaml'),
      file('fragments/path/public/UsersPath.yaml'),
      file('fragments/schema/shared/User.yaml'),
    ])
    expect(dirty.dirtyTargetNames).toEqual(['admin-api', 'public-api'])
    expect(dirty.dirtyTargetPaths).toEqual([
      file('targets/admin-api.yaml'),
      file('targets/public-api.yaml'),
    ])
    expect(dirty.dirtyTargetNames).not.toContain('internal-api')
  })
})

function writeFixtureWorkspace(): void {
  writeYaml('targets/public-api.yaml', {
    name: 'public-api',
    scopes: ['shared', 'public'],
    domains: ['users'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/users'],
  })
  writeYaml('targets/admin-api.yaml', {
    name: 'admin-api',
    scopes: ['shared', 'admin'],
    domains: ['users'],
    servers: [{ url: 'https://admin.example.test' }],
    includePaths: ['/admin/users'],
  })
  writeYaml('targets/internal-api.yaml', {
    name: 'internal-api',
    scopes: ['internal'],
    domains: ['health'],
    servers: [{ url: 'https://internal.example.test' }],
    includePaths: ['/internal/health'],
  })
  writeYaml('fragments/path/public/UsersPath.yaml', pathFragment(
    'path:public/users/UsersPath',
    '/users',
    'listUsers',
    'oa://schema/shared/users/User',
  ))
  writeYaml('fragments/path/admin/UsersPath.yaml', pathFragment(
    'path:admin/users/UsersPath',
    '/admin/users',
    'listAdminUsers',
    'oa://schema/shared/users/User',
  ))
  writeYaml('fragments/path/internal/HealthPath.yaml', pathFragment(
    'path:internal/health/HealthPath',
    '/internal/health',
    'getInternalHealth',
    'oa://schema/internal/health/HealthStatus',
  ))
  writeYaml('fragments/schema/shared/User.yaml', {
    id: 'schema:shared/users/User',
    content: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    },
  })
  writeYaml('fragments/schema/internal/HealthStatus.yaml', {
    id: 'schema:internal/health/HealthStatus',
    content: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
      },
    },
  })
}

function pathFragment(id: string, path: string, operationId: string, ref: string) {
  return {
    id,
    metadata: { path },
    content: {
      get: {
        operationId,
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: ref },
              },
            },
          },
        },
      },
    },
  }
}

function writeYaml(relativePath: string, value: unknown): void {
  const target = file(relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, stringifyYaml(value), 'utf8')
}

function file(relativePath: string): string {
  return join(tmpDir, relativePath)
}
