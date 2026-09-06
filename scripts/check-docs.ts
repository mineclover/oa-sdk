/**
 * Repository documentation gates.
 *
 * This composes reusable gates from scripts/lib/validation-gates.ts so other
 * repository checks can add the same link or CLI-example validation without
 * copying Markdown parsing rules.
 */

import { resolve } from 'node:path'
import { commands } from '../packages/codegen/src/cli/commands.js'
import {
  createAgentConfigGate,
  createCliExampleGate,
  createCliReferenceGate,
  createMarkdownLocalLinkGate,
  createPackageEntrypointGate,
  listMarkdownFiles,
  runValidationGates,
} from './lib/validation-gates.js'

const root = resolve(process.cwd())
const files = listMarkdownFiles(root)
const oas32ReferenceFiles = listMarkdownFiles(resolve(root, 'docs/references/oas32'))
const issues = runValidationGates([
  createAgentConfigGate({ root }),
  createMarkdownLocalLinkGate({ root, files }),
  createMarkdownLocalLinkGate({ root, files: oas32ReferenceFiles }),
  createCliExampleGate({ root, files, executable: 'oa-gen', commands }),
  createCliReferenceGate({
    root,
    file: resolve(root, 'docs/guides/cli-command-reference.md'),
    executable: 'oa-gen',
    commands,
  }),
  createPackageEntrypointGate({
    root,
    file: resolve(root, 'docs/guides/library-entrypoints.md'),
  }),
])

if (issues.length > 0) {
  console.error('Documentation check failed:\n')
  for (const issue of issues) {
    console.error(`- [${issue.gate}] ${issue.file}:${issue.line} ${issue.message}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `Documentation OK: ${files.length} Markdown files plus ${oas32ReferenceFiles.length} OAS reference files; local links, oa-gen examples, agent governance, and command/package entrypoint coverage checked.`,
  )
}
