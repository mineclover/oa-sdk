/**
 * Pipeline composition S0 → S6. Every stage is also exported on its own.
 */
import type { TspGeneratedFile } from '../plugin/types.js'
import { analyzeSchemaGraph, type SchemaGraphAnalysis } from '../schema-graph/index.js'
import { emitPydanticFiles, type PydanticBuildReport } from './emit.js'
import type { PyModuleIR, PydanticDiagnostic } from './ir.js'
import { lowerToPyIr } from './lower.js'
import { resolvePydanticBuildOptions, type PydanticBuildOptions, type ResolvedPydanticBuildOptions } from './options.js'
import { runPyPasses } from './passes/index.js'
import { preparePydanticDocument } from './prepare.js'
import { renderPyModule } from './render.js'

export interface PydanticBuildResult {
  options: ResolvedPydanticBuildOptions
  analysis: SchemaGraphAnalysis
  /** IR after all passes. */
  ir: PyModuleIR
  /** Module source without the banner. */
  source: string
  files: TspGeneratedFile[]
  report: PydanticBuildReport
  diagnostics: PydanticDiagnostic[]
}

export function pydanticModuleName(output: string): string {
  const base = output.split('/').pop() ?? output
  return base.endsWith('.py') ? base.slice(0, -3) : base
}

export function buildPydanticModels(doc: unknown, input: PydanticBuildOptions = {}): PydanticBuildResult {
  const options = resolvePydanticBuildOptions(input)
  const prepared = preparePydanticDocument(doc, options.preflight)
  const analysis = analyzeSchemaGraph(prepared.schemas)
  const lowered = lowerToPyIr(prepared, analysis, pydanticModuleName(options.output))
  const { ir } = runPyPasses(lowered, options, analysis)
  const source = renderPyModule(ir)
  const { files, report } = emitPydanticFiles(source, ir, options)
  return { options, analysis, ir, source, files, report, diagnostics: ir.diagnostics }
}
