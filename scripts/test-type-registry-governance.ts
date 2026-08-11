import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  TYPE_REGISTRY_POLICY_SCHEMA_VERSION,
  diffTypeRegistrySnapshots,
  runTypeRegistryGovernance,
  validatePolicy,
  type TypeRegistryPolicy,
} from './type-registry-governance-lib.js'

const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-type-registry-test-'))

try {
  const packageDirectory = join(workspace, 'packages/example')
  mkdirSync(join(packageDirectory, 'src'), { recursive: true })
  writeJson(join(packageDirectory, 'package.json'), {
    name: '@fixture/example',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        browser: './dist/browser.js',
        default: './dist/index.js',
      },
    },
  })
  const safeSource = [
    'export type Alpha = string',
    'export interface Beta { value: number }',
    'export type Gamma = Alpha | Beta',
    '',
  ].join('\n')
  writeFileSync(join(packageDirectory, 'src/index.ts'), safeSource)
  writeFileSync(join(packageDirectory, 'src/browser.ts'), safeSource)
  const internalPath = join(packageDirectory, 'src/internal.ts')
  writeFileSync(internalPath, 'export type InternalOnly = bigint\n')

  const policy: TypeRegistryPolicy = {
    schemaVersion: TYPE_REGISTRY_POLICY_SCHEMA_VERSION,
    owner: 'fixture owners',
    baselinePath: 'governance/baseline.json',
    outputDirectory: 'governance/output',
    workspaceRoots: ['packages'],
    sourceExtensions: ['.ts', '.d.ts'],
    excludePatterns: ['**/__tests__/**'],
    generatedPatterns: ['**/*.generated.ts'],
    boundaryBudgets: [
      { rule: 'boundary:any', maximum: 0, owner: 'types', remediation: 'model it' },
      { rule: 'boundary:double-assertion', maximum: 0, owner: 'types', remediation: 'validate it' },
      { rule: 'boundary:unvalidated-deserialize', maximum: 0, owner: 'types', remediation: 'parse it' },
    ],
    allowlist: [],
  }
  writeJson(join(workspace, 'governance/policy.json'), policy)

  const first = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
    writeBaseline: true,
  })
  assert.equal(first.report.violations.length, 0)
  assert.ok(first.snapshot.registry.declarations.length >= 6)
  assert.ok(first.snapshot.exportTargets.some(target => target.targetRole === 'declaration-observation'))
  assert.ok(first.snapshot.sources.every(source => source.role === 'authority'))

  const protectedPaths = [
    join(packageDirectory, 'package.json'),
    join(packageDirectory, 'src/index.ts'),
    join(packageDirectory, 'src/browser.ts'),
    join(workspace, 'governance/policy.json'),
    join(workspace, 'governance/baseline.json'),
  ]
  const beforeHashes = new Map(protectedPaths.map(path => [path, fileHash(path)]))
  const tempBefore = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('oa-sdk-type-registry-')))
  const second = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
  })
  assert.deepEqual(second.snapshot, first.snapshot)
  assert.deepEqual(second.report.diff, {
    policyChanged: false,
    added: [],
    removed: [],
    syntaxChanged: [],
    shapeChanged: [],
    semanticChanged: [],
    publicSurfaceChanged: [],
  })
  for (const [path, hash] of beforeHashes) assert.equal(fileHash(path), hash, `${path} changed during dry-run`)
  const tempAfter = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('oa-sdk-type-registry-')))
  assert.deepEqual(tempAfter, tempBefore, 'temporary SQLite workspace leaked')
  assert.deepEqual(
    readdirSync(join(workspace, 'governance/output')).filter(name => name.endsWith('.tmp')),
    [],
    'atomic output left a temporary file',
  )

  const persistentDatabase = 'governance/cache/type-registry.sqlite'
  const persistent = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
    databasePath: persistentDatabase,
    writeOutputs: false,
  })
  const reused = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
    databasePath: persistentDatabase,
    writeOutputs: false,
  })
  assert.deepEqual(reused.snapshot, persistent.snapshot, 'persistent SQLite reuse changed the snapshot')
  rmSync(internalPath)
  const invalidated = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
    databasePath: persistentDatabase,
    writeOutputs: false,
  })
  assert.ok(invalidated.snapshot.registry.declarations.every(declaration => declaration.filePath !== 'packages/example/src/internal.ts'))
  writeFileSync(internalPath, 'export type InternalOnly = bigint\n')

  const changed = structuredClone(first.snapshot)
  const declarations = changed.registry.declarations
  assert.ok(declarations.length >= 3)
  declarations[0]!.syntaxHash = 'syntax-after'
  declarations[1]!.shapeHash = 'shape-after'
  declarations[2]!.semanticHash = 'semantic-after'
  changed.policyHash = 'policy-after'
  changed.registry.publicSurfaces[0]!.hash = 'surface-after'
  const classified = diffTypeRegistrySnapshots(changed, first.snapshot)
  assert.equal(classified.policyChanged, true)
  assert.equal(classified.syntaxChanged.length, 1)
  assert.equal(classified.shapeChanged.length, 1)
  assert.equal(classified.semanticChanged.length, 1)
  assert.equal(classified.publicSurfaceChanged.length, 1)

  writeFileSync(join(packageDirectory, 'src/index.ts'), [
    safeSource.trimEnd(),
    "export { Missing } from './missing.js'",
    'export function unsafe(raw: any): string {',
    '  const parsed = JSON.parse(raw)',
    '  return parsed as unknown as string',
    '}',
    '',
  ].join('\n'))
  const failing = runTypeRegistryGovernance({
    root: workspace,
    policyPath: 'governance/policy.json',
    writeOutputs: false,
  })
  const violationRules = new Set(failing.report.violations.map(violation => violation.rule))
  assert.ok(violationRules.has('boundary:any'))
  assert.ok(violationRules.has('boundary:double-assertion'))
  assert.ok(violationRules.has('boundary:unvalidated-deserialize'))
  assert.ok(violationRules.has('unresolved-public-reexport'))
  assert.ok(violationRules.has('runtime-export-mismatch'))

  const invalidPolicy = structuredClone(policy) as unknown as Record<string, unknown>
  invalidPolicy.allowlist = [{
    id: 'missing-accountability',
    rule: 'boundary:any',
    filePath: '**/*.ts',
  }]
  const policyIssues = validatePolicy(invalidPolicy)
  assert.ok(policyIssues.some(issue => issue.includes('.owner')))
  assert.ok(policyIssues.some(issue => issue.includes('.reason')))
  assert.ok(policyIssues.some(issue => issue.includes('.expiresOn')))

  console.log('Type Registry governance tests passed')
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
