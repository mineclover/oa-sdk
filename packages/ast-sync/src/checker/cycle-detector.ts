/**
 * Checker-Resolved Symbol ID Cycle Detection
 *
 * Implements precision circular reference detection across multi-file TypeScript programs
 * utilizing ts.TypeChecker symbol resolution and canonical symbol IDs.
 *
 * Resolves re-export barrel chains, aliased imports, self-recursions, and multi-node cycles.
 */

import ts from 'typescript';
import {
  type ContractShapeFeature,
  type ContractTypeShape,
} from '../taxonomy/features.js';
import { classifyTypeShape, collectShapeFeatures } from '../taxonomy/analyzer.js';
import { getProgramTempDir } from './program.js';

export interface SymbolCycleResult {
  readonly schemaDependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly cyclicSchemaIds: ReadonlySet<string>;
  readonly symbolIdMap: ReadonlyMap<number, string>;
  readonly declarationShapes?: ReadonlyMap<string, ContractTypeShape>;
}

let symbolIdCounter = 1;
const symbolToIdMap = new WeakMap<ts.Symbol, number>();

/** TypeScript's binder keeps a numeric `id` on symbols, outside the public type. */
type SymbolWithInternalId = ts.Symbol & { id?: unknown };

function readInternalSymbolId(symbol: ts.Symbol): number | undefined {
  const id = (symbol as SymbolWithInternalId).id;
  return typeof id === 'number' && id > 0 ? id : undefined;
}

