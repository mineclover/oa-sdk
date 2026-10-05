import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCliExampleGate,
  createCliReferenceGate,
  createMarkdownLocalLinkGate,
  createPackageEntrypointGate,
  listMarkdownFiles,
  runValidationGates,
} from './lib/validation-gates.js'

const tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-validation-gates-'))

try {
  assertInvalidExamplesAreReported()
  assertChainedExamplesAreAccepted()
  assertBuiltCliExamplesAreAccepted()
  assertInvalidBuiltCliExamplesAreReported()
  assertCliReferenceCoverageIsEnforced()
  assertPackageEntrypointCoverageIsEnforced()
  assertWorktreesAreExcludedFromMarkdownDiscovery()
  console.log('Documentation validation gate library tests OK.')
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
}

function assertInvalidExamplesAreReported(): void {
  const validTarget = join(tmpDir, 'target.md')
  const document = join(tmpDir, 'invalid.md')
  writeFileSync(validTarget, '# Target\n', 'utf8')
  writeFileSync(document, [
    '[valid](./target.md)',
    '[missing](./missing.md)',
    '',
    '```bash',
    'oa-gen duplicate-review --fragments fragments --unknown-option',
    'oa-gen does-not-exist --value example',
    '```',
  ].join('\n'), 'utf8')

  const issues = runValidationGates([
    createMarkdownLocalLinkGate({ root: tmpDir, files: [document] }),
    createExampleGate(document),
  ])

  assert.ok(issues.some(issue => issue.message === 'missing local link target: ./missing.md'))
  assert.ok(issues.some(issue => issue.message === 'unknown oa-gen option for duplicate-review: --unknown-option'))
  assert.ok(issues.some(issue => issue.message === 'unknown oa-gen command: does-not-exist'))
}

function assertChainedExamplesAreAccepted(): void {
  const document = join(tmpDir, 'valid.md')
  writeFileSync(document, [
    '```bash',
    'pnpm schema:validate && \\',
    'oa-gen duplicate-review --fragments fragments -t public.yaml \\',
    '--target admin.yaml --help',
    '```',
  ].join('\n'), 'utf8')

  const issues = runValidationGates([createExampleGate(document)])
  assert.deepEqual(issues, [])
}

function assertBuiltCliExamplesAreAccepted(): void {
  const document = join(tmpDir, 'built-cli-valid.md')
  writeFileSync(document, [
    '```bash',
    'node packages/codegen/dist/cli/index.js duplicate-review --fragments fragments -t public.yaml \\',
    '--target admin.yaml --help',
    '```',
  ].join('\n'), 'utf8')

  assert.deepEqual(runValidationGates([createExampleGate(document)]), [])
}

function assertInvalidBuiltCliExamplesAreReported(): void {
  const document = join(tmpDir, 'built-cli-invalid.md')
  writeFileSync(document, [
    '```bash',
    'node packages/codegen/dist/cli/index.js duplicate-review --fragments fragments --unknown-option',
    'node packages/codegen/dist/cli/index.js does-not-exist --value example',
    '```',
  ].join('\n'), 'utf8')

  const issues = runValidationGates([createExampleGate(document)])
  assert.ok(issues.some(issue => issue.message === 'unknown oa-gen option for duplicate-review: --unknown-option'))
  assert.ok(issues.some(issue => issue.message === 'unknown oa-gen command: does-not-exist'))
}

