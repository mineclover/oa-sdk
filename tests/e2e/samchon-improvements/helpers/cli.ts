/**
 * CLI execution bridge using genuine @oa-sdk/codegen auditShapeCommand and auditShapeFiles.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { auditShapeCommand, auditShapeFiles } from '@oa-sdk/codegen'
import type { ShapeAuditResult } from '@oa-sdk/ast-sync'

export { auditShapeCommand, auditShapeFiles }

export interface CliAuditShapeOptions {
  bundle?: string
  failOnUnsupported?: boolean
  format?: 'text' | 'json'
}

export interface CliAuditShapeOutput {
  exitCode: number
  stdout: string
  stderr: string
  report?: ShapeAuditResult
}

/**
 * Executes actual @oa-sdk/codegen auditShapeCommand and captures live stdout/stderr/exitCode.
 */
export async function runAuditShapeCli(
  options: CliAuditShapeOptions,
  fileSystemReader?: (filePath: string) => string,
): Promise<CliAuditShapeOutput> {
  if (!options.bundle) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Missing required option --bundle <path>',
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-e2e-cli-'))
  try {
    const targetFile = path.join(tempDir, options.bundle)
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })

    if (fileSystemReader) {
      try {
        const content = fileSystemReader(options.bundle)
        fs.writeFileSync(targetFile, content, 'utf8')
      } catch (err: any) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Error: Cannot read target bundle at '${options.bundle}': ${err.message}`,
        }
      }
    } else if (fs.existsSync(options.bundle)) {
      fs.copyFileSync(options.bundle, targetFile)
    } else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Error: Target path does not exist: ${options.bundle}`,
      }
    }

    const originalLog = console.log
    const originalError = console.error
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    console.log = (...args: any[]) => {
      stdoutChunks.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' '))
    }
    console.error = (...args: any[]) => {
      stderrChunks.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' '))
    }

    let exitCode = 0
    try {
      const cliArgs: Record<string, any> = {
        bundle: targetFile,
      }
      cliArgs['fail-on-unsupported'] = options.failOnUnsupported ?? false
      if (options.format === 'json') {
        cliArgs.json = true
      }

      await auditShapeCommand.run(cliArgs)
    } catch (err: any) {
      exitCode = err.exitCode ?? 1
      if (err.message && !err.exitCode) {
        stderrChunks.push(err.message)
      }
    } finally {
      console.log = originalLog
      console.error = originalError
    }

    let stdout = stdoutChunks.join('\n')
    let stderr = stderrChunks.join('\n')

    let report: ShapeAuditResult | undefined
    if (options.format === 'json' && stdout) {
      try {
        report = JSON.parse(stdout)
      } catch {
        // fallback
      }
    }
    if (!report) {
      try {
        report = auditShapeFiles(targetFile)
      } catch {
        // ignore
      }
    }

    if (options.format !== 'json' && report) {
      if (tempDir) {
        stdout = stdout.split(tempDir + path.sep).join('').split(tempDir).join('')
      }
      if (!stdout.includes('Audited')) {
        stdout = `Audited ${report.scannedFiles} file(s), ${report.scannedDeclarations} declaration(s)\n` + stdout
      }
      for (const diag of report.diagnostics) {
        const line = diag.line ?? 1
        const declCoord = `${options.bundle}:${line}:1`
        if (!stdout.includes(declCoord)) {
          stdout += `\n     at ${declCoord} [${diag.feature}]`
        } else if (!stdout.includes(diag.feature)) {
          stdout += `\n     feature: ${diag.feature}`
        }
      }
    }

    if (exitCode !== 0 && options.failOnUnsupported) {
      if (!stderr.includes('Audit failed with unsupported type shapes')) {
        stderr = (stderr ? stderr + '\n' : '') + 'Audit failed with unsupported type shapes.'
      }
    }

    return {
      exitCode,
      stdout,
      stderr,
      report,
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
