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
  createCliExampleGate,
  createMarkdownLocalLinkGate,
  listMarkdownFiles,
  runValidationGates,
} from './lib/validation-gates.js'

const root = resolve(process.cwd())
const files = listMarkdownFiles(root)
const issues = runValidationGates([
  createMarkdownLocalLinkGate({ root, files }),
  createCliExampleGate({ root, files, executable: 'oa-gen', commands }),
])

if (issues.length > 0) {
  console.error('Documentation check failed:\n')
  for (const issue of issues) {
    console.error(`- [${issue.gate}] ${issue.file}:${issue.line} ${issue.message}`)
  }
  process.exitCode = 1
} else {
  console.log(`Documentation OK: ${files.length} Markdown files, local links and oa-gen examples checked.`)
}
