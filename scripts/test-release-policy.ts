import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ARTIFACT_ONLY_PUBLISH_MODE,
  findDirectPublishScripts,
  POLICY_VERSION,
  validateArtifactReleasePolicy,
  validateTrackDependencyBoundaries,
} from './check-release-policy.js'
import {
  collectManifestTargets,
  copyGitVisibleWorkspace,
  createDraftReleaseMetadata,
  createReleaseManifest,
  createPublicNpmVersionQueryArgs,
  assertReleaseVersionMatchesSource,
  PUBLIC_OA_SDK_SCOPE_REGISTRY_OPTION,
  PUBLIC_NPM_REGISTRY,
  publishedVersion,
  publicImportSpecifiers,
  readSourceProvenance,
  readReleaseExportConfiguration,
  requiresReleasePreflight,
  rewriteWorkspaceDependencies,
} from './export-release-artifacts.js'

const root = resolve(import.meta.dirname, '..')
const policyPath = join(root, 'docs/internal/release-policy.json')
const configuration = readReleaseExportConfiguration(policyPath)

assert.equal(POLICY_VERSION, 5)
assert.equal(PUBLIC_NPM_REGISTRY, 'https://registry.npmjs.org/')
assert.equal(PUBLIC_OA_SDK_SCOPE_REGISTRY_OPTION, '--@oa-sdk:registry=https://registry.npmjs.org/')
assert.deepEqual(createPublicNpmVersionQueryArgs('@oa-sdk/core@0.1.3'), [
  'view',
  '@oa-sdk/core@0.1.3',
  'version',
  '--json',
  '--registry',
  'https://registry.npmjs.org/',
  '--@oa-sdk:registry=https://registry.npmjs.org/',
])
assert.equal(configuration.repository, 'https://github.com/mineclover/oa-sdk-releases.git')
assert.deepEqual(configuration.candidates, [
  '@oa-sdk/core',
  '@oa-sdk/openapi-projection-contract',
  '@oa-sdk/typespec-decorators',
  '@oa-sdk/parser',
  '@oa-sdk/codegen',
  '@oa-sdk/ast-sync',
  '@oa-sdk/tools',
  '@oa-sdk/surface-ir',
  '@oa-sdk/chunk-stream',
  '@oa-sdk/chunk-stream-crdt',
  '@oa-sdk/chunk-stream-ui',
  '@oa-sdk/chunk-stream-timeseries',
  '@oa-sdk/chunk-stream-react',
  '@oa-sdk/peer-transport',
  '@oa-sdk/peer-server',
  '@oa-sdk/collab-workspace',
  '@oa-sdk/mcp-mesh',
  '@oa-sdk/router',
  '@oa-sdk/client',
  '@oa-sdk/mock-server',
])
assert.equal(requiresReleasePreflight(false), true)
assert.equal(requiresReleasePreflight(true), false)

assert.deepEqual(
  findDirectPublishScripts({
    artifact: 'corepack pnpm release:export',
    changesets: 'pnpm exec changeset publish',
    npm: 'npm publish --provenance',
    filteredPnpm: 'pnpm --filter @oa-sdk/core publish',
    yarn: 'yarn npm publish',
  }),
  ['changesets', 'filteredPnpm', 'npm', 'yarn'],
)

assert.doesNotThrow(() => assertReleaseVersionMatchesSource('@oa-sdk/core', '0.1.3', '0.1.3'))
assert.throws(
  () => assertReleaseVersionMatchesSource('@oa-sdk/core', '0.1.3', '0.1.2'),
  /official export version 0\.1\.3 must match the committed source package version 0\.1\.2/,
)
assert.throws(
  () => assertReleaseVersionMatchesSource('@oa-sdk/core', '0.1.3', 'invalid'),
  /source package version must be a valid SemVer string/,
)

const draftFixtureDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-draft-fixture-'))
try {
  const sourceDirectory = join(draftFixtureDirectory, 'source')
  const scratchDirectory = join(draftFixtureDirectory, 'scratch')
  const packagePath = join(sourceDirectory, 'packages/core/package.json')
  const deletedPath = join(sourceDirectory, 'removed.txt')
  mkdirSync(join(sourceDirectory, 'packages/core'), { recursive: true })
  writeFileSync(join(sourceDirectory, '.gitignore'), 'ignored.txt\n', 'utf8')
  writeFileSync(packagePath, `${JSON.stringify({ name: '@oa-sdk/core', version: '0.1.2' })}\n`, 'utf8')
  writeFileSync(deletedPath, 'remove from draft source\n', 'utf8')
  runGit(sourceDirectory, ['init', '--quiet'])
  runGit(sourceDirectory, ['config', 'user.email', 'release-test@example.invalid'])
  runGit(sourceDirectory, ['config', 'user.name', 'Release Test'])
  runGit(sourceDirectory, ['add', '.'])
  runGit(sourceDirectory, ['commit', '--quiet', '-m', 'initial release fixture'])

  // A maintainer may be testing an uncommitted package version. The draft
  // manifest must retain the committed revision but be explicitly non-promotable.
  writeFileSync(packagePath, `${JSON.stringify({ name: '@oa-sdk/core', version: '0.1.3' })}\n`, 'utf8')
  rmSync(deletedPath)
  runGit(sourceDirectory, ['add', '-u'])
  writeFileSync(join(sourceDirectory, 'ignored.txt'), 'caller-only output\n', 'utf8')
  const provenance = readSourceProvenance(sourceDirectory)
  const sourceStatusBeforeScratchMutation = runGit(sourceDirectory, ['status', '--porcelain'])
  const committedPackage = JSON.parse(runGit(sourceDirectory, ['show', 'HEAD:packages/core/package.json'])) as { version: string }
  assert.equal(committedPackage.version, '0.1.2')
  assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).version, '0.1.3')
  assert.equal(provenance.worktree, 'dirty')

  const draft = createDraftReleaseMetadata(provenance)
  const draftManifest = createReleaseManifest('draft-version-mismatch', provenance.revision, [
    { name: '@oa-sdk/core', version: '0.1.3', tarball: 'packages/oa-sdk-core-0.1.3.tgz', integrity: 'sha512-test' },
  ], draft)
  assert.equal(draftManifest.sourceRevision, provenance.revision)
  assert.deepEqual(draftManifest.draft, {
    nonPromotable: true,
    sourceCopy: 'isolated-git-visible-worktree',
    sourceWorktree: 'dirty',
  })
  assert.ok(!('draft' in createReleaseManifest('official', provenance.revision, [])))

  copyGitVisibleWorkspace(sourceDirectory, scratchDirectory)
  assert.equal(readFileSync(packagePath, 'utf8'), readFileSync(join(scratchDirectory, 'packages/core/package.json'), 'utf8'))
  assert.ok(!existsSync(join(scratchDirectory, 'ignored.txt')), 'ignored caller output must not enter draft source')
  assert.ok(!existsSync(join(scratchDirectory, 'removed.txt')), 'staged deletions must stay absent from draft source')
  writeFileSync(join(scratchDirectory, 'packages/core/package.json'), '{"name":"@oa-sdk/core","version":"0.1.4"}\n', 'utf8')
  assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).version, '0.1.3', 'scratch mutations must not affect the caller worktree')
  assert.equal(runGit(sourceDirectory, ['status', '--porcelain']), sourceStatusBeforeScratchMutation, 'scratch work must preserve caller worktree state')
} finally {
  rmSync(draftFixtureDirectory, { recursive: true, force: true })
}

const policyIssues = validateArtifactReleasePolicy({
  version: POLICY_VERSION,
  publish: {
    enabled: false,
    mode: 'registry',
    repository: 'git@github.com:mineclover/oa-sdk-releases.git',
  },
  distributionCandidates: ['@oa-sdk/core'],
})
assert(policyIssues.includes(`publish.mode must be ${ARTIFACT_ONLY_PUBLISH_MODE}`))
assert(policyIssues.some(issue => issue.startsWith('publish.repository must be an HTTPS')))

const publicVersions = new Map([
  ['@oa-sdk/core', '1.2.3'],
  ['@oa-sdk/parser', '2.0.0'],
])
assert.deepEqual(
  rewriteWorkspaceDependencies(
    {
      '@oa-sdk/core': 'workspace:*',
      '@oa-sdk/parser': 'workspace:^',
      yaml: '^2.8.3',
    },
    name => publicVersions.get(name),
  ),
  {
    '@oa-sdk/core': '1.2.3',
    '@oa-sdk/parser': '^2.0.0',
    yaml: '^2.8.3',
  },
)

