/**
 * V3 Unified Architecture: TypeScript AST Bidirectional Synchronization
 *
 * Provides zero-loss bidirectional sync between EntitySpec IR and source code,
 * supporting pluggable adapters (Zod, TS AST, Typia), reverse-offset TextEdit patching,
 * and comment / formatting retention.
 */

export * from './entity-spec.js';
export * from './adapter-interface.js';
export * from './diff-engine.js';
export * from './text-edit.js';
export * from './type-sync.js';
export * from './adapters/zod.js';
export * from './adapters/ts-ast.js';
export * from './adapters/typia.js';
export * from './guards/index.js';