function assertCliReferenceCoverageIsEnforced(): void {
  const missing = join(tmpDir, 'missing-reference.md')
  const incomplete = join(tmpDir, 'incomplete-reference.md')
  const complete = join(tmpDir, 'complete-reference.md')
  writeFileSync(incomplete, '| `oa-gen alpha` | first |\n| `oa-gen alpha` | duplicate |\n| `oa-gen unknown` | invalid |\n', 'utf8')
  writeFileSync(complete, '| `oa-gen alpha` | first |\n| `oa-gen beta-command` | second |\n', 'utf8')
  const options = {
    root: tmpDir,
    executable: 'oa-gen',
    commands: [
      { name: 'alpha', options: {} },
      { name: 'beta-command', options: {} },
    ],
  }

  const missingIssues = createCliReferenceGate({ ...options, file: missing }).validate()
  assert.equal(missingIssues[0]?.message, 'missing CLI command reference document')

  const incompleteIssues = createCliReferenceGate({ ...options, file: incomplete }).validate()
  assert.ok(incompleteIssues.some(issue => issue.message === 'duplicate oa-gen command in reference: alpha'))
  assert.ok(incompleteIssues.some(issue => issue.message === 'unknown oa-gen command in reference: unknown'))
  assert.ok(incompleteIssues.some(issue => issue.message === 'missing oa-gen command in reference: beta-command'))

  assert.deepEqual(createCliReferenceGate({ ...options, file: complete }).validate(), [])
}

function assertPackageEntrypointCoverageIsEnforced(): void {
  const root = join(tmpDir, 'package-reference-root')
  const packages = join(root, 'packages')
  mkdirSync(join(packages, 'alpha'), { recursive: true })
  mkdirSync(join(packages, 'beta'), { recursive: true })
  writeFileSync(join(packages, 'alpha', 'package.json'), JSON.stringify({ name: '@oa-sdk/alpha' }), 'utf8')
  writeFileSync(join(packages, 'beta', 'package.json'), JSON.stringify({ name: '@oa-sdk/beta' }), 'utf8')
  const incomplete = join(root, 'entrypoints.md')
  const complete = join(root, 'complete-entrypoints.md')
  writeFileSync(incomplete, '| `@oa-sdk/alpha` | first |\n| `@oa-sdk/alpha` | duplicate |\n| `@oa-sdk/unknown` | invalid |\n', 'utf8')
  writeFileSync(complete, '| `@oa-sdk/alpha` | first |\n| `@oa-sdk/beta` | second |\n', 'utf8')

  const incompleteIssues = createPackageEntrypointGate({ root, file: incomplete }).validate()
  assert.ok(incompleteIssues.some(issue => issue.message === 'duplicate workspace package in entrypoint map: @oa-sdk/alpha'))
  assert.ok(incompleteIssues.some(issue => issue.message === 'unknown workspace package in entrypoint map: @oa-sdk/unknown'))
  assert.ok(incompleteIssues.some(issue => issue.message === 'missing workspace package in entrypoint map: @oa-sdk/beta'))
  assert.deepEqual(createPackageEntrypointGate({ root, file: complete }).validate(), [])
}

function assertWorktreesAreExcludedFromMarkdownDiscovery(): void {
  const root = join(tmpDir, 'markdown-discovery-root')
  mkdirSync(join(root, '.worktrees', 'nested'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# root\n', 'utf8')
  writeFileSync(join(root, 'docs', 'guide.md'), '# guide\n', 'utf8')
  writeFileSync(join(root, '.worktrees', 'nested', 'README.md'), '# ignored\n', 'utf8')
  // A linked worktree elsewhere in the tree (e.g. .claude/worktrees/<name>) has a `.git` file.
  mkdirSync(join(root, '.claude', 'worktrees', 'agent', 'docs'), { recursive: true })
  writeFileSync(join(root, '.claude', 'worktrees', 'agent', '.git'), 'gitdir: /elsewhere\n', 'utf8')
  writeFileSync(join(root, '.claude', 'worktrees', 'agent', 'docs', 'guide.md'), '# ignored\n', 'utf8')
  // A nested repository has a `.git` directory.
  mkdirSync(join(root, 'vendor-repo', '.git'), { recursive: true })
  writeFileSync(join(root, 'vendor-repo', 'README.md'), '# ignored\n', 'utf8')

  assert.deepEqual(listMarkdownFiles(root), [
    join(root, 'README.md'),
    join(root, 'docs', 'guide.md'),
  ])
}

function createExampleGate(document: string) {
  return createCliExampleGate({
    root: tmpDir,
    files: [document],
    executable: 'oa-gen',
    commands: [{
      name: 'duplicate-review',
      options: { fragments: {}, target: { short: 't' } },
    }],
  })
}