assert.throws(
  () => rewriteWorkspaceDependencies(
    { '@oa-sdk/private-optional-peer': 'workspace:^' },
    () => undefined,
  ),
  /cannot resolve a public version for internal workspace dependency @oa-sdk\/private-optional-peer/,
)

const npmVersionTarget = '@oa-sdk/core@1.2.3'
let queriedTarget: string | undefined
assert.equal(
  publishedVersion('@oa-sdk/core', '1.2.3', target => {
    queriedTarget = target
    return '"1.2.3"\n'
  }),
  '1.2.3',
)
assert.equal(queriedTarget, npmVersionTarget)

assert.equal(
  publishedVersion('@oa-sdk/core', '9.9.9', () => {
    throw Object.assign(new Error('npm view failed'), {
      stderr: 'npm error code E404\nnpm error 404 Not Found',
    })
  }),
  undefined,
)

assert.throws(
  () => publishedVersion('@oa-sdk/core', '9.9.9', () => {
    throw new Error('E404 mentioned by a non-npm failure')
  }),
  /npm registry lookup failed for @oa-sdk\/core@9\.9\.9/,
)

for (const failure of [
  { code: 'E401', stderr: 'npm error code E401\nnpm error Unable to authenticate' },
  { code: 'ECONNRESET', stderr: 'npm error code ECONNRESET\nnpm error network socket hang up' },
  { code: 'E500', stderr: 'npm error code E500\nnpm error 500 Internal Server Error' },
]) {
  assert.throws(
    () => publishedVersion('@oa-sdk/core', '9.9.9', () => {
      throw Object.assign(new Error('npm view failed'), failure)
    }),
    /npm registry lookup failed for @oa-sdk\/core@9\.9\.9/,
  )
}

assert.throws(
  () => publishedVersion('@oa-sdk/core', '9.9.9', () => '{not-json'),
  /npm registry lookup returned invalid JSON for @oa-sdk\/core@9\.9\.9/,
)
assert.throws(
  () => publishedVersion('@oa-sdk/core', '9.9.9', () => '{"version":"9.9.9"}'),
  /npm registry lookup returned an invalid version for @oa-sdk\/core@9\.9\.9/,
)

const packedSurface = {
  main: './dist/index.js',
  exports: {
    '.': { import: './dist/index.js', types: './dist/index.d.ts' },
    './browser': { import: './dist/browser.js', types: './dist/browser.d.ts' },
  },
  bin: { 'oa-gen': './dist/cli/index.js' },
}
assert.deepEqual(collectManifestTargets(packedSurface), [
  'dist/browser.d.ts',
  'dist/browser.js',
  'dist/cli/index.js',
  'dist/index.d.ts',
  'dist/index.js',
])
assert.deepEqual(publicImportSpecifiers('@oa-sdk/example', packedSurface), [
  '@oa-sdk/example',
  '@oa-sdk/example/browser',
])

{
  const mockPolicy = {
    tracks: {
      corePlatform: { policy: 'active', release: 'release-tracked', workspaces: ['@oa-sdk/core'] },
      downstream: { policy: 'compatibility', release: 'release-tracked', workspaces: ['@oa-sdk/client'] },
      maintenance: { policy: 'maintenance-only', release: 'ignored', workspaces: [] },
      applications: { policy: 'support-only', release: 'ignored', workspaces: [] },
    },
  } as any

  const issuesDeps: string[] = []
  validateTrackDependencyBoundaries(
    mockPolicy,
    [{ packageJsonPath: '/mock/core/package.json', manifest: { name: '@oa-sdk/core', dependencies: { '@oa-sdk/client': 'workspace:*' } } }],
    issuesDeps,
  )
  assert.equal(issuesDeps.length, 1)
  assert.match(issuesDeps[0], /corePlatform packages may only reference downstream packages via devDependencies/)

  const issuesDevDeps: string[] = []
  validateTrackDependencyBoundaries(
    mockPolicy,
    [{ packageJsonPath: '/mock/core/package.json', manifest: { name: '@oa-sdk/core', devDependencies: { '@oa-sdk/client': 'workspace:*' } } }],
    issuesDevDeps,
  )
  assert.equal(issuesDevDeps.length, 0)
}

console.log('Release policy/exporter regression tests passed.')

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
