/**
 * `oa-gen audit:shape`의 스캔 로직.
 *
 * `@oa-sdk/ast-sync`(진입 시 TypeScript 컴파일러 전체를 불러온다)에 의존하므로 커맨드 모듈과 분리해 두고,
 * 커맨드는 실행할 때만 이 모듈을 불러온다. 그래야 다른 oa-gen 커맨드의 기동에 TypeScript 로드 비용이 붙지 않는다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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
