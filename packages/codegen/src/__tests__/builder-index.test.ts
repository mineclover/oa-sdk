import { describe, expect, it } from 'vitest'
import {
  createDefinitionNode,
  createDefinitionRegistry,
  selectDefinitionTarget,
  type DefinitionNode,
  type DefinitionTargetConfig,
} from '@oa-sdk/parser'
import {
  BUILDER_FRAGMENT_COMPONENT_SECTION,
  BUILDER_TARGET_COMPONENT_SECTION,
  detectBuilderDirtyTargets,
  recordBuilderWorkspaceIndex,
} from '../builder-index.js'
import { createMemoryWorkspaceIndex, createNoopWorkspaceIndex, type WorkspaceFileRecord } from '../workspace-index.js'

type BuilderFixtureFiles = {
  publicTarget: WorkspaceFileRecord
  adminTarget: WorkspaceFileRecord
  publicPath: WorkspaceFileRecord
  adminPath: WorkspaceFileRecord
  publicSchema: WorkspaceFileRecord
  adminSchema: WorkspaceFileRecord
}

describe('builder WorkspaceIndex metadata', () => {
  it('stores fragment ids, fragment refs, target roots, and file hashes', () => {
    const { files, nodes, publicTargetPath, publicTarget } = builderFixture()
    const registry = createDefinitionRegistry(nodes)
    const selection = selectDefinitionTarget(registry, publicTarget)
    const index = createMemoryWorkspaceIndex()

    recordBuilderWorkspaceIndex({
      index,
      files: [
        files.publicTarget,
        files.publicPath,
        files.publicSchema,
        files.adminPath,
        files.adminSchema,
      ],
      targetPath: publicTargetPath,
      target: publicTarget,
      registry,
      selection,
    })

    expect(index.getFile(files.publicSchema.filePath)?.contentHash).toBe('schema-public-v1')
    expect(index.listComponents({ section: BUILDER_FRAGMENT_COMPONENT_SECTION }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          filePath: files.publicSchema.filePath,
          name: 'schema:public/book/Book',
          pointer: '#/content',
          contentHash: 'schema-public-content-v1',
        }),
      ]))
    expect(index.listComponents({ section: BUILDER_TARGET_COMPONENT_SECTION }))
      .toEqual([expect.objectContaining({
        filePath: publicTargetPath,
        name: 'public-api',
        contentHash: 'target-public-v1',
      })])
    expect(index.listRefs({ fromFile: files.publicPath.filePath, toFile: files.publicSchema.filePath }))
      .toHaveLength(1)
    expect(index.listRefs({ fromFile: publicTargetPath, toFile: files.publicPath.filePath }))
      .toHaveLength(1)
  })

  it('marks a target dirty when a transitively included schema fragment changes', () => {
    const fixture = builderFixture()
    const registry = createDefinitionRegistry(fixture.nodes)
    const publicSelection = selectDefinitionTarget(registry, fixture.publicTarget)
    const adminSelection = selectDefinitionTarget(registry, fixture.adminTarget)
    const index = createMemoryWorkspaceIndex()

    recordBuilderWorkspaceIndex({
      index,
      files: [
        fixture.files.publicTarget,
        fixture.files.publicPath,
        fixture.files.adminPath,
        fixture.files.publicSchema,
        fixture.files.adminSchema,
      ],
      targetPath: fixture.publicTargetPath,
      target: fixture.publicTarget,
      registry,
      selection: publicSelection,
    })
    recordBuilderWorkspaceIndex({
      index,
      files: [
        fixture.files.adminTarget,
        fixture.files.publicPath,
        fixture.files.adminPath,
        fixture.files.publicSchema,
        fixture.files.adminSchema,
      ],
      targetPath: fixture.adminTargetPath,
      target: fixture.adminTarget,
      registry,
      selection: adminSelection,
    })

    const changedPublicSchema = changedFile(fixture.files.publicSchema, 'schema-public-v2')
    const dirty = detectBuilderDirtyTargets(index, [
      fixture.files.publicTarget,
      fixture.files.adminTarget,
      fixture.files.publicPath,
      fixture.files.adminPath,
      changedPublicSchema,
      fixture.files.adminSchema,
    ], {
      targetPaths: [fixture.publicTargetPath, fixture.adminTargetPath],
    })

    expect(dirty.workspaceDirty.modified.map(file => file.filePath)).toEqual([fixture.files.publicSchema.filePath])
    expect(dirty.workspaceDirty.dependentFilePaths).toEqual([
      fixture.files.publicPath.filePath,
      fixture.publicTargetPath,
    ])
    expect(dirty.dirtyTargetPaths).toEqual([fixture.publicTargetPath])
    expect(dirty.dirtyTargetNames).toEqual(['public-api'])
    expect(dirty.dirtyFragmentPaths).toEqual([
      fixture.files.publicPath.filePath,
      fixture.files.publicSchema.filePath,
    ])
  })

  it('marks only the changed target when target config content changes', () => {
    const fixture = builderFixture()
    const registry = createDefinitionRegistry(fixture.nodes)
    const publicSelection = selectDefinitionTarget(registry, fixture.publicTarget)
    const adminSelection = selectDefinitionTarget(registry, fixture.adminTarget)
    const index = createMemoryWorkspaceIndex()

    recordBuilderWorkspaceIndex({
      index,
      files: [
        fixture.files.publicTarget,
        fixture.files.publicPath,
        fixture.files.adminPath,
        fixture.files.publicSchema,
        fixture.files.adminSchema,
      ],
      targetPath: fixture.publicTargetPath,
      target: fixture.publicTarget,
      registry,
      selection: publicSelection,
    })
    recordBuilderWorkspaceIndex({
      index,
      files: [
        fixture.files.adminTarget,
        fixture.files.publicPath,
        fixture.files.adminPath,
        fixture.files.publicSchema,
        fixture.files.adminSchema,
      ],
      targetPath: fixture.adminTargetPath,
      target: fixture.adminTarget,
      registry,
      selection: adminSelection,
    })

    const changedPublicTarget = changedFile(fixture.files.publicTarget, 'target-public-v2')
    const dirty = detectBuilderDirtyTargets(index, [
      changedPublicTarget,
      fixture.files.adminTarget,
      fixture.files.publicPath,
      fixture.files.adminPath,
      fixture.files.publicSchema,
      fixture.files.adminSchema,
    ], {
      targetPaths: [fixture.publicTargetPath, fixture.adminTargetPath],
    })

    expect(dirty.workspaceDirty.modified.map(file => file.filePath)).toEqual([fixture.publicTargetPath])
    expect(dirty.workspaceDirty.dependentFilePaths).toEqual([])
    expect(dirty.dirtyTargetPaths).toEqual([fixture.publicTargetPath])
    expect(dirty.dirtyFragmentPaths).toEqual([])
  })

  it('keeps no-op fallback behavior by treating scanned targets as dirty', () => {
    const fixture = builderFixture()
    const index = createNoopWorkspaceIndex()

    const dirty = detectBuilderDirtyTargets(index, [
      fixture.files.publicTarget,
      fixture.files.adminTarget,
      fixture.files.publicPath,
      fixture.files.adminPath,
      fixture.files.publicSchema,
      fixture.files.adminSchema,
    ], {
      targetPaths: [fixture.publicTargetPath, fixture.adminTargetPath],
    })

    expect(dirty.workspaceDirty.changed.map(file => file.filePath).sort((a, b) => a.localeCompare(b))).toEqual([
      fixture.adminTargetPath,
      fixture.publicTargetPath,
      fixture.files.adminPath.filePath,
      fixture.files.publicPath.filePath,
      fixture.files.adminSchema.filePath,
      fixture.files.publicSchema.filePath,
    ].sort((a, b) => a.localeCompare(b)))
    expect(dirty.dirtyTargetPaths).toEqual([
      fixture.adminTargetPath,
      fixture.publicTargetPath,
    ])
  })
})

