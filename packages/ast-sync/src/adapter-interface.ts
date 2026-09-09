import type { EntitySpec, ASTDiff, TextEdit } from './entity-spec.js';

/**
 * Pluggable Type Adapter Interface for V3 Unified Architecture.
 * Supports reading/parsing from source syntax, writing/emitting code,
 * diffing EntitySpec representations, and generating/applying patches.
 */
export interface TypeAdapter<TSource = string, TTarget = string> {
  /** Unique name of the adapter (e.g. 'zod', 'ts-ast', 'typia') */
  readonly name: string;

  /** Dialects supported by this adapter (e.g. ['zod', 'zod/v3', 'zod/v4'], ['typescript', 'ts-interface'], ['typia']) */
  readonly supportedDialects: string[];

  /**
   * Parse/read source representation (AST node or source code string) into normalized EntitySpec.
   */
  read(source: TSource): EntitySpec;

  /**
   * Alias for read.
   */
  parse(source: TSource): EntitySpec;

  /**
   * Write/emit normalized EntitySpec back into target representation.
   */
  write(spec: EntitySpec, originalSource?: TSource): TTarget;

  /**
   * Alias for write.
   */
  emit(spec: EntitySpec, originalSource?: TSource): TTarget;

  /**
   * Compute syntactic and semantic diff between two revisions of an EntitySpec.
   */
  diff?(a: EntitySpec, b: EntitySpec): ASTDiff[];

  /**
   * Generate text edits or patched source code applying targetSpec changes to originalSource.
   */
  patch?(originalSource: string, targetSpec: EntitySpec, diffs?: ASTDiff[]): string | TextEdit[];
}
