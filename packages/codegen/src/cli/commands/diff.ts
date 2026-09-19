import type { Command, CommandContext } from '../lib/types.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
import { bool, optStr, str } from '../lib/args.js'
import {
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from '../lib/openapi-breaking-diff.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import { CliExitError } from '../lib/errors.js'

const diffSpec = commandById(oaGenGovernanceManifest, 'diff')

export const diff: Command = {
  name: diffSpec.name,
  description: diffSpec.summary,
  options: {
    base: {
      type: 'string',
      required: true,
      description: optionDescription(diffSpec, 'base'),
    },
    head: {
      type: 'string',
      required: true,
      description: optionDescription(diffSpec, 'head'),
    },
    'fail-on-breaking': {
      type: 'boolean',
      description: optionDescription(diffSpec, 'fail-on-breaking'),
    },
  },
  async run(args, context?: CommandContext) {
    const rootDir = context?.projectRoot ?? optStr(args, 'project-root') ?? optStr(args, 'root')
    const base = await loadSpecDocumentAsync(str(args, 'base'), rootDir)
    const head = await loadSpecDocumentAsync(str(args, 'head'), rootDir)
    const result = diffEndpoints(base.document, head.document)
    console.log(formatMarkdown(result))
    if (bool(args, 'fail-on-breaking') && hasBreakingChanges(result)) throw new CliExitError(1)
  },
}
