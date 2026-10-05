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
