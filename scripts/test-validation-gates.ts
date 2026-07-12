import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCliExampleGate,
  createMarkdownLocalLinkGate,
  runValidationGates,
} from './lib/validation-gates.js'

const tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-validation-gates-'))

try {
  assertInvalidExamplesAreReported()
  assertChainedExamplesAreAccepted()
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
