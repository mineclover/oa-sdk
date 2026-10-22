import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ARTIFACT_ONLY_PUBLISH_MODE,
  distributionCandidateManifestIssues,
  findDirectPublishScripts,
  POLICY_VERSION,
  validateArtifactReleasePolicy,
  validateTrackDependencyBoundaries,
} from './check-release-policy.js'
import { missingPackageName, probePublicImports } from './lib/public-import-probe.mjs'
import {
  consumerPeerDependencies,
  declaredOptionalPeerImports,
  optionalPeerEntryPointIssues,
} from './lib/public-manifest.mjs'
import { embeddedVersionTables } from '../packages/codegen/scripts/embedded-workspace-versions.mjs'
import { COMPANION_PACKAGES } from '../packages/codegen/src/cli/lib/companion-packages.js'
import { OA_SDK_INIT_PACKAGES } from '../packages/codegen/src/cli/lib/init/oa-sdk-packages.js'
import {
  assertBuiltAgainstVersionsReleasable,
  assertCodegenBuiltAgainstVersionsReleasable,
  CODEGEN_BUILT_AGAINST_GATED_PACKAGES,
  collectManifestTargets,
  copyGitVisibleWorkspace,
  createDraftReleaseMetadata,
  createInternalDependencyResolver,
  createReleaseManifest,
  createPublicNpmVersionQueryArgs,
  assertReleaseVersionMatchesSource,
  embeddedBuiltAgainstVersions,
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
  '--prefer-online',
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
  '@oa-sdk/webmcp-peer',
  '@oa-sdk/collab-workspace',
  '@oa-sdk/mcp-mesh',
  '@oa-sdk/router',
  '@oa-sdk/client',
  '@oa-sdk/mock-server',
  '@oa-sdk/telemetry',
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

// A distribution candidate's source manifest must meet what the public runtime
// smoke asserts on its packed artifact, so that a missing field fails here.
{
  const candidates = new Set(['@oa-sdk/example', '@oa-sdk/core'])
  const publicManifest = {
    name: '@oa-sdk/example',
    version: '0.1.0',
    private: false,
    files: ['dist', 'README.md'],
    engines: { node: '>=22.0.0' },
    publishConfig: { access: 'public', provenance: true },
    main: './dist/index.js',
    exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
    bin: { example: './dist/cli.js' },
    dependencies: { '@oa-sdk/core': 'workspace:*' },
  }
  const issuesOf = (manifest: Record<string, unknown>) =>
    distributionCandidateManifestIssues(manifest, 'public', candidates)

  assert.deepEqual(issuesOf(publicManifest), [])
  assert.deepEqual(issuesOf({ ...publicManifest, engines: undefined }), ['distribution candidate engines.node is required'])
  assert.deepEqual(issuesOf({ ...publicManifest, engines: { node: '>=20' } }), [
    'distribution candidate engines.node must retain the public Node >=22 floor, received >=20',
  ])
  assert.deepEqual(issuesOf({ ...publicManifest, engines: { node: '^22.0.0 || >=24' } }), [
    'distribution candidate engines.node must retain the public Node >=22 floor, received ^22.0.0 || >=24',
  ])
  assert.deepEqual(issuesOf({ ...publicManifest, engines: { node: '>= 22' } }), [])
  assert.deepEqual(issuesOf({ ...publicManifest, private: undefined }), ['distribution candidate must declare private: false'])
  assert.deepEqual(issuesOf({ ...publicManifest, files: ['dist/index.js', 'dist/index.d.ts', 'README.md', 'lib'] }), [
    'distribution candidate must publish dist via files',
    'distribution candidate entry point dist/cli.js is not in files, so the packed artifact would not contain it',
  ])
  // A glob entry covers the directory before its first wildcard.
  assert.deepEqual(issuesOf({ ...publicManifest, files: ['dist', 'README.md'], bin: { example: './bin/cli.js' } }), [
    'distribution candidate entry point bin/cli.js is not in files, so the packed artifact would not contain it',
  ])
  assert.deepEqual(issuesOf({ ...publicManifest, files: ['dist', 'bin/*.js'], bin: { example: './bin/cli.js' } }), [])
  assert.deepEqual(issuesOf({ ...publicManifest, dependencies: { '@oa-sdk/private': 'workspace:*' } }), [
    'dependencies dependency @oa-sdk/private is not a distribution candidate',
  ])

  // A consumer's package manager installs the required peers of the packages,
  // not their optional ones: the smokes' consumers get the same, so that an
  // entry point importing an optional peer fails there as it would for a user.
  const peerManifests = [
    { name: '@oa-sdk/react-bindings', peerDependencies: { react: '>=18.0.0', '@oa-sdk/core': '^0.3.0' } },
    { name: '@oa-sdk/core', peerDependencies: { zod: '>=4.0.0' }, peerDependenciesMeta: { zod: { optional: true } } },
    { name: '@oa-sdk/tools', peerDependencies: { zod: '>=3.0.0', msw: '' } },
    {
      name: '@oa-sdk/mock-server',
      peerDependencies: { msw: '>=2.0.0', typescript: '>=5.0.0' },
      peerDependenciesMeta: { msw: { optional: true }, typescript: { optional: true } },
    },
  ]
  // A peer one package requires is installed even where another marks it
  // optional, at a range satisfying every declaration (msw: tools requires any
  // version, mock-server's optional declaration asks for >=2.0.0).
  assert.deepEqual(consumerPeerDependencies(peerManifests), { msw: '>=2.0.0', react: '>=18.0.0', zod: '>=4.0.0 >=3.0.0' })
  assert.deepEqual(consumerPeerDependencies(peerManifests.slice(3)), {})
  // Optional peers are installed only when named.
  assert.deepEqual(consumerPeerDependencies(peerManifests.slice(3), { optionalPeers: ['msw'] }), { msw: '>=2.0.0' })
  assert.deepEqual(consumerPeerDependencies(peerManifests, { optionalPeers: ['typescript'] }), {
    msw: '>=2.0.0',
    react: '>=18.0.0',
    typescript: '>=5.0.0',
    zod: '>=4.0.0 >=3.0.0',
  })
  assert.throws(
    () => consumerPeerDependencies(peerManifests, { optionalPeers: ['vitest'] }),
    /vitest is not a peer dependency of these packages/,
  )
  assert.throws(
    () => consumerPeerDependencies([
      { name: 'a', peerDependencies: { react: '^18.0.0 || ^19.0.0' } },
      { name: 'b', peerDependencies: { react: '>=18.2.0' } },
    ]),
    /peer dependency react has ranges that cannot be combined: \^18\.0\.0 \|\| \^19\.0\.0, >=18\.2\.0/,
  )

  // Only a subpath may import an optional peer, and only one the package
  // declares optional: the root entry point is what every consumer imports.
  const optionalPeerManifest = {
    name: '@oa-sdk/example',
    exports: { '.': './dist/index.js', './adapters/msw': './dist/msw.js' },
    peerDependencies: { msw: '>=2.0.0', react: '>=18.0.0' },
    peerDependenciesMeta: { msw: { optional: true } },
  }
  assert.deepEqual(optionalPeerEntryPointIssues(optionalPeerManifest, { './adapters/msw': ['msw'] }), [])
  assert.deepEqual(optionalPeerEntryPointIssues(optionalPeerManifest, {
    '.': ['msw'],
    './missing': ['msw'],
    './adapters/msw': ['react', 'zod'],
  }), [
    'the root entry point must import without optional peers (declared: msw); move what needs them to a subpath',
    'optional peer entry point ./missing is not one of its exports',
    'optional peer entry point ./adapters/msw declares react, a required peer that every consumer installs; drop it from the declaration',
    'optional peer entry point ./adapters/msw declares zod, which is not one of its peer dependencies',
  ])
  assert.deepEqual(declaredOptionalPeerImports({ '@oa-sdk/example': { './adapters/msw': ['msw'] } }, '@oa-sdk/example'), [
    { specifier: '@oa-sdk/example/adapters/msw', peers: ['msw'] },
  ])
  assert.deepEqual(declaredOptionalPeerImports(undefined, '@oa-sdk/example'), [])

  // Every distribution candidate of this repository meets them.
  const releaseCandidates = new Set(configuration.candidates)
  const workspaceManifests = ['packages', 'apps'].flatMap(base =>
    readdirSync(join(root, base)).flatMap(entry => {
      const manifestPath = join(root, base, entry, 'package.json')
      return existsSync(manifestPath) ? [JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>] : []
    }))
  for (const candidate of configuration.candidates) {
    const manifest = workspaceManifests.find(entry => entry.name === candidate)
    assert.ok(manifest, `${candidate} must be a workspace package`)
    assert.deepEqual(distributionCandidateManifestIssues(manifest, 'public', releaseCandidates), [], candidate)
    assert.deepEqual(
      optionalPeerEntryPointIssues(manifest, configuration.optionalPeerEntryPoints[candidate] ?? {}),
      [],
      `${candidate} optionalPeerEntryPoints`,
    )
  }
  // msw is an optional peer of @oa-sdk/mock-server: its root entry point, which
  // `oa-gen mock` loads, imports without it, and only the MSW entry points need it.
  assert.deepEqual(configuration.optionalPeerEntryPoints, {
    '@oa-sdk/mock-server': { './adapters/msw': ['msw'], './browser': ['msw'] },
  })
}

// The consumer smokes import every public entry point. One that fails because
// a package is not installed names it, and the entry points declared to need
// optional peers must need exactly those.
{
  const missing = (name: string) =>
    Object.assign(new Error(`Cannot find package '${name}' imported from /consumer/node_modules/@oa-sdk/example/dist/index.js`), {
      code: 'ERR_MODULE_NOT_FOUND',
    })
  assert.equal(missingPackageName(missing('msw')), 'msw')
  assert.equal(missingPackageName(missing('@mswjs/interceptors/presets/node')), '@mswjs/interceptors')
  assert.equal(
    missingPackageName(Object.assign(new Error("Cannot find module '/consumer/node_modules/@oa-sdk/example/dist/index.js'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    })),
    undefined,
    'a missing file of an installed package is a broken package, not a missing one',
  )
  assert.equal(missingPackageName(new SyntaxError("Cannot find package 'msw'")), undefined)

  const installed = new Set<string>()
  const surfaces: Record<string, () => Record<string, unknown>> = {
    '@oa-sdk/example': () => ({ createServer: () => undefined }),
    '@oa-sdk/example/adapters/msw': () => {
      if (!installed.has('msw')) throw missing('msw')
      return { createMswHandlers: () => [] }
    },
    '@oa-sdk/example/lazy': () => ({ load: () => undefined }),
    '@oa-sdk/example/empty': () => ({}),
    '@oa-sdk/example/broken': () => {
      throw new TypeError('example is not a function')
    },
    '@oa-sdk/example/undeclared': () => {
      throw missing('graphql')
    },
  }
  const probe = (plan: Parameters<typeof probePublicImports>[0]) => probePublicImports(plan, {
    importModule: async (specifier: string) => {
      const surface = surfaces[specifier]
      if (!surface) throw missing(specifier)
      return surface()
    },
    isInstalled: (name: string) => installed.has(name),
  })

  assert.deepEqual(await probe({
    imports: ['@oa-sdk/example'],
    withoutOptionalPeers: [{ specifier: '@oa-sdk/example/adapters/msw', peers: ['msw'] }],
  }), [])
  // An undeclared entry point that needs an optional peer, or a package its
  // package does not declare, fails as it would for a consumer.
  assert.deepEqual(await probe({
    imports: ['@oa-sdk/example/adapters/msw', '@oa-sdk/example/empty', '@oa-sdk/example/broken'],
  }), [
    '@oa-sdk/example/adapters/msw cannot be imported without msw, which a consumer does not get with it ' +
      '(an optional peer, or a package it does not declare): make it a dependency or a required peer, ' +
      'or import it only from subpaths that docs/internal/release-policy.json declares under optionalPeerEntryPoints',
    '@oa-sdk/example/empty has no runtime exports',
    '@oa-sdk/example/broken failed to import: example is not a function',
  ])
  // A declaration must stay needed, and must name every optional peer the
  // entry point needs.
  assert.deepEqual(await probe({
    withoutOptionalPeers: [
      { specifier: '@oa-sdk/example/lazy', peers: ['msw'] },
      { specifier: '@oa-sdk/example/undeclared', peers: ['msw'] },
    ],
  }), [
    '@oa-sdk/example/lazy imports without msw; remove that peer from its optionalPeerEntryPoints declaration in docs/internal/release-policy.json',
    "@oa-sdk/example/undeclared failed to import for a reason other than its declared optional peers (msw): Cannot find package 'graphql' imported from /consumer/node_modules/@oa-sdk/example/dist/index.js",
  ])
  // With the optional peers installed, the declared entry points import.
  installed.add('msw')
  assert.deepEqual(await probe({ imports: ['@oa-sdk/example/adapters/msw'] }), [])
  assert.deepEqual(await probe({
    withoutOptionalPeers: [{ specifier: '@oa-sdk/example/adapters/msw', peers: ['msw'] }],
  }), [])
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

const validArtifactPolicy = {
  version: POLICY_VERSION,
  publish: { enabled: false, mode: ARTIFACT_ONLY_PUBLISH_MODE, repository: 'https://github.com/mineclover/oa-sdk-releases.git' },
  distributionCandidates: ['@oa-sdk/core', '@oa-sdk/mock-server'],
}
assert.deepEqual(validateArtifactReleasePolicy(validArtifactPolicy), [])
assert.deepEqual(validateArtifactReleasePolicy({
  ...validArtifactPolicy,
  optionalPeerEntryPoints: { '@oa-sdk/mock-server': { './adapters/msw': ['msw'] } },
}), [])
assert.deepEqual(validateArtifactReleasePolicy({ ...validArtifactPolicy, optionalPeerEntryPoints: [] }), [
  'optionalPeerEntryPoints must map distribution candidates to entry points',
])
assert.deepEqual(validateArtifactReleasePolicy({
  ...validArtifactPolicy,
  optionalPeerEntryPoints: {
    '@oa-sdk/personas': { './msw': ['msw'] },
    '@oa-sdk/core': 'msw',
    '@oa-sdk/mock-server': { 'adapters/msw': ['msw'], './browser': [], './node': ['msw', 'msw'] },
  },
}), [
  'optionalPeerEntryPoints names @oa-sdk/personas, which is not a distribution candidate',
  'optionalPeerEntryPoints.@oa-sdk/core must map export subpaths to the optional peers they import',
  'optionalPeerEntryPoints.@oa-sdk/mock-server: adapters/msw is not an export subpath',
  'optionalPeerEntryPoints.@oa-sdk/mock-server["./browser"] must be a non-empty array of distinct package names',
  'optionalPeerEntryPoints.@oa-sdk/mock-server["./node"] must be a non-empty array of distinct package names',
])

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

// An internal dependency the export does not release is pinned to its
// committed source version, which must already be on npm; npm's latest
// release is never substituted for it.
{
  const sourceVersions = new Map([
    ['@oa-sdk/core', '0.3.1'],
    ['@oa-sdk/parser', '0.4.0'],
    ['@oa-sdk/ast-sync', '0.2.0'],
  ])
  // npm has ast-sync 0.2.0, and core only up to 0.3.0.
  const npm = new Map([['@oa-sdk/core', '0.3.0'], ['@oa-sdk/ast-sync', '0.2.0']])
  const queried: string[] = []
  const registry = (name: string, version: string) => {
    queried.push(`${name}@${version}`)
    return publishedVersion(name, version, target => {
      if (npm.get(name) !== version) {
        throw Object.assign(new Error('npm view failed'), { stderr: 'npm error code E404\nnpm error 404 Not Found' })
      }
      return JSON.stringify(target.slice(target.lastIndexOf('@') + 1))
    })
  }

  // Released by this export: the export version, without a registry lookup.
  const exportingCore = createInternalDependencyResolver(
    '@oa-sdk/codegen',
    new Map([['@oa-sdk/codegen', '0.9.0'], ['@oa-sdk/core', '0.3.1']]),
    sourceVersions,
    registry,
  )
  assert.equal(exportingCore('@oa-sdk/core'), '0.3.1')
  assert.deepEqual(queried, [])

  // Not released by this export, committed version published: that version.
  assert.equal(exportingCore('@oa-sdk/ast-sync'), '0.2.0')
  assert.deepEqual(queried, ['@oa-sdk/ast-sync@0.2.0'])

  // Not a package of the source workspace: unresolved, which the rewrite rejects.
  assert.equal(exportingCore('@oa-sdk/not-a-workspace'), undefined)

  // Not released by this export, committed version unpublished: the export
  // fails instead of depending on npm's latest core (0.3.0).
  const withoutCore = createInternalDependencyResolver(
    '@oa-sdk/codegen',
    new Map([['@oa-sdk/codegen', '0.9.0'], ['@oa-sdk/parser', '0.4.0']]),
    sourceVersions,
    registry,
  )
  assert.throws(
    () => rewriteWorkspaceDependencies({ '@oa-sdk/core': 'workspace:*', '@oa-sdk/parser': 'workspace:*' }, withoutCore),
    /^Error: @oa-sdk\/codegen: internal dependency @oa-sdk\/core@0\.3\.1, the committed version @oa-sdk\/codegen is built and tested against, is neither in this export nor published on npm; add --version @oa-sdk\/core=0\.3\.1 to this export, or publish @oa-sdk\/core@0\.3\.1 first$/,
  )
  assert.deepEqual(
    rewriteWorkspaceDependencies(
      { '@oa-sdk/parser': 'workspace:^', '@oa-sdk/ast-sync': 'workspace:*', yaml: '^2.8.3' },
      withoutCore,
    ),
    { '@oa-sdk/parser': '^0.4.0', '@oa-sdk/ast-sync': '0.2.0', yaml: '^2.8.3' },
  )

  // A registry failure other than E404 is not "unpublished"; it surfaces.
  const unreachable = createInternalDependencyResolver('@oa-sdk/codegen', new Map(), sourceVersions, (name, version) =>
    publishedVersion(name, version, () => {
      throw Object.assign(new Error('npm view failed'), { stderr: 'npm error code E500\nnpm error 500 Internal Server Error' })
    }))
  assert.throws(() => unreachable('@oa-sdk/ast-sync'), /npm registry lookup failed for @oa-sdk\/ast-sync@0\.2\.0/)
}

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

// A codegen export embeds the versions it was built against; oa-gen init writes
// their ranges and its install hints pin companion packages to them. Each must
// be in the same export at that version or already be on npm.
{
  // Gated: every package init writes a registry range for, which includes every
  // companion package, except codegen, which its own export pins.
  const registryInitPackages = Object.entries(OA_SDK_INIT_PACKAGES)
    .filter(([, source]) => source === 'registry')
    .map(([name]) => name)
  assert.deepEqual(
    [...CODEGEN_BUILT_AGAINST_GATED_PACKAGES].sort(),
    registryInitPackages.filter(name => name !== '@oa-sdk/codegen').sort(),
  )
  assert.ok(CODEGEN_BUILT_AGAINST_GATED_PACKAGES.includes('@oa-sdk/core'), 'init writes @oa-sdk/core for microservice/enterprise')
  for (const companion of COMPANION_PACKAGES) {
    assert.ok(CODEGEN_BUILT_AGAINST_GATED_PACKAGES.includes(companion), `${companion} must be gated`)
  }
  assert.ok(!CODEGEN_BUILT_AGAINST_GATED_PACKAGES.includes('@oa-sdk/personas'), 'a workspace-only package has no registry range')

  // The exporter's remedy, `--version <package>=<version>`, must be accepted.
  for (const name of CODEGEN_BUILT_AGAINST_GATED_PACKAGES) {
    assert.ok(configuration.candidates.includes(name), `${name} must be a distribution candidate`)
  }

  const builtAgainst = new Map([
    ['@oa-sdk/router', '0.2.1'],
    ['@oa-sdk/client', '0.2.1'],
    ['@oa-sdk/mock-server', '0.1.3'],
  ])
  const codegenOnly = new Map([['@oa-sdk/codegen', '0.8.1']])
  const registry = (readNpmVersion: (target: string) => string) =>
    (name: string, version: string) => publishedVersion(name, version, readNpmVersion)
  const notFound = () => {
    throw Object.assign(new Error('npm view failed'), { stderr: 'npm error code E404\nnpm error 404 Not Found' })
  }
  const noRegistry = () => {
    throw new Error('packages released by this export must not be looked up on npm')
  }

  // Released by the same export at the embedded version.
  assert.doesNotThrow(() => assertBuiltAgainstVersionsReleasable(
    '0.8.1',
    builtAgainst,
    new Map([...codegenOnly, ...builtAgainst]),
    noRegistry,
  ))

  // Already published.
  const queried: string[] = []
  assert.doesNotThrow(() => assertBuiltAgainstVersionsReleasable('0.8.1', builtAgainst, codegenOnly, registry(target => {
    queried.push(target)
    return JSON.stringify(target.slice(target.lastIndexOf('@') + 1))
  })))
  assert.deepEqual(queried, ['@oa-sdk/router@0.2.1', '@oa-sdk/client@0.2.1', '@oa-sdk/mock-server@0.1.3'])

  // Neither: every such companion is named with its version and both remedies.
  assert.throws(
    () => assertBuiltAgainstVersionsReleasable(
      '0.8.1',
      builtAgainst,
      new Map([...codegenOnly, ['@oa-sdk/client', '0.2.1']]),
      registry(notFound),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /^@oa-sdk\/codegen@0\.8\.1: oa-gen tells users to install these package versions \(oa-gen init writes their ranges, and its install hints pin companion packages to them\), but they are neither in this export nor published on npm:/)
      assert.match(error.message, /@oa-sdk\/router@0\.2\.1: add --version @oa-sdk\/router=0\.2\.1 to this export, or publish @oa-sdk\/router@0\.2\.1 first/)
      assert.match(error.message, /@oa-sdk\/mock-server@0\.1\.3: add --version @oa-sdk\/mock-server=0\.1\.3 to this export, or publish @oa-sdk\/mock-server@0\.1\.3 first/)
      assert.doesNotMatch(error.message, /@oa-sdk\/client/)
      return true
    },
  )

  // Released by the same export, but at another version than codegen embeds.
  assert.throws(
    () => assertBuiltAgainstVersionsReleasable(
      '0.8.1',
      new Map([['@oa-sdk/router', '0.2.1']]),
      new Map([...codegenOnly, ['@oa-sdk/router', '0.3.0']]),
      registry(notFound),
    ),
    /@oa-sdk\/router@0\.2\.1: this export releases @oa-sdk\/router=0\.3\.0 instead; export --version @oa-sdk\/router=0\.2\.1, or publish @oa-sdk\/router@0\.2\.1 first/,
  )

  // A registry failure other than E404 is not "unpublished"; it surfaces.
  assert.throws(
    () => assertBuiltAgainstVersionsReleasable('0.8.1', builtAgainst, codegenOnly, registry(() => {
      throw Object.assign(new Error('npm view failed'), { stderr: 'npm error code E500\nnpm error 500 Internal Server Error' })
    })),
    /npm registry lookup failed for @oa-sdk\/router@0\.2\.1/,
  )

  // The embedded table is restricted to the requested packages; tables naming none are ignored.
  const companions = ['@oa-sdk/router', '@oa-sdk/client', '@oa-sdk/mock-server']
  const embeddedTable = {
    '@oa-sdk/client': '0.2.1',
    '@oa-sdk/core': '0.3.0',
    '@oa-sdk/mock-server': '0.1.3',
    '@oa-sdk/router': '0.2.1',
  }
  assert.deepEqual(
    embeddedBuiltAgainstVersions([{ unrelated: '1.0.0' }, embeddedTable, embeddedTable], companions),
    builtAgainst,
  )
  assert.throws(
    () => embeddedBuiltAgainstVersions([{ '@oa-sdk/router': '0.2.1', '@oa-sdk/client': '0.2.1' }], companions),
    /@oa-sdk\/codegen: the packed artifact embeds no version for @oa-sdk\/mock-server, so the range oa-gen names for it cannot be checked/,
  )
  assert.throws(
    () => embeddedBuiltAgainstVersions([embeddedTable, { ...embeddedTable, '@oa-sdk/router': '0.2.2' }], companions),
    /@oa-sdk\/codegen: the packed artifact embeds conflicting versions for @oa-sdk\/router: 0\.2\.1, 0\.2\.2/,
  )

  // The table is found in bundled JavaScript whatever quotes and escapes it was written with.
  const packedFixture = mkdtempSync(join(tmpdir(), 'oa-sdk-release-embedded-versions-'))
  try {
    mkdirSync(join(packedFixture, 'dist/cli'), { recursive: true })
    writeFileSync(join(packedFixture, 'dist/chunk.js'), [
      `var BUILT_AGAINST = JSON.parse(${JSON.stringify(JSON.stringify(embeddedTable))});`,
      `var unrelated = '{"name":"not a version table"}';`,
      `var numeric = '{"@oa-sdk/router":1}';`,
      '',
    ].join('\n'), 'utf8')
    writeFileSync(join(packedFixture, 'dist/cli/index.js'), `const pinned = '{"@oa-sdk/router":"0.2.1"}';\n`, 'utf8')
    writeFileSync(join(packedFixture, 'dist/chunk.d.ts'), `declare const t: '{"@oa-sdk/router":"9.9.9"}'\n`, 'utf8')
    const tables = embeddedVersionTables(packedFixture, companions) as Record<string, string>[]
    assert.equal(tables.length, 2)
    assert.deepEqual(embeddedBuiltAgainstVersions(tables, companions), builtAgainst)
  } finally {
    rmSync(packedFixture, { recursive: true, force: true })
  }

  // A packed codegen is gated on every package it names at its built-against
  // version, not only the companions: microservice and enterprise scaffolds
  // write `@oa-sdk/core` at `^<built-against>`.
  const packedCodegen = mkdtempSync(join(tmpdir(), 'oa-sdk-release-packed-codegen-'))
  try {
    const rcBuiltAgainst = {
      '@oa-sdk/codegen': '0.9.0',
      '@oa-sdk/core': '0.3.1',
      '@oa-sdk/parser': '0.4.0',
      '@oa-sdk/router': '0.2.2',
      '@oa-sdk/client': '0.2.2',
      '@oa-sdk/mock-server': '0.1.4',
    }
    mkdirSync(join(packedCodegen, 'dist'), { recursive: true })
    writeFileSync(
      join(packedCodegen, 'dist/chunk.js'),
      `var BUILT_AGAINST = JSON.parse(${JSON.stringify(JSON.stringify(rcBuiltAgainst))});\n`,
      'utf8',
    )
    const companionExport = new Map([
      ['@oa-sdk/codegen', '0.9.0'],
      ['@oa-sdk/router', '0.2.2'],
      ['@oa-sdk/client', '0.2.2'],
      ['@oa-sdk/mock-server', '0.1.4'],
    ])
    // npm has core 0.3.0 only; nothing else of the RC is published.
    const npm = registry(target => {
      if (target !== '@oa-sdk/core@0.3.0') notFound()
      return '"0.3.0"'
    })

    // Core embedded at an unpublished version and not in the export: fails.
    assert.throws(
      () => assertCodegenBuiltAgainstVersionsReleasable(packedCodegen, '0.9.0', companionExport, npm),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^@oa-sdk\/codegen@0\.9\.0: oa-gen tells users to install these package versions/)
        assert.match(error.message, /@oa-sdk\/core@0\.3\.1: add --version @oa-sdk\/core=0\.3\.1 to this export, or publish @oa-sdk\/core@0\.3\.1 first/)
        assert.doesNotMatch(error.message, /- @oa-sdk\/(?:router|client|mock-server|codegen)@/)
        // parser is a runtime dependency only; init never writes it.
        assert.doesNotMatch(error.message, /@oa-sdk\/parser/)
        return true
      },
    )

    // Core in the same export at the embedded version: passes without a registry lookup.
    assert.doesNotThrow(() => assertCodegenBuiltAgainstVersionsReleasable(
      packedCodegen,
      '0.9.0',
      new Map([...companionExport, ['@oa-sdk/core', '0.3.1']]),
      noRegistry,
    ))

    // Core already published at the embedded version: passes.
    assert.doesNotThrow(() => assertCodegenBuiltAgainstVersionsReleasable(
      packedCodegen,
      '0.9.0',
      companionExport,
      registry(target => {
        if (target !== '@oa-sdk/core@0.3.1') notFound()
        return '"0.3.1"'
      }),
    ))

    // A packed codegen that embeds no core version cannot be checked.
    writeFileSync(
      join(packedCodegen, 'dist/chunk.js'),
      `var BUILT_AGAINST = '${JSON.stringify({ ...rcBuiltAgainst, '@oa-sdk/core': undefined })}';\n`,
      'utf8',
    )
    assert.throws(
      () => assertCodegenBuiltAgainstVersionsReleasable(packedCodegen, '0.9.0', companionExport, noRegistry),
      /the packed artifact embeds no version for @oa-sdk\/core/,
    )
  } finally {
    rmSync(packedCodegen, { recursive: true, force: true })
  }
}

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
