import ts from 'typescript'

export interface SyntaxValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates TypeScript source code syntax using the TypeScript compiler API.
 * Ensures the generated code has 0 parse diagnostics and 0 syntax errors.
 */
export function validateTsSyntax(sourceText: string, fileName = 'generated.ts'): SyntaxValidationResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    ts.ScriptKind.TS,
  )

  const parseDiagnostics = (sourceFile as any).parseDiagnostics || []
  const errors: string[] = []

  for (const diag of parseDiagnostics) {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
    const pos = sourceFile.getLineAndCharacterOfPosition(diag.start || 0)
    errors.push(`[Line ${pos.line + 1}, Col ${pos.character + 1}]: ${message}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Transpiles the given TypeScript code to JavaScript using ts.transpileModule.
 * Catches compiler syntactic errors.
 */
export function validateTranspilation(sourceText: string): { success: boolean; outputText?: string; error?: string } {
  try {
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    return {
      success: true,
      outputText: result.outputText,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    }
  }
}
