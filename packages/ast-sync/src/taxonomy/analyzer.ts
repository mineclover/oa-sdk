import ts from 'typescript';
import {
  type ContractShapeFeature,
  type ContractTypeShape,
  type ShapeAuditResult,
  type ShapeDiagnostic,
  type TypeSpecProjection,
  UNSUPPORTED_SHAPE_FEATURES,
  POLICY_REQUIRED_SHAPE_FEATURES,
  UTILITY_TYPE_NAMES,
} from './features.js';

export interface AnalyzeShapeOptions {
  readonly currentName?: string;
  readonly cyclicNames?: ReadonlySet<string>;
  readonly isOptional?: boolean;
}

/**
 * Classify a set of TypeScript syntax features into a ContractTypeShape with
 * tripartite TypeSpec / OpenAPI projection feasibility ('direct' | 'policy-required' | 'unsupported').
 *
 * Hierarchy:
 * - 'unsupported': If ANY feature is unsupported (e.g. conditional, mapped, indexed-access)
 * - 'policy-required': If ANY feature requires an explicit TypeAdapter policy (e.g. tuple, undefined, generic-instantiation)
 * - 'direct': Fully projectable standard shapes (primitives, objects, unions, intersections, arrays)
 */
export function classifyTypeShape(features: ReadonlySet<ContractShapeFeature>): ContractTypeShape {
  const sorted = ([...features] as ContractShapeFeature[]).sort();
  const typeSpecProjection: TypeSpecProjection = sorted.some((f) => UNSUPPORTED_SHAPE_FEATURES.has(f))
    ? 'unsupported'
    : sorted.some((f) => POLICY_REQUIRED_SHAPE_FEATURES.has(f))
      ? 'policy-required'
      : 'direct';
  return { features: sorted, typeSpecProjection };
}

/**
 * Extract the trailing identifier name from a TypeScript EntityName.
 */
function getEntityNameText(name: ts.EntityName): string {
  if (ts.isIdentifier(name)) return name.text;
  return name.right.text;
}

/**
 * Collect syntax shape features recursively from a TypeScript AST node.
 */
