import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeTsconfigUniverse,
  computeTsconfigUniverseDigest,
  createEmptyTsconfigUniverse,
  parseJsonc,
  stripJsonComments,
  removeTrailingCommas,
  configurationClosure,
} from '../../infrastructure/cache/sqlite/cache-key.js'
import {
  buildSpecProjectKey,
  createSpecProjectIdentity,
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  type SpecProjectKeyInput,
  type SpecSnapshotStored,
} from '../../domain/index.js'
import { SqliteCache } from '../../infrastructure/cache/sqlite/sqlite-cache.js'

describe('JSONC Parser (zero external dependencies)', () => {
  it('strips single-line and multi-line block comments cleanly', () => {
    const jsonc = [
      '{',
      '  // This is a line comment',
      '  "compilerOptions": {',
      '    /* Multi-line',
      '       block comment */',
      '    "strict": true,',
      '    "target": "ES2022"',
      '  }',
      '}',
    ].join('\n')

    const stripped = stripJsonComments(jsonc)
    expect(stripped).not.toContain('// This is a line comment')
    expect(stripped).not.toContain('Multi-line')
    expect(stripped).not.toContain('block comment')

    const parsed = parseJsonc<{ compilerOptions: { strict: boolean; target: string } }>(jsonc)
    expect(parsed.compilerOptions.strict).toBe(true)
    expect(parsed.compilerOptions.target).toBe('ES2022')
  })

  it('removes trailing commas in objects and arrays', () => {
    const jsonc = [
      '{',
      '  "compilerOptions": {',
      '    "strict": true,',
      '    "lib": ["ES2022", "DOM",],',
      '  },',
      '  "files": [',
      '    "src/index.ts",',
      '  ],',
      '}',
    ].join('\n')

    const parsed = parseJsonc<{
      compilerOptions: { strict: boolean; lib: string[] }
      files: string[]
    }>(jsonc)

    expect(parsed.compilerOptions.strict).toBe(true)
    expect(parsed.compilerOptions.lib).toEqual(['ES2022', 'DOM'])
    expect(parsed.files).toEqual(['src/index.ts'])
  })

  it('preserves comment-like syntax and commas inside string literals', () => {
    const jsonc = JSON.stringify({
      url: 'https://example.com/api?path=//foo/*bar*/',
      commentInside: '/* not a comment */ // still not a comment',
      trailingLike: 'val, } not trailing',
      escaped: 'hello "world" with \\// backslashes',
    })

    const parsed = parseJsonc<Record<string, string>>(jsonc)
    expect(parsed.url).toBe('https://example.com/api?path=//foo/*bar*/')
    expect(parsed.commentInside).toBe('/* not a comment */ // still not a comment')
    expect(parsed.trailingLike).toBe('val, } not trailing')
  })

  it('handles comments followed by trailing commas before closing braces', () => {
    const jsonc = [
      '{',
      '  "compilerOptions": {',
      '    "strict": true, // comment right after comma',
      '    /* another comment */',
      '  }',
      '}',
    ].join('\n')

    const parsed = parseJsonc<{ compilerOptions: { strict: boolean } }>(jsonc)
    expect(parsed.compilerOptions.strict).toBe(true)
  })
})

