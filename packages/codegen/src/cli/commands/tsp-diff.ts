import type { Command, CommandContext } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { resolveTypeSpecProgramRef } from '../lib/typespec-ref-resolver.js'
import {
  diffTypeSpecPrograms,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
  hasBreakingChanges,
} from '../lib/typespec-ast-diff.js'

export const tspDiff: Command = {
  name: 'tsp diff',
  description: 'TypeSpec AST semantic diff and breaking change analyzer',
  options: {
    base: {
      type: 'string',
      required: true,
      description: 'Base TypeSpec source file, directory, or git ref (e.g. main, HEAD~1, path/to/main.tsp)',
    },
    head: {
      type: 'string',
      required: true,
      description: 'Head TypeSpec source file, directory, or git ref (e.g. HEAD, path/to/main.tsp)',
    },
    'fail-on-breaking': {
      type: 'boolean',
      description: 'Exit with code 1 if breaking changes are detected',
    },
    format: {
      type: 'string',
      description: 'Output format: markdown (default) or json',
    },
  },
  async run(args, context?: CommandContext) {
    const rootDir = context?.projectRoot ?? optStr(args, 'project-root') ?? optStr(args, 'root') ?? process.cwd()
    const baseRef = str(args, 'base')
    const headRef = str(args, 'head')
    const failOnBreaking = bool(args, 'fail-on-breaking')
    const format = optStr(args, 'format') ?? 'markdown'

    // If headRef is a local path, pass it as fallbackPath to baseRef resolution (and vice versa)
    const baseProgram = await resolveTypeSpecProgramRef(baseRef, rootDir, headRef)
    let headProgram
    try {
      headProgram = await resolveTypeSpecProgramRef(headRef, rootDir, baseProgram.entrypoint)
    } catch (err) {
      await baseProgram.cleanup()
      throw err
    }

    try {
      const result = diffTypeSpecPrograms(baseProgram.program, headProgram.program, {
        baseRef,
        headRef,
      })

      if (format === 'json') {
        console.log(formatTypeSpecDiffJson(result))
      } else {
        console.log(formatTypeSpecDiffMarkdown(result))
      }

      if (failOnBreaking && hasBreakingChanges(result)) {
        throw new CliExitError(1)
      }
    } finally {
      await baseProgram.cleanup()
      await headProgram.cleanup()
    }
  },
}

export default tspDiff