export function collectShapeFeatures(
  node: ts.Node,
  features: Set<ContractShapeFeature>,
  options: AnalyzeShapeOptions = {}
): void {
  const { currentName, cyclicNames, isOptional } = options;

  if (isOptional) {
    features.add('optional');
  }

  // 1. Property signature optionality & members
  if (ts.isPropertySignature(node) && node.questionToken !== undefined) {
    features.add('optional');
  }
  if (ts.isOptionalTypeNode(node)) {
    features.add('optional');
  }

  // 2. Unions and Intersections
  if (ts.isUnionTypeNode(node)) {
    features.add('union');
  }
  if (ts.isIntersectionTypeNode(node)) {
    features.add('intersection');
  }

  // 3. Arrays and Tuples
  if (ts.isArrayTypeNode(node)) {
    features.add('array');
  }
  if (ts.isTupleTypeNode(node)) {
    features.add('tuple');
  }

  // 4. Objects and Literals
  if (ts.isTypeLiteralNode(node)) {
    features.add('object');
  }
  if (ts.isLiteralTypeNode(node)) {
    features.add('literal');
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) {
      features.add('nullable');
    }
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    features.add('nullable');
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
    features.add('undefined');
  }

  // 5. Conditionals & Mapped Types
  if (ts.isConditionalTypeNode(node)) {
    features.add('conditional');
  }
  if (ts.isMappedTypeNode(node)) {
    features.add('mapped');
    if (node.questionToken !== undefined) {
      features.add('optional');
    }
  }

  // 6. Access and Operators
  if (ts.isIndexedAccessTypeNode(node)) {
    features.add('indexed-access');
  }
  if (ts.isTypeOperatorNode(node)) {
    features.add('type-operator');
  }
  if (ts.isTypeQueryNode(node)) {
    features.add('type-query');
  }

  // 7. Functions and Constructors
  if (ts.isFunctionTypeNode(node) || ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node)) {
    features.add('function-type');
  }
  if (ts.isConstructorTypeNode(node) || ts.isConstructSignatureDeclaration(node)) {
    features.add('constructor-type');
  }

  // 8. Template Literals and Imports
  if (ts.isTemplateLiteralTypeNode(node)) {
    features.add('template-literal');
  }
  if (ts.isImportTypeNode(node)) {
    features.add('import-type');
  }

  // 9. Declarations: Interfaces, Type Aliases, Classes
  if (ts.isInterfaceDeclaration(node)) {
    features.add('object');
    if (node.typeParameters && node.typeParameters.length > 0) {
      features.add('generic-declaration');
    }
    if (node.heritageClauses && node.heritageClauses.length > 0) {
      features.add('inheritance');
    }
  }
  if (ts.isTypeAliasDeclaration(node)) {
    if (node.typeParameters && node.typeParameters.length > 0) {
      features.add('generic-declaration');
    }
  }
  if (ts.isClassDeclaration(node)) {
    features.add('object');
    if (node.typeParameters && node.typeParameters.length > 0) {
      features.add('generic-declaration');
    }
    if (node.heritageClauses && node.heritageClauses.length > 0) {
      features.add('inheritance');
    }
  }
  if (ts.isHeritageClause(node)) {
    features.add('inheritance');
  }

  // 10. References and Generic Instantiation
  if (ts.isTypeReferenceNode(node)) {
    features.add('reference');
    if (node.typeArguments && node.typeArguments.length > 0) {
      features.add('generic-instantiation');
    }
    const typeName = getEntityNameText(node.typeName);
    if (UTILITY_TYPE_NAMES.has(typeName)) {
      features.add('utility-type');
    }
    if (currentName !== undefined && typeName === currentName) {
      features.add('recursive-reference');
    }
    if (cyclicNames !== undefined && cyclicNames.has(typeName)) {
      features.add('recursive-reference');
    }
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    features.add('reference');
    if (node.typeArguments && node.typeArguments.length > 0) {
      features.add('generic-instantiation');
    }
    if (ts.isIdentifier(node.expression)) {
      const exprName = node.expression.text;
      if (currentName !== undefined && exprName === currentName) {
        features.add('recursive-reference');
      }
      if (cyclicNames !== undefined && cyclicNames.has(exprName)) {
        features.add('recursive-reference');
      }
    }
  }

  // Traverse children
  node.forEachChild((child) => {
    collectShapeFeatures(child, features, options);
  });
}

/**
 * Analyze a single AST node and return its classified ContractTypeShape.
 */
export function analyzeNodeShape(node: ts.Node, options: AnalyzeShapeOptions = {}): ContractTypeShape {
  const features = new Set<ContractShapeFeature>();
  collectShapeFeatures(node, features, options);
  return classifyTypeShape(features);
}

/**
 * Map of declared type names to their AST declarations and reference dependencies.
 */
interface DeclarationInfo {
  readonly name: string;
  readonly declaration: ts.Declaration;
  readonly references: Set<string>;
}

/**
 * Scan a TypeScript SourceFile for named declarations and find mutual reference cycles.
 */
