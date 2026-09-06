import type { TypeAdapter } from './adapter-interface.js';
import type { EntitySpec, ASTDiff, TextEdit } from './entity-spec.js';
import { computeEntitySpecDiff } from './diff-engine.js';
import { ZodTypeAdapter } from './adapters/zod.js';
import { TsAstTypeAdapter } from './adapters/ts-ast.js';
import { TypiaTypeAdapter } from './adapters/typia.js';

export interface SyncOptions {
  /**
   * Type adapter to use (by name e.g. 'zod', 'ts-ast', 'typia' or direct TypeAdapter instance).
   * If omitted, adapter is automatically detected from existingCode.
   */
  adapter?: string | TypeAdapter;
}

export interface SyncResult {
  /** Patched or emitted source code */
  code: string;
  /** List of semantic and structural differences applied */
  diffs: ASTDiff[];
  /** Optional list of TextEdits applied during surgical patching */
  edits?: TextEdit[];
  /** Final synchronized EntitySpec representation */
  spec: EntitySpec;
}

/**
 * Detects the appropriate TypeAdapter from the code content.
 */
function resolveAdapter(existingCode: string, optionAdapter?: string | TypeAdapter): TypeAdapter {
  if (typeof optionAdapter === 'object' && optionAdapter !== null && 'read' in optionAdapter && 'write' in optionAdapter) {
    return optionAdapter;
  }

  if (typeof optionAdapter === 'string') {
    const key = optionAdapter.toLowerCase();
    if (key.startsWith('zod')) {
      return new ZodTypeAdapter();
    }
    if (key === 'typia' || key === 'typescript-jsdoc' || key.startsWith('typia')) {
      return new TypiaTypeAdapter();
    }
    if (key.includes('ts') || key === 'typescript' || key === 'interface') {
      return new TsAstTypeAdapter();
    }
  }

  // Auto-detection from code content
  if (existingCode.includes('z.object') || /from\s+['"]zod['"]/.test(existingCode)) {
    return new ZodTypeAdapter();
  }

  if (
    existingCode.includes('@minimum') ||
    existingCode.includes('@maximum') ||
    existingCode.includes('@format') ||
    existingCode.includes('@default') ||
    /\b(?:tags\.|typia\.tags\.)/i.test(existingCode) ||
    /from\s+['"]typia(?:\/.*)?['"]/.test(existingCode)
  ) {
    return new TypiaTypeAdapter();
  }

  // Default to standard TypeScript AST adapter
  return new TsAstTypeAdapter();
}

/**
 * Synchronizes an existing code snippet with an updated EntitySpec representation.
 * Computes structural differences, performs reverse-offset TextEdit patching,
 * and guarantees zero loss of formatting, comments, and trivia.
 */
export function syncEntitySpecWithCode(
  existingCode: string,
  updatedSpec: EntitySpec,
  options?: SyncOptions
): SyncResult {
  const adapter = resolveAdapter(existingCode, options?.adapter);
  const currentSpec = adapter.read(existingCode);
  const diffs = computeEntitySpecDiff(currentSpec, updatedSpec);

  if (diffs.length === 0) {
    return {
      code: existingCode,
      diffs: [],
      edits: [],
      spec: updatedSpec,
    };
  }

  const updatedCode = adapter.write(updatedSpec, existingCode);

  return {
    code: updatedCode,
    diffs,
    spec: updatedSpec,
  };
}