describe('Transitive tsconfig Configuration Universe Walker', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-lens-tsconfig-test-')))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('walks transitive extends chains (string and array) and computes universe digest', () => {
    // base.json
    writeFileSync(
      join(tempDir, 'base.json'),
      [
        '{',
        '  // Base tsconfig with JSONC comments',
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "module": "NodeNext",',
        '    "strict": true,',
        '  },',
        '}',
      ].join('\n'),
    )

    // middle.json extends base.json
    writeFileSync(
      join(tempDir, 'middle.json'),
      [
        '{',
        '  "extends": "./base.json",',
        '  "compilerOptions": {',
        '    "declaration": true,',
        '  },',
        '}',
      ].join('\n'),
    )

    // extra.json for array extends
    writeFileSync(
      join(tempDir, 'extra.json'),
      JSON.stringify({ compilerOptions: { sourceMap: true } }),
    )

    // root tsconfig.json extends array [./middle.json, ./extra.json]
    mkdirSync(join(tempDir, 'src'), { recursive: true })
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const a = 1;\n')
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      [
        '{',
        '  /* Array extends in TypeScript 5.0+ */',
        '  "extends": ["./middle.json", "./extra.json"],',
        '  "include": ["src"],',
        '}',
      ].join('\n'),
    )

    const universe = computeTsconfigUniverse(join(tempDir, 'tsconfig.json'), tempDir)
    expect(universe).toBeDefined()
    expect(universe!.configs.map(c => c.file)).toEqual([
      'base.json',
      'extra.json',
      'middle.json',
      'tsconfig.json',
    ])
    expect(universe!.configs.every(c => /^[0-9a-f]{64}$/.test(c.digest))).toBe(true)
    expect(universe!.universeDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(universe!.roots).toContain('src/index.ts')
  })

  it('follows project references recursively and includes referenced project roots', () => {
    // root base
    writeFileSync(
      join(tempDir, 'base.json'),
      JSON.stringify({ compilerOptions: { composite: true, strict: true } }),
    )

    // subproject referenced
    const refDir = join(tempDir, 'packages', 'shared')
    mkdirSync(join(refDir, 'src'), { recursive: true })
    writeFileSync(join(refDir, 'src', 'shared.ts'), 'export const shared = "hello";\n')
    writeFileSync(
      join(refDir, 'tsconfig.json'),
      JSON.stringify({
        extends: '../../base.json',
        include: ['src'],
      }),
    )

    // main project
    mkdirSync(join(tempDir, 'src'), { recursive: true })
    writeFileSync(join(tempDir, 'src', 'main.ts'), 'import { shared } from "shared";\n')
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      JSON.stringify({
        extends: './base.json',
        references: [{ path: './packages/shared' }],
        include: ['src'],
      }),
    )

    const universe = computeTsconfigUniverse(join(tempDir, 'tsconfig.json'), tempDir)
    expect(universe).toBeDefined()
    expect(universe!.configs.map(c => c.file)).toEqual([
      'base.json',
      'packages/shared/tsconfig.json',
      'tsconfig.json',
    ])
    expect(universe!.roots).toContain('src/main.ts')
    expect(universe!.roots).toContain('packages/shared/src/shared.ts')
  })

  it('prevents infinite recursion on circular extends and self-references', () => {
    // a.json extends b.json, b.json extends a.json
    writeFileSync(
      join(tempDir, 'a.json'),
      JSON.stringify({ extends: './b.json', compilerOptions: { strict: true } }),
    )
    writeFileSync(
      join(tempDir, 'b.json'),
      JSON.stringify({ extends: './a.json', compilerOptions: { declaration: true } }),
    )

    // Walk should terminate cleanly without stack overflow
    const closure = configurationClosure(join(tempDir, 'a.json'), tempDir)
    expect(closure.configs.length).toBe(2)

    const universe = computeTsconfigUniverse(join(tempDir, 'a.json'), tempDir)
    expect(universe).toBeDefined()
    expect(universe!.configs.map(c => c.file)).toEqual(['a.json', 'b.json'])
  })

  it('prevents infinite recursion on self-referencing tsconfig.json', () => {
    // tsconfig extends itself
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      JSON.stringify({ extends: './tsconfig.json', compilerOptions: { strict: true } }),
    )

    const closure = configurationClosure(join(tempDir, 'tsconfig.json'), tempDir)
    expect(closure.configs.length).toBe(1)

    const universe = computeTsconfigUniverse(join(tempDir, 'tsconfig.json'), tempDir)
    expect(universe).toBeDefined()
    expect(universe!.configs.length).toBe(1)
  })

  it('handles projects without tsconfig gracefully', () => {
    expect(computeTsconfigUniverse(undefined)).toBeUndefined()
    expect(computeTsconfigUniverse(null)).toBeUndefined()
    expect(computeTsconfigUniverse('')).toBeUndefined()
    expect(computeTsconfigUniverse(join(tempDir, 'non-existent.json'))).toBeUndefined()
    expect(computeTsconfigUniverseDigest(join(tempDir, 'non-existent.json'))).toBeUndefined()

    const empty = createEmptyTsconfigUniverse()
    expect(empty.configs).toEqual([])
    expect(empty.roots).toEqual([])
    expect(empty.universeDigest).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('SQLite WAL Cache Invalidation via tsconfig Universe Hashing', () => {
  let tempDir: string
  let dbPath: string
  let cache: SqliteCache

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-lens-cache-test-')))
    dbPath = join(tempDir, '.spec-lens.db')
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const observation = {
    adapterKind: 'local-git',
    repository: 'file:///repo-test',
    ref: 'main',
  } as const

  function makeComposition(fragmentsDir: string, targetPath: string) {
    return {
      schemaVersion: 'oa-gen.composition-report.v1' as const,
      target: {
        name: 'test',
        targetPath,
        fragmentsDir,
        scopes: [],
        domains: [],
        includePaths: [],
        includeDefinitions: [],
      },
      summary: {
        registryNodeCount: 0,
        selectedNodeCount: 0,
        directPathCount: 0,
        directDefinitionCount: 0,
        transitiveComponentCount: 0,
        omittedNodeCount: 0,
        sourceRefCount: 0,
        outputAliasCount: 0,
        renamedOutputAliasCount: 0,
        collisionReportCount: 0,
      },
      selected: {
        directPathIds: [],
        directDefinitionIds: [],
        transitiveComponentIds: [],
        selectedNodeIds: [],
      },
      output: { paths: [], components: [], aliases: [], renamedAliases: [], collisionReport: [] },
      omitted: { total: 0, byScope: {}, byDomain: {}, byKind: {} },
      sourceRefs: [],
    }
  }

  function makeStoredSnapshot(projectKey: string, revisionId: string): SpecSnapshotStored {
    return {
      schemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
      projectKey,
      projectKind: 'definition-builder',
      sourceRoot: 'fragments',
      revision: {
        id: revisionId,
        shortId: revisionId.slice(0, 7),
        timestamp: 1000,
        message: 'test commit',
        source: 'local-git',
      },
      fragmentsDir: 'fragments',
      targetPath: 'target.yaml',
      targetConfigDigest: 'target-digest-1',
      spec: { openapi: '3.1.0', info: { title: 'Test API', version: '1.0.0' }, paths: {} },
      provenance: { status: 'available', kind: 'definition-builder', entries: {} },
      composition: makeComposition('fragments', 'target.yaml'),
      diagnostics: [],
      builtAt: 1000,
      entryRefs: [{ relativePath: 'schemas/User.yaml', contentHash: 'hash-user' }],
    }
  }

  it('alters buildSpecProjectKey when tsconfigUniverseDigest changes', () => {
    const baseInput: SpecProjectKeyInput = {
      sourceKind: 'definition-builder',
      sourceRoot: 'fragments',
      manifestOrTargetDigest: 'target-digest',
      builderVersion: 'definition-builder.v1',
      snapshotSchemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
      toolchainFingerprint: 'toolchain-v1',
      observation,
    }

    const keyWithoutTsconfig = buildSpecProjectKey(baseInput)
    const keyWithUniverse1 = buildSpecProjectKey({
      ...baseInput,
      tsconfigUniverseDigest: '1'.repeat(64),
    })
    const keyWithUniverse2 = buildSpecProjectKey({
      ...baseInput,
      tsconfigUniverseDigest: '2'.repeat(64),
    })

    expect(keyWithUniverse1).not.toBe(keyWithoutTsconfig)
    expect(keyWithUniverse2).not.toBe(keyWithoutTsconfig)
    expect(keyWithUniverse1).not.toBe(keyWithUniverse2)
  })

  it('modifying an extended tsconfig alters buildSpecProjectKey and causes cache invalidation', async () => {
    const configDir = join(tempDir, 'project')
    mkdirSync(join(configDir, 'src'), { recursive: true })
    writeFileSync(join(configDir, 'src', 'index.ts'), 'export const x = 1;\n')

    // 1. Create base.json with strict: false
    const basePath = join(configDir, 'base.json')
    writeFileSync(
      basePath,
      [
        '{',
        '  // Base configuration',
        '  "compilerOptions": {',
        '    "strict": false,',
        '    "target": "ES2022",',
        '  },',
        '}',
      ].join('\n'),
    )

    // 2. Create tsconfig.json extending base.json
    const tsconfigPath = join(configDir, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      [
        '{',
        '  "extends": "./base.json",',
        '  "include": ["src"],',
        '}',
      ].join('\n'),
    )

    // Compute universe 1
    const universe1 = computeTsconfigUniverse(tsconfigPath, configDir)
    expect(universe1).toBeDefined()
    expect(universe1!.configs.map(c => c.file)).toEqual(['base.json', 'tsconfig.json'])

    // Create project identity 1
    const identity1 = createSpecProjectIdentity(
      {
        kind: 'definition-builder',
        sourceRoot: 'fragments',
        targetPath: 'target.yaml',
        tsconfigPath,
      },
      'target-digest-1',
      observation,
      universe1!.universeDigest,
    )

    const revId = 'commit-1234567890abcdef'
    const snapshot1 = makeStoredSnapshot(identity1.projectKey, revId)

    // Store in SQLite cache
    await cache.saveSnapshot(snapshot1, [
      { relativePath: 'schemas/User.yaml', content: 'type: object', contentHash: 'hash-user' },
    ])

    // Verify cache HIT for identity 1
    const cachedHit = await cache.getSnapshotByRevision(revId, identity1.projectKey)
    expect(cachedHit).not.toBeNull()
    expect(cachedHit!.projectKey).toBe(identity1.projectKey)
    expect(cachedHit!.revision.id).toBe(revId)

    // 3. Now modify base.json (e.g. change strict from false to true)
    writeFileSync(
      basePath,
      [
        '{',
        '  // Base configuration modified!',
        '  "compilerOptions": {',
        '    "strict": true,',
        '    "target": "ES2022",',
        '  },',
        '}',
      ].join('\n'),
    )

    // Recompute universe 2
    const universe2 = computeTsconfigUniverse(tsconfigPath, configDir)
    expect(universe2).toBeDefined()
    // The digest of base.json must have changed
    const baseDigest1 = universe1!.configs.find(c => c.file === 'base.json')!.digest
    const baseDigest2 = universe2!.configs.find(c => c.file === 'base.json')!.digest
    expect(baseDigest2).not.toBe(baseDigest1)

    // Overall universeDigest must have changed
    expect(universe2!.universeDigest).not.toBe(universe1!.universeDigest)

    // Create project identity 2 with universe 2
    const identity2 = createSpecProjectIdentity(
      {
        kind: 'definition-builder',
        sourceRoot: 'fragments',
        targetPath: 'target.yaml',
        tsconfigPath,
      },
      'target-digest-1',
      observation,
      universe2!.universeDigest,
    )

    // Project key MUST be different!
    expect(identity2.projectKey).not.toBe(identity1.projectKey)

    // Query SQLite cache with identity 2's projectKey -> MUST be a cache MISS (null)!
    const cachedMiss = await cache.getSnapshotByRevision(revId, identity2.projectKey)
    expect(cachedMiss).toBeNull()

    // Query with identity 1 still retrieves the old snapshot (isolation)
    const oldSnapshot = await cache.getSnapshotByRevision(revId, identity1.projectKey)
    expect(oldSnapshot).not.toBeNull()
  })

  it('createSpecProjectIdentity auto-computes tsconfigUniverseDigest when tsconfigPath is provided in config', () => {
    const configDir = join(tempDir, 'project-auto')
    mkdirSync(join(configDir, 'src'), { recursive: true })
    writeFileSync(join(configDir, 'src', 'index.ts'), 'export const y = 2;\n')

    const tsconfigPath = join(configDir, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
    )

    const identity = createSpecProjectIdentity(
      {
        kind: 'definition-builder',
        sourceRoot: 'fragments',
        targetPath: 'target.yaml',
        tsconfigPath,
      },
      'target-digest-1',
      observation,
    )

    expect(identity.tsconfigUniverseDigest).toBeDefined()
    expect(identity.tsconfigUniverseDigest).toMatch(/^[0-9a-f]{64}$/)

    const expectedUniverse = computeTsconfigUniverse(tsconfigPath, configDir)
    expect(identity.tsconfigUniverseDigest).toBe(expectedUniverse!.universeDigest)
  })
})