function findCyclicDeclarationNames(sourceFile: ts.SourceFile): {
  readonly declarations: Map<string, DeclarationInfo>;
  readonly cyclicNames: Set<string>;
} {
  const declarations = new Map<string, DeclarationInfo>();

  for (const stmt of sourceFile.statements) {
    let name: string | undefined;
    let decl: ts.Declaration | undefined;

    if (ts.isInterfaceDeclaration(stmt)) {
      name = stmt.name.text;
      decl = stmt;
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      name = stmt.name.text;
      decl = stmt;
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      name = stmt.name.text;
      decl = stmt;
    } else if (ts.isEnumDeclaration(stmt)) {
      name = stmt.name.text;
      decl = stmt;
    }

    if (name && decl) {
      declarations.set(name, {
        name,
        declaration: decl,
        references: new Set<string>(),
      });
    }
  }

  // Collect references for each declaration
  for (const [declName, info] of declarations.entries()) {
    const visit = (n: ts.Node) => {
      if (ts.isTypeReferenceNode(n)) {
        const refName = getEntityNameText(n.typeName);
        if (declarations.has(refName)) {
          info.references.add(refName);
        }
      } else if (ts.isExpressionWithTypeArguments(n)) {
        if (ts.isIdentifier(n.expression)) {
          const refName = n.expression.text;
          if (declarations.has(refName)) {
            info.references.add(refName);
          }
        }
      }
      n.forEachChild(visit);
    };
    info.declaration.forEachChild(visit);
  }

  // Directed DFS cycle detection
  const cyclicNames = new Set<string>();
  for (const start of declarations.keys()) {
    const visited = new Set<string>();
    const visit = (current: string): boolean => {
      if (current === start && visited.size > 0) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      const nexts = declarations.get(current)?.references;
      if (nexts) {
        for (const next of nexts) {
          if (visit(next)) return true;
        }
      }
      return false;
    };
    if (visit(start)) {
      cyclicNames.add(start);
    }
  }

  return { declarations, cyclicNames };
}

/**
 * Format source line/column coordinates and extract snippet for a diagnostic.
 */
function createDiagnosticAtNode(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  lines: string[],
  feature: ContractShapeFeature,
  code: 'unsupported-shape' | 'policy-required-shape',
  severity: 'error' | 'warning',
  message: string
): ShapeDiagnostic {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startPos = sourceFile.getLineAndCharacterOfPosition(start);
  const endPos = sourceFile.getLineAndCharacterOfPosition(end);
  const line = startPos.line + 1;
  const column = startPos.character + 1;
  const endLine = endPos.line + 1;
  const endColumn = endPos.character + 1;
  const snippet = lines[startPos.line]?.trim() ?? '';

  return {
    code,
    message,
    file: filePath,
    line,
    column,
    endLine,
    endColumn,
    feature,
    snippet,
    severity,
  };
}

/**
 * Audit type shapes in a TypeScript source string and emit structured diagnostics.
 *
 * Scans all interface, type alias, and class declarations for unsupported and policy-required
 * syntax features, pinpointing line/column coordinates and code snippets.
 */
