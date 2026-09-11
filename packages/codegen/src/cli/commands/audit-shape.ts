import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from '../lib/types.js';
import { optStr, bool } from '../lib/args.js';
import { CliExitError } from '../lib/errors.js';
import {
  auditTypeShapesInSource,
  type ShapeAuditResult,
  type ShapeDiagnostic,
} from '@oa-sdk/ast-sync';

/**
 * Find all TypeScript source files recursively under a path,
 * excluding declarations (.d.ts), node_modules, and build outputs.
 */
export function findTypeScriptFiles(targetPath: string): string[] {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return [targetPath];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      results.push(...findTypeScriptFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * Audit all TypeScript files in a directory or single file for type shape feasibility.
 */
export function auditShapeFiles(targetPath: string): ShapeAuditResult {
  const files = findTypeScriptFiles(targetPath);
  const allDiagnostics: ShapeDiagnostic[] = [];
  let totalDeclarations = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const result = auditTypeShapesInSource(content, file);
    totalDeclarations += result.scannedDeclarations;
    allDiagnostics.push(...result.diagnostics);
  }

  const errors = allDiagnostics.filter((d) => d.severity === 'error');
  const warnings = allDiagnostics.filter((d) => d.severity === 'warning');
  const valid = errors.length === 0;

  const summary = valid
    ? warnings.length === 0
      ? `✅ 0 shape issues found across ${totalDeclarations} declaration(s) in ${files.length} file(s). Fully direct TypeSpec/OpenAPI projection.`
      : `⚠️ 0 unsupported shapes, ${warnings.length} policy-required shape(s) found across ${totalDeclarations} declaration(s) in ${files.length} file(s).`
    : `❌ ${errors.length} unsupported shape(s), ${warnings.length} policy-required shape(s) found across ${totalDeclarations} declaration(s) in ${files.length} file(s).`;

  return {
    valid,
    scannedDeclarations: totalDeclarations,
    scannedFiles: files.length,
    diagnostics: allDiagnostics,
    summary,
  };
}

export const auditShapeCommand: Command = {
  name: 'audit:shape',
  description: 'TypeScript AST 타입 형태 분류 및 TypeSpec/OpenAPI 투영 가능성 진단 감사',
  options: {
    bundle: {
      type: 'string',
      short: 'b',
      description: '번들 디렉토리 또는 TypeScript 파일 경로',
    },
    source: {
      type: 'string',
      short: 's',
      description: '단일 검사 대상 TypeScript 소스 파일 경로',
    },
    'fail-on-unsupported': {
      type: 'boolean',
      description: 'unsupported 타입 발견 시 exit 1 종료 (기본값: true)',
    },
    'no-fail-on-unsupported': {
      type: 'boolean',
      description: 'unsupported 타입이 있어도 exit 1로 종료하지 않음',
    },
    json: {
      type: 'boolean',
      description: '결과를 JSON 포맷으로 출력',
    },
  },
  async run(args) {
    const targetPath = optStr(args, 'bundle') ?? optStr(args, 'source') ?? optStr(args, 'file');
    if (!targetPath) {
      throw new Error('Target path must be specified via --bundle or --source');
    }

    const isJson = bool(args, 'json');
    const noFail = bool(args, 'no-fail-on-unsupported');
    const failOnUnsupported = !noFail && args['fail-on-unsupported'] !== false && args['failOnUnsupported'] !== false;

    const result = auditShapeFiles(targetPath);

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('━━━ TypeScript Shape Feasibility Audit ━━━');
      console.log(`Target: ${targetPath}`);

      for (const diag of result.diagnostics) {
        const icon = diag.severity === 'error' ? '❌' : '⚠️';
        console.log(`  ${icon} [${diag.code}] ${diag.message}`);
        console.log(`     at ${diag.file}:${diag.line}:${diag.column}`);
        if (diag.snippet) {
          console.log(`     > ${diag.snippet}`);
        }
      }

      console.log(`\n${result.summary}`);
    }

    if (!result.valid && failOnUnsupported) {
      throw new CliExitError(1);
    }
  },
};

export { auditShapeCommand as auditShape };
export default auditShapeCommand;