/** Reads the name of a declaration when it is a plain identifier. */
function declarationName(declaration: ts.Declaration): string | undefined {
  const name = (declaration as ts.NamedDeclaration).name;
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

/**
 * Extract a unique, canonical positive integer symbol ID.
 *
 * Uses TypeScript's internal binder symbol.id if available, with a WeakMap
 * fallback guaranteeing unique deterministic identity.
 */
export function getCanonicalSymbolId(symbol: ts.Symbol): number {
  const internalId = readInternalSymbolId(symbol);
  if (internalId !== undefined) return internalId;
  let id = symbolToIdMap.get(symbol);
  if (id === undefined) {
    id = symbolIdCounter++;
    symbolToIdMap.set(symbol, id);
    try {
      (symbol as SymbolWithInternalId).id = id;
    } catch {
      // Ignore if symbol object is sealed
    }
  }
  return id;
}

/**
 * Resolves aliased symbols (e.g. from imports and re-exports) to their canonical declaration symbol.
 *
 * Peels away import and export aliases in a loop until reaching the root definition symbol.
 */
export function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  let current = symbol;
  const visited = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const next = checker.getAliasedSymbol(current);
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

/**
 * Traverses a TypeScript AST node and returns all canonical symbols referenced inside it.
 */
export function referencedSymbols(node: ts.Node, checker: ts.TypeChecker): readonly ts.Symbol[] {
  const symbols = new Map<number, ts.Symbol>();

  const visit = (current: ts.Node): void => {
    if (ts.isTypeReferenceNode(current)) {
      const targetNode = ts.isQualifiedName(current.typeName) ? current.typeName.right : current.typeName;
      const symbol = checker.getSymbolAtLocation(targetNode) ?? checker.getSymbolAtLocation(current.typeName);
      if (symbol !== undefined) {
        const resolved = resolveAlias(symbol, checker);
        const id = getCanonicalSymbolId(resolved);
        symbols.set(id, resolved);
      }
    } else if (ts.isExpressionWithTypeArguments(current)) {
      const expr = current.expression;
      const targetNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
      const symbol = checker.getSymbolAtLocation(targetNode) ?? checker.getSymbolAtLocation(expr);
      if (symbol !== undefined) {
        const resolved = resolveAlias(symbol, checker);
        const id = getCanonicalSymbolId(resolved);
        symbols.set(id, resolved);
      }
    }
    current.forEachChild(visit);
  };

  // Only visit children of the declaration (members, type arguments, heritage clauses)
  node.forEachChild(visit);

  return [...symbols.values()];
}

/**
 * Normalizes a source file declaration into a standard identifier `<normalizedFilePath>:<name>`.
 */
export function getNormalizedDeclarationId(
  sourceFile: ts.SourceFile,
  name: string,
  tempDir?: string
): string {
  let fileName = sourceFile.fileName.replace(/\\/g, '/');
  if (tempDir) {
    const normTemp = tempDir.replace(/\\/g, '/');
    if (fileName.startsWith(normTemp)) {
      fileName = fileName.slice(normTemp.length);
      if (!fileName.startsWith('/')) {
        fileName = '/' + fileName;
      }
    }
  }
  return `${fileName}:${name}`;
}

/**
 * Executes precision directed DFS cycle detection on a dependency graph.
 *
 * Returns the set of declaration identifiers that participate in at least one cycle.
 */
export function cyclicSchemaIds(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> {
  const result = new Set<string>();

  for (const start of dependencies.keys()) {
    const visited = new Set<string>();

    const visit = (current: string): boolean => {
      if (current === start && visited.size > 0) {
        return true;
      }
      if (visited.has(current)) {
        return false;
      }
      visited.add(current);
      const outgoing = dependencies.get(current) ?? [];
      return [...outgoing].some(visit);
    };

    if (visit(start)) {
      result.add(start);
    }
  }

  return result;
}

/**
 * Augments a ContractTypeShape with the 'recursive-reference' feature.
 */
export function withRecursiveReference(shape: ContractTypeShape): ContractTypeShape {
  const features = new Set(shape.features);
  features.add('recursive-reference');
  return classifyTypeShape(features);
}

/**
 * Alias for withRecursiveReference.
 */
export const markRecursiveDeclaration = withRecursiveReference;

/**
 * Analyzes a multi-file ts.Program to build a directed symbol dependency graph
 * and detect circular type references using TypeChecker symbol identity.
 *
 * Detects mutual recursions spanning across module re-exports, barrel files,
 * aliased imports, self-recursions, and diamond inheritance.
 *
 * @param program Initialized ts.Program instance
 * @param sourceFiles Optional subset of source files to analyze (defaults to non-declaration files)
 * @returns SymbolCycleResult with dependency graph, cyclic schema IDs, and symbol ID mapping
 */
export function detectCyclesWithChecker(
  program: ts.Program,
  sourceFiles?: readonly ts.SourceFile[]
): SymbolCycleResult {
  const checker = program.getTypeChecker();
  const files = sourceFiles ?? program.getSourceFiles().filter((f) => !f.isDeclarationFile);
  const tempDir = getProgramTempDir(program);

  const symbolIdMap = new Map<number, string>();
  const declarationSymbols = new Map<string, ts.Symbol>();
  const schemaDependencies = new Map<string, Set<string>>();
  const declarationNodes = new Map<string, ts.Declaration>();

  // 1. Index all schema declarations (interfaces, type aliases, classes, enums)
  for (const sourceFile of files) {
    for (const statement of sourceFile.statements) {
      if (
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name &&
        ts.isIdentifier(statement.name)
      ) {
        const symbol = checker.getSymbolAtLocation(statement.name);
        if (symbol) {
          const resolved = resolveAlias(symbol, checker);
          const symbolId = getCanonicalSymbolId(resolved);
          const declId = getNormalizedDeclarationId(sourceFile, statement.name.text, tempDir);
          symbolIdMap.set(symbolId, declId);
          declarationSymbols.set(declId, resolved);
          declarationNodes.set(declId, statement);
          if (!schemaDependencies.has(declId)) {
            schemaDependencies.set(declId, new Set<string>());
          }
        }
      }
    }
  }

  // 2. Build directed reference edges using resolved canonical symbol IDs
  for (const sourceFile of files) {
    for (const statement of sourceFile.statements) {
      if (
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name &&
        ts.isIdentifier(statement.name)
      ) {
        const declId = getNormalizedDeclarationId(sourceFile, statement.name.text, tempDir);
        const deps = schemaDependencies.get(declId);
        if (!deps) continue;

        const refs = referencedSymbols(statement, checker);
        for (const ref of refs) {
          const refId = getCanonicalSymbolId(ref);
          const targetDeclId = symbolIdMap.get(refId);
          if (targetDeclId !== undefined) {
            deps.add(targetDeclId);
          }
        }
      }
    }
  }

  // 3. Precision directed DFS cycle detection
  const detectedCycles = cyclicSchemaIds(schemaDependencies);

  // 4. Mark recursive declarations with 'recursive-reference' ContractShapeFeature
  const declarationShapes = new Map<string, ContractTypeShape>();
  const cyclicDeclNames = new Set<string>();
  for (const id of detectedCycles) {
    const colonIdx = id.lastIndexOf(':');
    if (colonIdx >= 0) {
      cyclicDeclNames.add(id.slice(colonIdx + 1));
    }
  }

  for (const [declId, declNode] of declarationNodes.entries()) {
    const features = new Set<ContractShapeFeature>();
    const isCyclic = detectedCycles.has(declId);

    const currentName = declarationName(declNode);
    collectShapeFeatures(declNode, features, {
      ...(currentName !== undefined ? { currentName } : {}),
      cyclicNames: cyclicDeclNames,
    });

    if (isCyclic) {
      features.add('recursive-reference');
    }

    declarationShapes.set(declId, classifyTypeShape(features));
  }

  return {
    schemaDependencies,
    cyclicSchemaIds: detectedCycles,
    symbolIdMap,
    declarationShapes,
  };
}
