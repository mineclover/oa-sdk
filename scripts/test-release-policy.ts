import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

import {
  ARTIFACT_ONLY_PUBLISH_MODE,
  findDirectPublishScripts,
  POLICY_VERSION,
  validateArtifactReleasePolicy,
} from './check-release-policy.js'
import {
  collectManifestTargets,
  publicImportSpecifiers,
  readReleaseExportConfiguration,
  rewriteWorkspaceDependencies,
} from './export-release-artifacts.js'

const root = resolve(import.meta.dirname, '..')
const policyPath = join(root, 'docs/internal/release-policy.json')
const configuration = readReleaseExportConfiguration(policyPath)

assert.equal(POLICY_VERSION, 5)
assert.equal(configuration.repository, 'https://github.com/mineclover/oa-sdk-releases.git')
assert.deepEqual(configuration.candidates, [
  '@oa-sdk/core',
  '@oa-sdk/openapi-projection-contract',
  '@oa-sdk/typespec-decorators',
  '@oa-sdk/parser',
  '@oa-sdk/codegen',
])

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

console.log('Release policy/exporter regression tests passed.')
