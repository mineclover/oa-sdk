import {
  diffTypeSpecPrograms,
  diffTypeSpecSemantics,
  extractTypeSpecSemantics,
  hasBreakingChanges,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
  type TypeSpecDiffResult,
  type TypeSpecSemantics,
} from '../../../../packages/codegen/src/cli/lib/typespec-ast-diff.js'
import { compileTypeSpecSnippet } from './compiler.js'

export {
  diffTypeSpecPrograms,
  diffTypeSpecSemantics,
  extractTypeSpecSemantics,
  hasBreakingChanges,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
  type TypeSpecDiffResult,
  type TypeSpecSemantics,
}

/**
 * Compiles two TypeSpec snippets and returns their semantic diff.
 */
export async function diffSnippets(
  baseSource: string,
  headSource: string,
  options: {
    baseRef?: string
    headRef?: string
  } = {},
): Promise<{
  result: TypeSpecDiffResult
  baseCleanup: () => Promise<void>
  headCleanup: () => Promise<void>
}> {
  const baseRes = await compileTypeSpecSnippet(baseSource)
  let headRes
  try {
    headRes = await compileTypeSpecSnippet(headSource)
  } catch (err) {
    await baseRes.cleanup()
    throw err
  }

  const result = diffTypeSpecPrograms(baseRes.program, headRes.program, {
    baseRef: options.baseRef ?? 'base.tsp',
    headRef: options.headRef ?? 'head.tsp',
  })

  return {
    result,
    baseCleanup: baseRes.cleanup,
    headCleanup: headRes.cleanup,
  }
}