function builderFixture(): {
  publicTargetPath: string
  adminTargetPath: string
  publicTarget: DefinitionTargetConfig
  adminTarget: DefinitionTargetConfig
  nodes: DefinitionNode[]
  files: BuilderFixtureFiles
} {
  const publicTargetPath = '/workspace/targets/public-api.yaml'
  const adminTargetPath = '/workspace/targets/admin-api.yaml'
  const publicPathFile = '/workspace/fragments/path/public/book/BooksPath.yaml'
  const adminPathFile = '/workspace/fragments/path/admin/book/BooksPath.yaml'
  const publicSchemaFile = '/workspace/fragments/schema/public/book/Book.yaml'
  const adminSchemaFile = '/workspace/fragments/schema/admin/book/Book.yaml'

  return {
    publicTargetPath,
    adminTargetPath,
    publicTarget: targetConfig('public-api', ['public'], ['/books']),
    adminTarget: targetConfig('admin-api', ['admin'], ['/admin/books']),
    nodes: [
      createDefinitionNode({
        id: 'path:public/book/BooksPath',
        sourcePath: publicPathFile,
        sourcePointer: '#/content',
        contentHash: 'path-public-content-v1',
        metadata: { path: '/books' },
        content: pathContent('oa://schema/public/book/Book'),
      }),
      createDefinitionNode({
        id: 'schema:public/book/Book',
        sourcePath: publicSchemaFile,
        sourcePointer: '#/content',
        contentHash: 'schema-public-content-v1',
        content: schemaContent(),
      }),
      createDefinitionNode({
        id: 'path:admin/book/BooksPath',
        sourcePath: adminPathFile,
        sourcePointer: '#/content',
        contentHash: 'path-admin-content-v1',
        metadata: { path: '/admin/books' },
        content: pathContent('oa://schema/admin/book/Book'),
      }),
      createDefinitionNode({
        id: 'schema:admin/book/Book',
        sourcePath: adminSchemaFile,
        sourcePointer: '#/content',
        contentHash: 'schema-admin-content-v1',
        content: schemaContent(),
      }),
    ],
    files: {
      publicTarget: fileRecord(publicTargetPath, 'target-public-v1'),
      adminTarget: fileRecord(adminTargetPath, 'target-admin-v1'),
      publicPath: fileRecord(publicPathFile, 'path-public-v1'),
      adminPath: fileRecord(adminPathFile, 'path-admin-v1'),
      publicSchema: fileRecord(publicSchemaFile, 'schema-public-v1'),
      adminSchema: fileRecord(adminSchemaFile, 'schema-admin-v1'),
    },
  }
}

function targetConfig(name: string, scopes: string[], includePaths: string[]): DefinitionTargetConfig {
  return {
    name,
    scopes,
    domains: ['book'],
    servers: [{ url: `https://${name}.example.test` }],
    includePaths,
  }
}

function pathContent(ref: string): unknown {
  return {
    get: {
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
  }
}

function schemaContent(): unknown {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
  }
}

function fileRecord(filePath: string, contentHash: string): WorkspaceFileRecord {
  return {
    filePath,
    realPath: filePath,
    contentHash,
    size: 100,
    mtimeMs: 1,
    parserVersion: 'parser-a',
    lastSeenRun: 'run-a',
  }
}

function changedFile(file: WorkspaceFileRecord, contentHash: string): WorkspaceFileRecord {
  return {
    ...file,
    contentHash,
    size: file.size + 1,
    mtimeMs: file.mtimeMs + 1,
  }
}