export function auditTypeShapesInSource(sourceText: string, filePath = 'source.ts'): ShapeAuditResult {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = sourceText.split(/\r?\n/);
  const { declarations, cyclicNames } = findCyclicDeclarationNames(sourceFile);

  const diagnostics: ShapeDiagnostic[] = [];
  const seenDiagKeys = new Set<string>();

  function recordDiagnostic(diag: ShapeDiagnostic) {
    const key = `${diag.code}:${diag.feature}:${diag.line}:${diag.column}`;
    if (!seenDiagKeys.has(key)) {
      seenDiagKeys.add(key);
      diagnostics.push(diag);
    }
  }

  let scannedCount = 0;

  for (const [name, info] of declarations.entries()) {
    scannedCount++;
    const decl = info.declaration;

    // Check generic declaration on interface/type-alias
    if (
      (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl) || ts.isClassDeclaration(decl)) &&
      decl.typeParameters &&
      decl.typeParameters.length > 0
    ) {
      recordDiagnostic(
        createDiagnosticAtNode(
          sourceFile,
          filePath,
          decl.typeParameters[0]!,
          lines,
          'generic-declaration',
          'policy-required-shape',
          'warning',
          `Declaration '${name}' introduces 'generic-declaration' which requires an explicit TypeAdapter authoring policy.`
        )
      );
    }

    // Traverse children within declaration to find specific problematic nodes
    const checkNode = (n: ts.Node) => {
      // 1. Unsupported features
      if (ts.isConditionalTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'conditional',
            'unsupported-shape',
            'error',
            `Conditional type is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isMappedTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'mapped',
            'unsupported-shape',
            'error',
            `Mapped type is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isIndexedAccessTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'indexed-access',
            'unsupported-shape',
            'error',
            `Indexed access type '${n.getText(sourceFile)}' is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isTypeOperatorNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'type-operator',
            'unsupported-shape',
            'error',
            `Type operator '${n.getText(sourceFile)}' is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isTypeQueryNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'type-query',
            'unsupported-shape',
            'error',
            `Type query '${n.getText(sourceFile)}' is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isFunctionTypeNode(n) || ts.isMethodSignature(n) || ts.isCallSignatureDeclaration(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'function-type',
            'unsupported-shape',
            'error',
            `Function/method type is not directly projectable to TypeSpec/OpenAPI schema models.`
          )
        );
      } else if (ts.isConstructorTypeNode(n) || ts.isConstructSignatureDeclaration(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'constructor-type',
            'unsupported-shape',
            'error',
            `Constructor type is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isTemplateLiteralTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'template-literal',
            'unsupported-shape',
            'error',
            `Template literal type is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      } else if (ts.isImportTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'import-type',
            'unsupported-shape',
            'error',
            `Import type is not directly projectable to TypeSpec/OpenAPI.`
          )
        );
      }

      // 2. Policy-required features
      if (ts.isTupleTypeNode(n)) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'tuple',
            'policy-required-shape',
            'warning',
            `Tuple type '${n.getText(sourceFile)}' requires explicit TypeAdapter authoring policy.`
          )
        );
      } else if (n.kind === ts.SyntaxKind.UndefinedKeyword) {
        recordDiagnostic(
          createDiagnosticAtNode(
            sourceFile,
            filePath,
            n,
            lines,
            'undefined',
            'policy-required-shape',
            'warning',
            `Undefined type requires explicit TypeAdapter authoring policy.`
          )
        );
      } else if (ts.isTypeReferenceNode(n)) {
        const typeName = getEntityNameText(n.typeName);
        if (UTILITY_TYPE_NAMES.has(typeName)) {
          recordDiagnostic(
            createDiagnosticAtNode(
              sourceFile,
              filePath,
              n,
              lines,
              'utility-type',
              'policy-required-shape',
              'warning',
              `Utility type '${typeName}' requires explicit TypeAdapter authoring policy.`
            )
          );
        }
        if (n.typeArguments && n.typeArguments.length > 0 && !UTILITY_TYPE_NAMES.has(typeName)) {
          recordDiagnostic(
            createDiagnosticAtNode(
              sourceFile,
              filePath,
              n,
              lines,
              'generic-instantiation',
              'policy-required-shape',
              'warning',
              `Generic instantiation '${typeName}<...>' requires explicit TypeAdapter authoring policy.`
            )
          );
        }
      }

      n.forEachChild(checkNode);
    };

    decl.forEachChild(checkNode);
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const valid = errors.length === 0;

  const summary = valid
    ? warnings.length === 0
      ? `✅ 0 shape issues found across ${scannedCount} declaration(s). Fully direct TypeSpec/OpenAPI projection.`
      : `⚠️ 0 unsupported shapes, ${warnings.length} policy-required shape(s) found across ${scannedCount} declaration(s).`
    : `❌ ${errors.length} unsupported shape(s), ${warnings.length} policy-required shape(s) found across ${scannedCount} declaration(s).`;

  return {
    valid,
    scannedDeclarations: scannedCount,
    scannedFiles: 1,
    diagnostics,
    summary,
  };
}

/**
 * Helper to inspect all declaration shapes in a source text.
 */
export function getDeclarationShapesInSource(
  sourceText: string,
  filePath = 'source.ts'
): Map<string, ContractTypeShape> {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { declarations, cyclicNames } = findCyclicDeclarationNames(sourceFile);
  const result = new Map<string, ContractTypeShape>();

  for (const [name, info] of declarations.entries()) {
    const features = new Set<ContractShapeFeature>();
    collectShapeFeatures(info.declaration, features, {
      currentName: name,
      cyclicNames,
    });
    result.set(name, classifyTypeShape(features));
  }

  return result;
}

/**
 * Extracts and classifies the shape of an individual declaration or property signature.
 */
export function extractDeclarationShape(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.PropertySignature,
): ContractTypeShape {
  const features = new Set<ContractShapeFeature>();
  collectShapeFeatures(node, features);
  return classifyTypeShape(features);
}
