/**
 * S1 — prepare. Shares the preflight with the Zod generator (`prepareCodegenDocument`).
 */
import type { LintResult, OasDocument, OasSchema } from '@oa-sdk/parser'
import { prepareCodegenDocument } from '../schema-graph/index.js'
import type { PydanticDiagnostic } from './ir.js'
import type { ResolvedPydanticBuildOptions } from './options.js'

export interface PreparedPydanticDocument {
  document: OasDocument
  schemas: Record<string, OasSchema>
  /** Preflight findings that did not stop generation (all of them when `force` is set), as `pydantic/preflight`. */
  diagnostics: PydanticDiagnostic[]
}

export class PydanticGenerationPreflightError extends Error {
  readonly diagnostics: LintResult[]

  constructor(diagnostics: LintResult[]) {
    const lines = diagnostics.map(d => `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${d.path})`)
    const count = `${diagnostics.length} issue(s)`
    const summary = `Pydantic code generation aborted due to preflight validation failure (${count})`
    super(`${summary}:\n${lines.join('\n')}`)
    this.name = 'PydanticGenerationPreflightError'
    this.diagnostics = diagnostics
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function preparePydanticDocument(
  doc: unknown,
  preflight: ResolvedPydanticBuildOptions['preflight'],
): PreparedPydanticDocument {
  const { force, ...codegenPreflight } = preflight
  const prepared = prepareCodegenDocument(doc, codegenPreflight)
  if (prepared.fatal.length > 0 && !force) throw new PydanticGenerationPreflightError(prepared.fatal)

  return {
    document: prepared.document,
    schemas: prepared.schemas,
    diagnostics: prepared.diagnostics.map(d => ({
      code: 'pydantic/preflight',
      severity: d.severity,
      pointer: d.path,
      message: `[${d.rule}] ${d.message}`,
    })),
  }
}
